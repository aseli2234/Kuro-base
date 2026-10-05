/**
 * `.shutdown` — stop the bot cleanly.
 *
 * Requires the literal `confirm` argument, because this is irreversible from
 * inside WhatsApp: the confirmation runs the same graceful path as SIGTERM
 * (stop new work → close database → close the socket → exit).
 */

import { runtime } from '../../src/runtime.js'

export default {
  name: 'shutdown',
  command: ['shutdown', 'stop'],
  category: 'owner',
  description: 'Stop the bot gracefully',
  usage: '.shutdown confirm',
  ownerOnly: true,

  async execute(ctx) {
    if ((ctx.args[0] ?? '').toLowerCase() !== 'confirm') {
      await ctx.reply(
        [
          '*SHUTDOWN*',
          '────────────────────────',
          'This stops KURO and closes the WhatsApp connection.',
          'The session is kept, so the next start reconnects without pairing.',
          '',
          `Send \`${ctx.prefix}shutdown confirm\` to proceed.`
        ].join('\n')
      )
      return
    }

    await ctx.reply('🛑 Shutting down gracefully…')
    ctx.logger?.warn?.(`Shutdown requested by ${ctx.sender}`)

    // Give the reply a moment to actually leave the socket.
    setTimeout(() => {
      void runtime.shutdown?.('command')
    }, 500)
  }
}
