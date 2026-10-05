/**
 * `.ping` — is the bot alive, and how fast?
 */

export default {
  name: 'ping',
  command: ['ping'],
  aliases: ['p'],
  category: 'general',
  description: 'Check that the bot is responding',

  async execute(ctx) {
    const startedAt = Date.now()
    const message = await ctx.reply('Pinging…')
    const latency = Date.now() - startedAt

    // Edit the placeholder so the chat only ever shows one bubble.
    if (message?.key) {
      try {
        await ctx.sock.sendMessage(
          ctx.chat,
          { text: `Pong! 🏓  \`${latency} ms\``, edit: message.key },
          {}
        )
        return
      } catch {
        /* editing is best effort; fall through to a fresh message */
      }
    }

    await ctx.reply(`Pong! 🏓  \`${latency} ms\``)
  }
}
