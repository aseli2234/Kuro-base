/**
 * `.restart` — bring the process back up.
 *
 * The current process shuts down gracefully and a detached copy of `node` is
 * started with the same arguments. Under a supervisor (pm2, systemd, Docker)
 * the supervisor would restart it anyway; this works without one too.
 */

import { runtime } from '../../src/runtime.js'

export default {
  name: 'restart',
  command: ['restart'],
  category: 'owner',
  description: 'Restart the bot process',
  usage: '.restart confirm',
  ownerOnly: true,

  async execute(ctx) {
    if ((ctx.args[0] ?? '').toLowerCase() !== 'confirm') {
      await ctx.reply(
        [
          '*RESTART*',
          '────────────────────────',
          'This stops KURO and starts it again immediately.',
          'The session is kept, so no re-pairing is required.',
          '',
          `Send \`${ctx.prefix}restart confirm\` to proceed.`
        ].join('\n')
      )
      return
    }

    await ctx.reply('🔄 Restarting…')
    ctx.logger?.warn?.(`Restart requested by ${ctx.sender}`)

    setTimeout(() => {
      void runtime.restart?.()
    }, 500)
  }
}
