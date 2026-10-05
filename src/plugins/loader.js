/**
 * KURO — ESM plugin loader.
 *
 * Scans a folder, dynamically imports every module, validates its metadata and
 * registers the good ones. A broken plugin is reported and skipped — it never
 * takes the process down:
 *
 *   scan folder → import → validate → register → persist metadata
 *
 * Reloading uses a cache-busting query on the file URL, because Node caches ESM
 * modules by URL and would otherwise hand back the old module.
 */

import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { categoryFromPath, sortPluginFiles, validatePlugin } from './utils.js'

const DEFAULT_EXTENSIONS = ['.js']
const DEFAULT_DISABLED_PREFIX = '_'

/**
 * Walk the plugin directory and return every loadable file.
 *
 * A leading `_` on the file or its folder marks it disabled, matching the
 * `.plugins` naming convention.
 */
export const discoverPluginFiles = (
  directory,
  { extensions = DEFAULT_EXTENSIONS, disabledPrefix = DEFAULT_DISABLED_PREFIX } = {}
) => {
  const found = []

  const walk = current => {
    let entries
    try {
      entries = fs.readdirSync(current, { withFileTypes: true })
    } catch {
      return
    }

    for (const entry of entries) {
      if (entry.name.startsWith(disabledPrefix) || entry.name.startsWith('.')) continue
      const full = path.join(current, entry.name)

      if (entry.isDirectory()) {
        walk(full)
        continue
      }
      if (!entry.isFile()) continue
      if (!extensions.includes(path.extname(entry.name))) continue
      // Skip the loader's own helpers if they ever land in the plugin folder.
      if (entry.name.endsWith('.test.js')) continue

      found.push(full)
    }
  }

  walk(directory)
  return sortPluginFiles(found)
}

/**
 * Import a plugin module, always freshly read from disk.
 * Accepts `export default {...}` — the canonical KURO plugin shape.
 */
export const importPluginFile = async file => {
  const url = `${pathToFileURL(file).href}?v=${Date.now()}`
  const module = await import(url)
  const plugin = module?.default ?? module?.plugin ?? null
  return { plugin, module }
}

/**
 * Load and register a single plugin file.
 *
 * @returns {Promise<{ ok: boolean, name?: string, reason?: string }>}
 */
export const loadPluginFile = async (file, { registry, root, db = null, logger = null } = {}) => {
  let plugin
  try {
    ({ plugin } = await importPluginFile(file))
  } catch (error) {
    logger?.error(`Failed to import ${path.relative(root ?? process.cwd(), file)}: ${error.message}`)
    registry.recordFailure(file, error)
    return { ok: false, reason: `import failed: ${error.message}` }
  }

  const validation = validatePlugin(plugin, { file })
  if (!validation.ok) {
    logger?.error(`Invalid plugin ${path.relative(root ?? process.cwd(), file)}: ${validation.errors.join('; ')}`)
    registry.recordFailure(file, new Error(validation.errors.join('; ')))
    return { ok: false, reason: validation.errors.join('; ') }
  }
  for (const warning of validation.warnings) {
    logger?.warn?.(`Plugin ${plugin.name}: ${warning}`)
  }

  const category = plugin.category ?? categoryFromPath(file, root ?? process.cwd())
  const result = registry.register(plugin, { file, category })
  if (!result.ok) {
    logger?.error(`Could not register ${plugin.name}: ${result.reason}`)
    registry.recordFailure(file, new Error(result.reason))
    return { ok: false, name: plugin.name, reason: result.reason }
  }

  // Keep the database in step with the file system.
  if (db) {
    try {
      const stored = db.getPlugin(result.record.name)
      if (!stored) {
        db.setPlugin(result.record.name, {
          enabled: true,
          metadata: { category: result.record.category, description: result.record.description, file, commands: result.record.commands }
        })
      } else {
        result.record.enabled = stored.enabled
        db.setPlugin(result.record.name, {
          enabled: stored.enabled,
          metadata: { ...stored.metadata, category: result.record.category, description: result.record.description, file, commands: result.record.commands }
        })
      }
    } catch (error) {
      logger?.warn?.(`Could not persist metadata for ${result.record.name}: ${error.message}`)
    }
  }

  return { ok: true, name: result.record.name, record: result.record, category }
}

