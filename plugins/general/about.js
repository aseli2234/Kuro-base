/**
 * `.about` — what this bot is, without leaking anything secret.
 */

import os from 'node:os'
import process from 'node:process'
import { runtime } from '../../src/runtime.js'
import { uptimeSince } from '../../src/utils/time.js'

export default {
  name: 'about',
  command: ['about'],
  category: 'general',
  description: 'Show information about this bot',

  async execute(ctx) {
    const db = ctx.db?.status?.() ?? { connected: false }

    const mode = ctx.db?.getSetting?.('bot_mode') ?? ctx.config.mode ?? 'public'
    const lines = [
      `*${ctx.config.botName}*`,
      '────────────────────────',
      `› Version   : ${ctx.config.version}`,
      `› Owner     : ${ctx.config.ownerName}`,
      `› Runtime   : ${uptimeSince(runtime.startedAt)}`,
      `› Node.js   : ${process.version}`,
      `› Platform  : ${os.platform()} ${os.arch()}`,
      `› Database  : ${db.connected ? `SQLite v${db.version} (${db.tables} tables)` : 'disconnected'}`,
      `› Library   : @rexxhayanasi/elaina-baileys`,
      `› Plugins   : ${ctx.plugins?.size ?? 0}`,
      `› Mode      : ${mode}`,
      '────────────────────────',
      '',
      'A modular WhatsApp bot built on Elaina Baileys with an ESM plugin',
      'system and a SQLite core.'
    ]

    await ctx.reply(lines.join('\n'))
  }
}
