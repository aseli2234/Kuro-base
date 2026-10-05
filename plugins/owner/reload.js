/**
 * `.reload <name>` / `.reload all` — refresh plugins without restarting the bot.
 *
 * Reloading one plugin re-imports only that file; `all` clears the registry and
 * re-scans the folder. The process, the socket and the database are untouched.
 */

import { reloadAllPlugins, reloadPlugin } from '../../src/plugins/loader.js'
import { runtime } from '../../src/runtime.js'

export default {
  name: 'reload',
  command: ['reload', 'rl'],
  category: 'owner',
  description: 'Reload one plugin, or every plugin',
  usage: '.reload <pluginName>   |   .reload all',
  ownerOnly: true,

  async execute(ctx) {
    const target = (ctx.args[0] ?? '').trim()

    if (!target) {
      const names = (ctx.plugins?.all() ?? []).map(record => record.name)
      await ctx.reply(
        [
          '*RELOAD*',
          '────────────────────────',
          `\`${ctx.prefix}reload <name>\``,
          `\`${ctx.prefix}reload all\``,
          '',
          `Loaded plugins: ${names.join(', ') || 'none'}`
        ].join('\n')
      )
      return
    }

    await ctx.react('⏳').catch(() => {})

    if (target.toLowerCase() === 'all') {
      const result = await reloadAllPlugins({
        directory: ctx.config.plugins.directory,
        registry: ctx.plugins,
        db: ctx.db,
        logger: ctx.logger,
        config: ctx.config
      })
      runtime.registry = ctx.plugins
      await ctx.react(result.failed.length ? '⚠️' : '✅').catch(() => {})
      await ctx.reply(
        [
          '*RELOAD ALL*',
          '────────────────────────',
          `› Loaded : ${result.loaded.length}`,
          `› Failed : ${result.failed.length}`,
          result.failed.length ? `› Files  : ${result.failed.join(', ')}` : ''
        ]
          .filter(Boolean)
          .join('\n')
      )
      return
    }

    const result = await reloadPlugin(target, {
      registry: ctx.plugins,
      db: ctx.db,
      logger: ctx.logger
    })

    await ctx.react(result.ok ? '✅' : '❌').catch(() => {})
    await ctx.reply(
      result.ok
        ? `*RELOAD* ✅ plugin \`${result.name}\` reloaded.`
        : `*RELOAD* ❌ ${result.reason}`
    )
  }
}
