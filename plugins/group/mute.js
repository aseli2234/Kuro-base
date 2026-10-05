/**
 * `.mute` — Mute or unmute the bot in the current group.
 *
 * When a group is muted, the bot will not respond to any commands from members
 * in that group. The owner can always use commands and run `.mute off`.
 */

import { bold } from '../../src/utils/format.js'

export default {
  name: 'mute',
  command: ['mute', 'unmute'],
  category: 'group',
  description: 'Mute or unmute bot responses in the group',
  usage: '.mute on | .mute off | .unmute',
  groupOnly: true,
  adminOnly: true,

  async execute(ctx) {
    const isUnmuteCmd = ctx.command === 'unmute'
    const arg = (ctx.args[0] ?? '').toLowerCase()
    const groupJid = ctx.chat

    if (isUnmuteCmd || arg === 'off' || arg === '0' || arg === 'disable' || arg === 'mati') {
      try {
        ctx.db?.updateGroupSettings(groupJid, { muted: false })
        ctx.db?.updateChatSettings(groupJid, { muted: false })
        await ctx.react('🔊').catch(() => {})
        await ctx.reply(
          [
            '🔊 *GRUP DIAKTIFKAN KEMBALI (UNMUTED)*',
            '',
            'Bot kembali aktif dan akan merespons pesan/perintah di grup ini.'
          ].join('\n')
        )
      } catch (error) {
        ctx.logger?.warn?.(`mute off failed: ${error.message}`)
        await ctx.reply('❌ Gagal memperbarui status mute grup di database.')
      }
      return
    }

    if (arg === 'on' || arg === '1' || arg === 'enable' || arg === 'aktif' || !arg) {
      try {
        ctx.db?.updateGroupSettings(groupJid, { muted: true })
        ctx.db?.updateChatSettings(groupJid, { muted: true })
        await ctx.react('🔇').catch(() => {})
        await ctx.reply(
          [
            '🔇 *GRUP DIBISUKAN (MUTED)*',
            '',
            'Bot telah dibisukan di grup ini dan tidak akan merespons pesan/perintah dari anggota grup.',
            `Ketik ${bold('.mute off')} atau ${bold('.unmute')} untuk mengaktifkan kembali.`
          ].join('\n')
        )
      } catch (error) {
        ctx.logger?.warn?.(`mute on failed: ${error.message}`)
        await ctx.reply('❌ Gagal memperbarui status mute grup di database.')
      }
      return
    }

    if (arg === 'status') {
      const isMuted = ctx.db?.getGroup?.(groupJid)?.settings?.muted === true
      await ctx.reply(`Status bot di grup ini: *${isMuted ? 'DIBISUKAN (MUTED)' : 'AKTIF'}*`)
      return
    }

    await ctx.reply(`Format: ${bold('.mute on')} untuk membisukan, atau ${bold('.mute off')} / ${bold('.unmute')} untuk mengaktifkan.`)
  }
}
