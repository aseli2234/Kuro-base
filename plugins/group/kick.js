/**
 * `.kick` — remove a member from the group.
 *
 * A reference implementation of the group plugin metadata:
 *
 *   groupOnly → only usable in a group
 *   adminOnly → the sender must be an admin (or an owner)
 *   botAdmin  → the bot itself must be an admin, checked before running
 *
 * The target is taken from a mention or from the quoted message's participant,
 * never from free text.
 */

import { findParticipant } from '../../src/handler/permissions.js'

export default {
  name: 'kick',
  command: ['kick'],
  category: 'group',
  description: 'Remove a member from the group',
  usage: '.kick @user   |   reply to a message with .kick',
  groupOnly: true,
  adminOnly: true,
  botAdmin: true,

  async execute(ctx) {
    // 1. A mentioned JID, or the participant of the quoted message.
    const target = ctx.mentionedJid?.[0] ?? ctx.m.contextInfo?.participant ?? null

    if (!target) {
      await ctx.reply(`Tag someone or reply to their message.\nUsage: \`${ctx.prefix}kick @user\``)
      return
    }

    const participant = findParticipant(ctx.groupMetadata, target)
    const resolved = participant?.id ?? target

    if (resolved === ctx.sock.user?.id) {
      await ctx.reply('I cannot remove myself.')
      return
    }

    if (findParticipant(ctx.groupMetadata, resolved)?.admin) {
      await ctx.reply('I cannot remove another admin.')
      return
    }

    const result = await ctx.sock.groupParticipantsUpdate(ctx.chat, [resolved], 'remove')
    const failed = result?.find?.(entry => entry.status && entry.status !== '200')

    if (failed) {
      await ctx.reply(`❌ Could not remove @${resolved.split('@')[0]} (status ${failed.status}).`)
      return
    }

    await ctx.react('✅').catch(() => {})
    await ctx.reply(`Removed @${resolved.split('@')[0]}`, { mentions: [resolved] })
  }
}
