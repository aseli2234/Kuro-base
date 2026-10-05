/**
 * `.self` / `.public` / `.mode` — Switch bot mode between self (owner only) and public.
 */

import { bold } from '../../src/utils/format.js'

export default {
  name: 'self',
  command: ['self', 'public', 'mode'],
  category: 'owner',
  description: 'Set bot mode: self (owner only) or public (everyone)',
  usage: '.self | .self on | .self off | .public | .mode <self|public|private|group>',
  ownerOnly: true,

  async execute(ctx) {
    const cmd = ctx.command?.toLowerCase()
    const arg = (ctx.args[0] ?? '').toLowerCase()
    const currentMode = ctx.db?.getSetting?.('bot_mode') ?? ctx.config?.mode ?? 'public'
    const isSelf = currentMode === 'self' || currentMode === 'private'

    if (cmd === 'self' && (arg === 'status' || arg === 'info')) {
      return ctx.reply(
        [
          '🔒 *STATUS BOT MODE*',
          '',
          `› *Self Mode:* ${isSelf ? 'ON (Aktif)' : 'OFF (Nonaktif)'}`,
          `› *Mode Saat Ini:* *${currentMode.toUpperCase()}*`,
          '',
          `› ${bold('.self on')} — Aktifkan mode self (hanya owner/bot)`,
          `› ${bold('.self off')} — Nonaktifkan mode self (kembali ke publik)`,
          `› ${bold('.public')} — Beralih langsung ke mode publik`,
          `› ${bold('.mode <self|public|private|group>')} — Ubah mode bot spesifik`
        ].join('\n')
      )
    }

    const wantSelf = (cmd === 'self' && (arg === 'on' || arg === '1' || arg === 'enable' || arg === 'aktif' || (!arg && !isSelf))) || (cmd === 'mode' && arg === 'self')

    if (wantSelf) {
      try {
        ctx.db?.setSetting('bot_mode', 'self')
        await ctx.react('🔒').catch(() => {})
        await ctx.reply(
          [
            '🔒 *MODE BOT DIUBAH KE SELF*',
            '',
            'Bot sekarang dalam mode *Self* (hanya Owner/Bot sendiri yang diproses).',
            `Ketik ${bold('.self off')} atau ${bold('.public')} untuk mengembalikan ke mode normal/publik.`
          ].join('\n')
        )
      } catch (error) {
        ctx.logger?.warn?.(`mode self on failed: ${error.message}`)
        await ctx.reply('❌ Gagal mengaktifkan mode self.')
      }
      return
    }

    const wantPublic = (cmd === 'self' && (arg === 'off' || arg === '0' || arg === 'disable' || arg === 'mati' || (!arg && isSelf))) || cmd === 'public' || (cmd === 'mode' && arg === 'public')

    if (wantPublic) {
      try {
        ctx.db?.setSetting('bot_mode', 'public')
        await ctx.react('🌐').catch(() => {})
        await ctx.reply(
          [
            '🌐 *MODE BOT DIUBAH KE PUBLIC*',
            '',
            'Bot sekarang dalam mode *Public* (semua pengguna dapat menggunakan bot).'
          ].join('\n')
        )
      } catch (error) {
        ctx.logger?.warn?.(`mode public failed: ${error.message}`)
        await ctx.reply('❌ Gagal menonaktifkan mode self.')
      }
      return
    }

    if (cmd === 'mode' && (arg === 'private' || arg === 'group')) {
      try {
        ctx.db?.setSetting('bot_mode', arg)
        await ctx.react('✅').catch(() => {})
        await ctx.reply(`✅ Mode bot diubah ke *${arg.toUpperCase()}*.`)
      } catch (error) {
        ctx.logger?.warn?.(`mode set failed: ${error.message}`)
        await ctx.reply('❌ Gagal mengubah mode bot.')
      }
      return
    }

    return ctx.reply(
      [
        '⚙️ *PENGATURAN MODE BOT*',
        '',
        `› *Mode Saat Ini:* *${currentMode.toUpperCase()}*`,
        '',
        `› ${bold('.self on')} / ${bold('.self')} — Aktifkan mode self`,
        `› ${bold('.self off')} / ${bold('.public')} — Beralih ke mode publik`,
        `› ${bold('.mode <self|public|private|group>')} — Ganti mode bot`
      ].join('\n')
    )
  }
}
