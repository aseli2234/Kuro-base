/**
 * `.owner` — how to reach the person running this bot.
 *
 * Sends the contact as a **vCard**, not just text, so the recipient can tap to
 * save or message directly. Every value comes from `settings.js`
 * (`ownerName`, `owner[]`) — nothing here is hardcoded (spec §11–§14).
 */

export default {
  name: 'owner',
  command: ['owner'],
  category: 'owner',
  description: 'Show who runs this bot, as a contact card',

  async execute(ctx) {
    const owners = ctx.config.owner ?? []
    if (owners.length === 0) {
      await ctx.reply('No owner number is configured. Add one to the `owner` array in settings.js.')
      return
    }

    const name = ctx.config.ownerName ?? 'Owner'
    await ctx.reply(`👑 *Owner:* ${name}`)

    for (const number of owners) {
      await ctx.sendContact({ name, number })
    }
  }
}
