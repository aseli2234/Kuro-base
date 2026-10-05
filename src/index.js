#!/usr/bin/env node
/**
 * KURO — entrypoint.
 *
 * Boot order:
 *
 *   1. banner + configuration sanity checks
 *   2. SQLite connection and migrations
 *   3. plugin registry and initial load
 *   4. WhatsApp connection (pair with a code, or reuse the saved session)
 *   5. signal handlers for a graceful shutdown
 *
 * Nothing above is allowed to throw past this file without a readable message:
 * a settings problem must say *which* key in `settings.js` is wrong.
 */

import os from 'node:os'
import process from 'node:process'
import { spawn } from 'node:child_process'

import config, { configWarnings, SETTINGS_HINT } from './config/index.js'
import { logger } from './utils/logger.js'
import { createDatabase } from './database/index.js'
import { PluginRegistry } from './plugins/registry.js'
import { loadPlugins, reloadPlugin as reloadPluginModule } from './plugins/loader.js'
import { createChannelHelper } from './lib/channel.js'
import { getThemeConfig } from './lib/theme.js'
import { ConnectionManager } from './connection/index.js'
import { sessionExists } from './connection/auth.js'
import { registerMessageHandler } from './handler/index.js'
import { bindMessageLogger } from './utils/message-logger.js'
import { cleanTmp } from './lib/media.js'
import { runtime, bindRuntime } from './runtime.js'
import { formatBytes } from './utils/format.js'

/** How many uncaught exceptions are tolerated before KURO gives up. */
const MAX_UNCAUGHT_EXCEPTIONS = 10

