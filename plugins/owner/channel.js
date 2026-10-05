/**
 * `.channel` — post to and inspect the configured WhatsApp Channel.
 *
 * Posting reuses the ordinary message path: Elaina routes a `@newsletter` JID
 * to the newsletter stanza form inside `relayMessage`, so a channel post is
 * just a send. Reactions use `sock.newsletterReactMessage`.
 *
 *   .channel                 → show the configured channel
 *   .channel info            → live metadata from WhatsApp
 *   .channel post <text>     → publish a post
 *   .channel react <id> 🔥   → react to a post by server id
 */

export default {
  name: 'channel',
  command: ['channel', 'newsletter'],
  category: 'owner',
  description: 'Inspect and post to the configured WhatsApp Channel',
  usage: '.channel post <text>',
  ownerOnly: true,

  async execute(ctx) {
    const channel = ctx.channel
    const action = (ctx.args[0] ?? 'info').toLowerCase()

    if (!channel) {
      await ctx.reply('The channel helper is not available.')
      return
    }

    if (!channel.enabled) {
      await ctx.reply(
        [
          '*CHANNEL* — disabled',
          '────────────────────────',
          'In settings.js set:',
          '',
          '  channel: {',
          '    enabled: true,',
          "    jid: '<id>@newsletter',",
          "    name: 'KURO Updates'\n  }",
          '',
          'then restart KURO.'
        ].join('\n')
      )
      return
    }

    await ctx.react('⏳').catch(() => {})

    try {
      if (action === 'post') {
        const text = (ctx.argText ?? '').replace(/^post\s*/i, '').trim()
        if (!text) {
          await ctx.reply(`Usage: \`${ctx.prefix}channel post <text>\``)
          return
        }
        const sent = await channel.sendText(text)
        await ctx.react('✅').catch(() => {})
        await ctx.reply(
          [
            '*CHANNEL* ✅ posted',
            '────────────────────────',
            `› Channel : ${channel.name}`,
            `› Message : ${sent?.key?.id ?? 'unknown'}`
          ].join('\n')
        )
        return
      }

      if (action === 'react') {
        const serverId = ctx.args[1]
        const emoji = ctx.args[2] ?? '🔥'
        if (!serverId) {
          await ctx.reply(`Usage: \`${ctx.prefix}channel react <serverId> <emoji>\``)
          return
        }
        await channel.react(serverId, emoji)
        await ctx.react('✅').catch(() => {})
        await ctx.reply(`Reacted to channel message \`${serverId}\` with ${emoji}`)
        return
      }

      if (action === 'follow') {
        await channel.follow()
        await ctx.react('✅').catch(() => {})
        await ctx.reply(`Following ${channel.name}.`)
        return
      }

      // Default: metadata
      const metadata = await channel.info()
      await ctx.react('✅').catch(() => {})
      await ctx.reply(
        [
          '*CHANNEL*',
          '────────────────────────',
          `› JID         : ${channel.jid}`,
          `› Name        : ${metadata?.name ?? channel.name}`,
          `› Description : ${metadata?.description ?? '—'}`,
          `› Subscribers : ${metadata?.subscriberCount ?? metadata?.subscribers ?? 'unknown'}`,
          `› State       : ${metadata?.state?.type ?? 'unknown'}`
        ].join('\n')
      )
    } catch (error) {
      await ctx.react('❌').catch(() => {})
      await ctx.reply(`❌ Channel operation failed: ${error.message}`)
    }
  }
}
