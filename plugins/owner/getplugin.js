/**
 * `.getplugin <name>` — read a plugin's source back out of the bot.
 *
 * Sends the file as a `.js` document, and prints the metadata inline. Falls
 * back to a text preview when the source is too large to attach.
 */

import path from 'node:path'
import { describePlugin } from '../../src/plugins/utils.js'
import { readPluginFile } from '../../src/plugins/commands.js'
import { clampMiddle, formatBytes } from '../../src/utils/format.js'

export default {
  name: 'getplugin',
  command: ['getplugin', 'gp'],
  category: 'owner',
  description: 'Send the source of a loaded plugin',
  usage: '.getplugin <name>',
  ownerOnly: true,

  async execute(ctx) {
    const name = ctx.args[0]
    if (!name) {
      await ctx.reply(`Usage: \`${ctx.prefix}getplugin <name>\`\nSee \`${ctx.prefix}plugins\` for the list.`)
      return
    }

    const record = ctx.plugins?.get(name)
    if (!record) {
      await ctx.reply(`No plugin named *${name}* is loaded.`)
      return
    }

    const info = describePlugin(record)
    const header = [
      `*${info.name}*`,
      '────────────────────────',
      `› Category    : ${info.category}`,
      `› Commands    : ${info.commands.join(', ')}`,
      `› Aliases     : ${info.aliases.join(', ') || '—'}`,
      `› Flags       : ${[
        info.ownerOnly && 'ownerOnly',
        info.adminOnly && 'adminOnly',
        info.groupOnly && 'groupOnly',
        info.privateOnly && 'privateOnly',
        info.botAdmin && 'botAdmin'
      ]
        .filter(Boolean)
        .join(', ') || 'none'}`,
      `› Status      : ${info.enabled ? 'enabled' : 'disabled'}`,
      `› File        : ${path.relative(ctx.config.plugins.directory, info.file)}`
    ].join('\n')

    let source
    try {
      ({ source } = readPluginFile({
        directory: ctx.config.plugins.directory,
        file: record.file,
        name: record.name
      }))
    } catch (error) {
      await ctx.reply(`❌ Could not read the source: ${error.message}`)
      return
    }

    await ctx.reply(header)

    const bytes = Buffer.byteLength(source, 'utf8')
    if (bytes > 100 * 1024) {
      // Too big to send as a document comfortably — preview the head instead.
      await ctx.reply(`\`\`\`js\n${clampMiddle(source, 3000)}\n\`\`\``)
      return
    }

    await ctx.send(
      {
        document: Buffer.from(source, 'utf8'),
        fileName: `${record.name}.js`,
        mimetype: 'application/javascript'
      },
      { quoted: ctx.message }
    )

    ctx.logger?.debug?.(`Sent source of ${record.name} (${formatBytes(bytes)}) to ${ctx.sender}`)
  }
}
