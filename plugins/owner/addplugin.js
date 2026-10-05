/**
 * `.addplugin [category] [name]` — install a plugin from chat.
 *
 * Source may come from an attached `.js` document, a quoted `.js` document, a
 * quoted code block, or inline text. It is written to
 * `plugins/<category>/<name>.js` and then loaded through the ordinary loader,
 * so validation and error isolation are identical to a plugin added by hand.
 */

import path from 'node:path'
import { extractPluginSource, writePluginFile } from '../../src/plugins/commands.js'
import { loadPluginFile } from '../../src/plugins/loader.js'
import { slugify } from '../../src/utils/format.js'

export default {
  name: 'addplugin',
  command: ['addplugin', 'ap'],
  category: 'owner',
  description: 'Install a plugin from a file or from chat',
  usage: '.addplugin [category] [name]  (attach or reply with a .js file)',
  ownerOnly: true,

  async execute(ctx) {
    const [maybeCategory, maybeName] = ctx.args
    const category = maybeCategory ? slugify(maybeCategory) : 'general'
    const name = maybeName ? slugify(maybeName) : null

    if (!name) {
      await ctx.reply(
        [
          '*ADDPLUGIN*',
          '────────────────────────',
          `\`${ctx.prefix}addplugin <category> <name>\``,
          '',
          'Then attach a `.js` file, reply to one with this command, or paste',
          'the source inline. A plugin must `export default { name, command, execute }`.'
        ].join('\n')
      )
      return
    }

    await ctx.react('⏳').catch(() => {})

    let source
    try {
      ({ source } = await extractPluginSource(ctx, target => ctx.download({ ...target })))
    } catch (error) {
      await ctx.react('❌').catch(() => {})
      await ctx.reply(`❌ ${error.message}`)
      return
    }

    let written
    try {
      written = writePluginFile({
        directory: ctx.config.plugins.directory,
        category,
        name,
        source,
        overwrite: true
      })
    } catch (error) {
      await ctx.react('❌').catch(() => {})
      await ctx.reply(`❌ Could not write the plugin file: ${error.message}`)
      return
    }

    const relative = path.relative(ctx.config.plugins.directory, written.file)

    // Load it immediately so the owner sees the result right away.
    const registration = await loadPluginFile(written.file, {
      registry: ctx.plugins,
      root: ctx.config.plugins.directory,
      db: ctx.db,
      logger: ctx.logger
    })

    if (registration.ok) {
      await ctx.react('✅').catch(() => {})
      await ctx.reply(
        [
          '*ADDPLUGIN* ✅',
          '────────────────────────',
          `› File     : ${relative}`,
          `› Plugin   : ${registration.name}`,
          `› Category : ${registration.category}`,
          `› Bytes    : ${written.bytes}`,
          `› Total    : ${ctx.plugins.size} plugins loaded`
        ].join('\n')
      )
      return
    }

    // The file is on disk but did not load — say exactly why.
    await ctx.react('⚠️').catch(() => {})
    await ctx.reply(
      [
        '*ADDPLUGIN* ⚠️ written but not loaded',
        '────────────────────────',
        `› File   : ${relative}`,
        `› Reason : ${registration.reason}`,
        '',
        'Fix the file and run `.reload all`, or delete it with `.delplugin`.'
      ].join('\n')
    )
  }
}
