/**
 * `.delplugin <name>` — unload a plugin and delete its file.
 *
 * The unload always happens; the file is only removed when it lives inside the
 * plugin directory (checked again in `src/plugins/commands.js`).
 */

import path from 'node:path'
import { deletePluginFile } from '../../src/plugins/commands.js'

export default {
  name: 'delplugin',
  command: ['delplugin', 'dp', 'removeplugin'],
  category: 'owner',
  description: 'Unload a plugin and delete its file',
  usage: '.delplugin <name>',
  ownerOnly: true,

  async execute(ctx) {
    const name = ctx.args[0]
    if (!name) {
      await ctx.reply(`Usage: \`${ctx.prefix}delplugin <name>\`\nSee \`${ctx.prefix}plugins\` for the list.`)
      return
    }

    const record = ctx.plugins?.get(name)
    if (!record) {
      await ctx.reply(`No plugin named *${name}* is loaded.`)
      return
    }

    const relative = record.file ? path.relative(ctx.config.plugins.directory, record.file) : '(no file)'
    ctx.plugins.unregister(record.name)
    ctx.db?.deletePlugin?.(record.name)

    let fileDeleted = false
    let fileError = null
    if (record.file) {
      try {
        deletePluginFile({ directory: ctx.config.plugins.directory, file: record.file })
        fileDeleted = true
      } catch (error) {
        fileError = error.message
      }
    }

    await ctx.react(fileDeleted ? '✅' : '⚠️').catch(() => {})
    await ctx.reply(
      [
        '*DELPLUGIN*',
        '────────────────────────',
        `› Plugin : ${record.name}`,
        `› Unloaded : yes`,
        `› File   : ${relative} ${fileDeleted ? '— deleted' : '— kept'}`,
        fileError ? `› Note   : ${fileError}` : '',
        '',
        `Remaining plugins: ${ctx.plugins.size}`
      ]
        .filter(Boolean)
        .join('\n')
    )
  }
}
