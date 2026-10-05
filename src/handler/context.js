/**
 * KURO — message context.
 *
 * The object every plugin receives as `ctx`. It is built once per incoming
 * message, after permissions have been resolved server-side, and it is the only
 * surface a plugin needs: no raw socket juggling, no direct database handles.
 *
 *   export default {
 *     name: 'ping',
 *     command: ['ping'],
 *     async execute(ctx) {
 *       await ctx.reply('Pong!')
 *     }
 *   }
 */

import { downloadMedia, reactToMessage, sendMessage } from '../lib/messages.js'
import { sendPreviewCard } from '../lib/preview.js'
import { sendContact } from '../lib/contact.js'
import { checkBanned, checkOwner, checkPremium, isBotGroupAdmin, isGroupAdmin } from './permissions.js'

/**
 * @param {object} options
 * @param {object} options.sock          Live Elaina socket
 * @param {object} options.raw           Raw WAMessage
 * @param {object} options.m             Serialized message
 * @param {object} options.config        Central config
 * @param {object} options.db            Database manager
 * @param {object} [options.registry]    Plugin registry (exposed as `ctx.plugins`)
 * @param {object} [options.logger]
 * @param {object} [options.channel]     Channel helper
 * @param {object} [options.groupMetadata]
 * @param {object} [options.parsed]      Result of `parseCommand()`
 * @returns {Promise<object>}
 */
export const createContext = async ({
  sock,
  raw,
  m,
  config,
  db,
  registry = null,
  logger = null,
  channel = null,
  groupMetadata = null,
  parsed = null
}) => {
  const botJid = sock?.user?.id ?? null
  const botLid = sock?.user?.lid ?? null

  const isOwner = await checkOwner({ sock, config, db, message: m })
  const isAdmin = m.isGroup ? isGroupAdmin(groupMetadata, m.sender) : false
  const isBotAdmin = m.isGroup ? isBotGroupAdmin(groupMetadata, botJid, botLid) : false
  const isBanned = checkBanned({ db, message: m })
  const isPremium = checkPremium({ db, message: m })

  const ctx = {
    // ── plumbing ───────────────────────────────────────────
    sock,
    botJid,
    botLid,
    config,
    db,
    logger,
    channel,
    plugins: registry,
    /** Raw WAMessage, for anything the serializer does not expose. */
    message: raw,
    /** Serialized message. */
    m,
    groupMetadata,

    // ── message ────────────────────────────────────────────
    id: m.id,
    chat: m.chat,
    sender: m.sender,
    senderNumber: m.senderNumber,
    senderPn: m.senderPn,
    senderLid: m.senderLid,
    pushName: m.pushName,

    text: m.text ?? '',
    body: m.text ?? '',
    command: parsed?.command ?? null,
    commandLine: parsed?.rawCommand ?? null,
    args: parsed?.args ?? [],
    /** Everything after the command name. */
    argText: parsed?.argText ?? '',
    prefix: parsed?.prefix ?? null,
    /** `statement` for `> code`, `expression` for `=> code`. */
    evalMode: parsed?.evalMode ?? null,

    quoted: m.quoted,
    mentions: m.mentions,
    mentionedJid: m.mentionedJid,

    type: m.type,
    mtype: m.mtype,
    isMedia: m.isMedia,
    isViewOnce: m.isViewOnce,
    mimetype: m.mimetype,
    fileName: m.fileName,

    // ── permissions (computed server-side, never from text) ─
    isGroup: m.isGroup,
    isPrivate: m.isPrivate,
    isNewsletter: m.isNewsletter,
    isOwner,
    isAdmin,
    isBotAdmin,
    isBanned,
    isPremium,
    isFromMe: m.fromMe,

    // ── helpers ────────────────────────────────────────────

    /** Reply to this message (quotes it). */
    reply: (content, options = {}) =>
      sendMessage(sock, m.chat, typeof content === 'string' ? { text: content } : content, {
        quoted: raw,
        ...options
      }),

    /** Send to this chat without quoting. */
    send: (content, options = {}) =>
      sendMessage(sock, m.chat, typeof content === 'string' ? { text: content } : content, options),

    /** Send anywhere. */
    sendMessage: (jid, content, options = {}) =>
      sendMessage(sock, jid, typeof content === 'string' ? { text: content } : content, options),

    /** React to this message. */
    react: (emoji = '') => reactToMessage(sock, m.key, emoji),

    /** Download the media on this message, or on the quoted one. */
    download: async (options = {}) => {
      if (options.quoted) {
        const quotedMsg = m.quoted?.message ?? m.quoted?.raw
        if (!quotedMsg) return null
        const msgContent = quotedMsg.message ?? quotedMsg
        return downloadMedia(sock, { raw: { ...raw, key: quotedMsg.key ?? raw?.key, message: msgContent } }, options)
      }
      if (!raw) return null
      return downloadMedia(sock, { raw }, options)
    },

    /**
     * Send a large link-preview card.
     * @see src/lib/preview.js
     */
    sendCard: (card, options = {}) =>
      sendPreviewCard(
        sock,
        m.chat,
        {
          url: card.url ?? config?.menu?.url,
          title: card.title ?? config?.menu?.title,
          description: card.description ?? config?.menu?.description,
          thumbnail: card.thumbnail ?? config?.menu?.thumbnail,
          thumbnailWidth: card.thumbnailWidth ?? config?.menu?.thumbnailWidth,
          thumbnailHeightRatioOverride:
            card.thumbnailHeightRatioOverride ?? config?.menu?.thumbnailHeightRatioOverride,
          text: card.text ?? ''
        },
        { quoted: raw, ...options }
      ),

    /**
     * Send a contact as a vCard — e.g. the owner card in the `.owner` plugin.
     * Data should come from `ctx.config` (`ownerName`, `owner[]`).
     */
    sendContact: (contact = {}, options = {}) =>
      sendContact(
        sock,
        contact.jid ?? m.chat,
        {
          name: contact.name,
          number: contact.number,
          organisation: contact.organisation,
          quoted: contact.quoted ?? raw
        },
        options
      ),

    /** Post to the configured channel, when one is set up. */
    sendChannel: (content, options = {}) => {
      if (!channel?.enabled) throw new Error('The channel/newsletter feature is not configured.')
      return channel.send(typeof content === 'string' ? { text: content } : content, options)
    },

    /** True when this plugin's own permission list would let it run. */
    hasPermission: (plugin = {}) => {
      if (plugin.ownerOnly && !isOwner) return false
      if (plugin.groupOnly && !m.isGroup) return false
      if (plugin.privateOnly && m.isGroup) return false
      if (plugin.adminOnly && !isAdmin && !isOwner) return false
      if (plugin.botAdmin && !isBotAdmin) return false
      return true
    }
  }

  return ctx
}

export default createContext