const boot = async () => {
  logger.banner(`${config.botName}  v${config.version}`, [
    `Node.js   : ${process.version}`,
    `Platform  : ${os.platform()} ${os.arch()}`,
    `Mode      : ${config.mode}`,
    `Prefixes  : ${config.prefix.join(' ')}`,
    `Database  : ${config.database.path}`
  ])

  // ── configuration ──────────────────────────────────────────
  logger.info(
    `Settings: ${config.sources.settings ?? 'built-in defaults'}${
      config.sources.local ? ` + ${config.sources.local}` : ''
    }`
  )
  for (const note of configWarnings) {
    const text = `${note.message} (settings.js)`
    if (note.level === 'info') logger.info(text)
    else logger.warn(text)
  }

  if (config.owner.length) {
    logger.info(`Owners: ${config.owner.map(number => `+${number}`).join(', ')}`)
  }
  if (config.mode === 'private') {
    logger.info('Mode is "private" — only owners will get responses.')
  }

  // ── database ───────────────────────────────────────────────
  const dbLogger = logger.child({ module: 'db' })
  const db = createDatabase({ path: config.database.path, logger: dbLogger })
  const status = db.status()
  logger.success(`Database ready — SQLite schema v${status.version}, ${status.tables} tables, ${formatBytes(status.sizeBytes)}`)
  if (status.pending) logger.info(`${status.pending} migration(s) still pending.`)

  // A prefix changed with `.setprefix` wins over the settings.js value.
  const storedPrefix = db.getSetting('prefix', null)
  if (Array.isArray(storedPrefix) && storedPrefix.length) {
    config.prefix = [...new Set(storedPrefix)].sort((a, b) => b.length - a.length)
    logger.info(`Prefix loaded from the database: ${config.prefix.join(' ')}`)
  }

  // Theme values persisted by the Theme Manager (`.theme`) win over
  // settings.js — name, description and thumbnail of the menu.
  const theme = getThemeConfig(db, config)
  if (theme.source.botName === 'database') {
    config.botName = theme.botName
    logger.info(`Bot name loaded from the theme store: ${theme.botName}`)
  }
  if (theme.source.description === 'database') {
    config.menu.description = theme.description
    logger.info('Menu description loaded from the theme store.')
  }
  if (theme.source.thumbnail === 'database') {
    config.menu.thumbnail = theme.thumbnail
    logger.info('Menu thumbnail loaded from the theme store.')
  }
  config.menu.title = theme.title

  // ── plugins ────────────────────────────────────────────────
  const pluginLogger = logger.child({ module: 'plugins' })
  const registry = new PluginRegistry({ logger: pluginLogger })
  const loaded = await loadPlugins({
    directory: config.plugins.directory,
    registry,
    db,
    logger: pluginLogger,
    config
  })
  logger.success(`Registry: ${registry.size} plugin(s), ${registry.commandCount} trigger(s), ${loaded.failed.length} failure(s)`)

  // ── channel helper (re-bound to each new socket) ───────────
  const channel = createChannelHelper({ sock: null, config, logger: logger.child({ module: 'channel' }), db })
  if (channel.enabled) logger.info(`Channel enabled: ${channel.name}`)

  // ── connection ─────────────────────────────────────────────
  bindMessageLogger(config, logger)

  let detach = null
  const waLogger = logger.child({ module: 'wa' })

  const manager = new ConnectionManager({
    config,
    logger: waLogger,
    onSocket: sock => {
      // A reconnect produces a brand new socket, so always rebind.
      detach?.()
      detach = registerMessageHandler({ sock, registry, db, config, logger, channel })
      channel.bind(sock)
      bindRuntime({ socket: sock, manager })
      logger.debug('Message handler attached to the new socket.')
    }
  })

  // ── process-level actions exposed to plugins ───────────────
  async function shutdown(reason = 'signal', code = 0) {
    if (runtime.shuttingDown) return
    runtime.shuttingDown = true
    logger.warn(`Shutting down (${reason})…`)

    detach?.()
    try {
      await manager.stop({ reason })
    } catch (error) {
      logger.debug(`Socket teardown raised: ${error.message}`)
    }
    try {
      db.close()
      logger.info('Database closed.')
    } catch (error) {
      logger.error(`Could not close the database: ${error.message}`)
    }

    logger.info(`KURO ran for ${Math.round((Date.now() - runtime.startedAt) / 1000)}s. Goodbye.`)
    process.exit(code)
  }

  async function restart() {
    if (runtime.shuttingDown) return
    runtime.shuttingDown = true
    logger.warn('Restarting KURO…')

    detach?.()
    try {
      await manager.stop({ reason: 'restart' })
    } catch {
      /* the socket is going away anyway */
    }
    try {
      db.close()
      logger.info('Database closed before restart.')
    } catch (error) {
      logger.error(`Could not close the database: ${error.message}`)
    }

    // Wait for the WAL files to settle before the replacement opens them.
    await new Promise(resolve => setTimeout(resolve, 400))

    try {
      const child = spawn(process.execPath, process.argv.slice(1), {
        cwd: config.paths.root,
        detached: true,
        stdio: 'inherit'
      })
      child.unref()
      logger.success(`Replacement process started (pid ${child.pid}).`)
    } catch (error) {
      logger.error(`Could not spawn a replacement process: ${error.message}`)
      logger.warn('Use a process manager (pm2, systemd, Docker) to restart KURO automatically.')
    }

    process.exit(0)
  }

  const reloadPlugins = () =>
    loadPlugins({ directory: config.plugins.directory, registry, db, logger: pluginLogger, config })

  const reloadPluginByName = name => reloadPluginModule(name, { registry, db, logger: pluginLogger })

  bindRuntime({
    startedAt: Date.now(),
    shutdown,
    restart,
    reloadPlugins,
    reloadPlugin: reloadPluginByName,
    database: db,
    registry,
    config,
    logger,
    channel,
    manager
  })

  // ── signal handlers ────────────────────────────────────────
  let uncaught = 0
  process.on('SIGINT', () => void shutdown('SIGINT'))
  process.on('SIGTERM', () => void shutdown('SIGTERM'))

  process.on('uncaughtException', error => {
    uncaught += 1
    logger.error(`Uncaught exception (${uncaught}/${MAX_UNCAUGHT_EXCEPTIONS}): ${error.stack ?? error.message}`)
    if (uncaught >= MAX_UNCAUGHT_EXCEPTIONS) {
      logger.error('Too many uncaught exceptions — shutting down to avoid a broken loop.')
      void shutdown('uncaught-exception', 1)
    }
  })

  process.on('unhandledRejection', reason => {
    logger.error(`Unhandled rejection: ${reason?.stack ?? reason}`)
  })

  // ── start the socket ───────────────────────────────────────
  manager.on('open', () => {
    logger.success(
      `KURO is live. Session: ${sessionExists(config.auth.folder) ? 'saved' : 'not yet saved'} · uptime ${Math.round(
        (Date.now() - runtime.startedAt) / 1000
      )}s`
    )
  })
  manager.on('pairing', result => {
    logger.banner('PAIRING CODE', [result.code, `for ${result.number}`, result.custom ? 'custom code' : 'generated code'])
  })
  manager.on('logout', info => {
    if (!info?.manual) {
      logger.error('The session is no longer valid. Delete the session folder and pair again.')
    }
  })
  manager.on('replaced', () => {
    logger.error('This bot was replaced by another device. Stop the other session or start KURO with a new number.')
  })
  manager.on('exhausted', () => {
    logger.error('All reconnect attempts failed. Fix the network or credentials, then restart KURO.')
  })

  await manager.start()

  // ── periodic housekeeping ──────────────────────────────────
  const housekeeping = setInterval(() => {
    if (runtime.shuttingDown) return
    const removed = cleanTmp(config.paths.tmp, 60 * 60 * 1000)
    if (removed) logger.debug(`Cleaned ${removed} temp file(s).`)
  }, 30 * 60 * 1000)
  housekeeping.unref?.()

  logger.success(`${config.botName} boot complete — waiting for WhatsApp.`)
  return { db, registry, manager, channel }
}

boot().catch(error => {
  logger.error(`Fatal startup error: ${error.stack ?? error.message}`)
  if (/pairing\.number is invalid|No pairing number available/.test(error.message ?? '')) {
    logger.warn(`Fix the pairing configuration in ${SETTINGS_HINT} and start KURO again.`)
  }
  process.exit(1)
})