/**
 * Load every plugin in a directory.
 *
 * @returns {Promise<{ loaded: string[], failed: string[], files: number }>}
 */
export const loadPlugins = async ({ directory, registry, db = null, logger = null, config = null } = {}) => {
  const extensions = config?.plugins?.extensions ?? DEFAULT_EXTENSIONS
  const disabledPrefix = config?.plugins?.disabledPrefix ?? DEFAULT_DISABLED_PREFIX

  if (!fs.existsSync(directory)) {
    logger?.warn(`Plugin directory ${directory} does not exist — nothing to load`)
    return { loaded: [], failed: [], files: 0 }
  }

  const files = discoverPluginFiles(directory, { extensions, disabledPrefix })
  const loaded = []
  const failed = []

  for (const file of files) {
    const result = await loadPluginFile(file, { registry, root: directory, db, logger })
    if (result.ok) loaded.push(result.name)
    else failed.push(path.basename(file))
  }

  logger?.success?.(`Loaded ${loaded.length} plugin${loaded.length === 1 ? '' : 's'} from ${files.length} file(s)`)
  if (failed.length) logger?.warn?.(`${failed.length} plugin file(s) failed to load: ${failed.join(', ')}`)

  return { loaded, failed, files: files.length }
}

/**
 * Reload one plugin by name: unregister it, re-import its file, register it.
 * Nothing else in the registry is touched.
 */
export const reloadPlugin = async (name, { registry, db = null, logger = null } = {}) => {
  const record = registry.get(name)
  if (!record) return { ok: false, reason: `no plugin named "${name}" is registered` }
  if (!record.file) return { ok: false, reason: `"${name}" has no source path on disk, so it cannot be reloaded` }

  const { file } = record
  // Release the triggers first so the fresh import can claim them again.
  registry.unregister(name)

  const result = await loadPluginFile(file, { registry, root: path.dirname(path.dirname(file)), db, logger })
  if (result.ok) {
    logger?.success?.(`Reloaded plugin "${name}"`)
    return { ok: true, name: result.name }
  }

  logger?.error(`Reload of "${name}" failed: ${result.reason}`)
  return { ok: false, reason: result.reason }
}

/** Reload every plugin by clearing the registry and re-scanning. */
export const reloadAllPlugins = async ({ directory, registry, db = null, logger = null, config = null } = {}) => {
  registry.clear()
  return loadPlugins({ directory, registry, db, logger, config })
}

/** Unload a single plugin without touching its file. */
export const unloadPlugin = (name, { registry, logger = null } = {}) => {
  const removed = registry.unregister(name)
  if (removed) logger?.info?.(`Unloaded plugin "${name}"`)
  return removed
}

/** Watch a plugin directory and reload changed plugins (used by `.reload watch`). */
export const watchPlugins = ({ directory, registry, db = null, logger = null, debounceMs = 500 }) => {
  let timer = null
  const watcher = fs.watch(directory, { recursive: true }, (_event, filename) => {
    if (!filename || !String(filename).endsWith('.js')) return
    clearTimeout(timer)
    timer = setTimeout(async () => {
      const slug = path.basename(String(filename), '.js')
      const record = registry.all().find(item => path.basename(item.file, '.js') === slug)
      if (record) await reloadPlugin(record.name, { registry, db, logger })
      else await loadPlugins({ directory, registry, db, logger })
    }, debounceMs)
  })
  logger?.info?.(`Watching ${directory} for plugin changes`)
  return watcher
}

export default {
  discoverPluginFiles,
  importPluginFile,
  loadPluginFile,
  loadPlugins,
  reloadPlugin,
  reloadAllPlugins,
  unloadPlugin,
  watchPlugins
}
