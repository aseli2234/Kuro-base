/**
 * KURO — message serializer.
 *
 * Turns a raw Elaina/Baileys WAMessage into the flat, defensive object that
 * every plugin and the context factory consume. Nothing here talks to the
 * network: it only reads what WhatsApp already delivered.
 *
 * Address forms matter. A message may address the sender by LID
 * (`12345@lid`) instead of a phone-number JID (`62812@s.whatsapp.net`), and
 * WhatsApp usually supplies the counterpart in `*Alt` fields. Both are kept:
 *
 *   senderLid  → whatever LID form was available
 *   senderPn   → whatever phone-number form was available
 *
 * Nothing is ever derived from a LID by string arithmetic.
 */

import {
  isJidGroup,
  isJidNewsletter,
  isJidStatusBroadcast,
  isLidUser,
  isPnUser,
  jidNormalizedUser,
  normalizeMessageContent,
  getContentType
} from '@rexxhayanasi/elaina-baileys'
import { digitsOf } from './lid.js'

const safeNormalize = jid => {
  try {
    return jidNormalizedUser(jid)
  } catch {
    return String(jid ?? '')
  }
}

const isHostedForm = jid => typeof jid === 'string' && jid.endsWith('@hosted')

/** User part of a JID with any device suffix removed. */
const userOf = jid => String(jid ?? '').split('@')[0].split(':')[0]

/** Does this sender address belong to the bot's own account? */
const isBotSelf = ({ sender, meId, meLid }) => {
  if (!sender) return false
  if (meId && userOf(meId) === userOf(sender)) return true
  return Boolean(meLid && safeNormalize(meLid) === safeNormalize(sender))
}

/** Unwrap the future-proof wrappers WhatsApp likes to nest messages in. */
export const unwrapMessage = message => {
  if (!message) return undefined
  return normalizeMessageContent(message) ?? message
}

/** Baileys message key → the content key, e.g. `imageMessage`. */
export const contentKey = content => getContentType(content) ?? null

const MEDIA_KEYS = new Set([
  'imageMessage',
  'videoMessage',
  'audioMessage',
  'documentMessage',
  'documentWithCaptionMessage',
  'stickerMessage'
])

const FRIENDLY_TYPES = {
  conversation: 'text',
  extendedTextMessage: 'text',
  imageMessage: 'image',
  videoMessage: 'video',
  audioMessage: 'audio',
  documentMessage: 'document',
  documentWithCaptionMessage: 'document',
  stickerMessage: 'sticker',
  contactMessage: 'contact',
  contactsArrayMessage: 'contact',
  locationMessage: 'location',
  liveLocationMessage: 'location',
  pollCreationMessage: 'poll',
  pollCreationMessageV2: 'poll',
  pollCreationMessageV3: 'poll',
  reactionMessage: 'reaction',
  protocolMessage: 'protocol',
  buttonsResponseMessage: 'button',
  templateButtonReplyMessage: 'button',
  listResponseMessage: 'list',
  interactiveResponseMessage: 'interactive',
  eventMessage: 'event',
  productMessage: 'product',
  orderMessage: 'order',
  albumMessage: 'album'
}

/**
 * Best-effort text extraction across every message shape WhatsApp sends.
 * Returns `null` when the message genuinely carries no text.
 */
export const extractText = content => {
  if (!content) return null

  if (typeof content.conversation === 'string') return content.conversation

  const extended = content.extendedTextMessage
  if (extended?.text) return extended.text

  for (const key of ['imageMessage', 'videoMessage', 'documentMessage', 'audioMessage', 'ptvMessage']) {
    const media = content[key]
    if (media?.caption) return media.caption
  }

  const documentWrapper = content.documentWithCaptionMessage?.message?.documentMessage
  if (documentWrapper?.caption) return documentWrapper.caption

  if (content.buttonsResponseMessage) {
    return content.buttonsResponseMessage.selectedDisplayText ?? content.buttonsResponseMessage.selectedButtonId ?? null
  }

  if (content.templateButtonReplyMessage) {
    return content.templateButtonReplyMessage.selectedDisplayText ?? content.templateButtonReplyMessage.selectedId ?? null
  }

  if (content.listResponseMessage) {
    return content.listResponseMessage.title ?? content.listResponseMessage.singleSelectReply?.selectedRowId ?? null
  }

  if (content.interactiveResponseMessage) {
    const params = content.interactiveResponseMessage.nativeFlowResponseMessage?.paramsJson
    if (params) {
      try {
        const parsed = JSON.parse(params)
        return parsed.id ?? parsed.selectedId ?? parsed.title ?? params
      } catch {
        return params
      }
    }
    return content.interactiveResponseMessage.body?.text ?? null
  }

  if (content.reactionMessage?.text) return content.reactionMessage.text

  if (content.pollCreationMessage?.name) return content.pollCreationMessage.name
  if (content.pollCreationMessageV2?.name) return content.pollCreationMessageV2.name
  if (content.pollCreationMessageV3?.name) return content.pollCreationMessageV3.name

  if (content.eventMessage?.name) return content.eventMessage.name

  if (content.protocolMessage?.editedMessage) {
    return extractText(unwrapMessage(content.protocolMessage.editedMessage))
  }

  if (content.locationMessage) {
    const { degreesLatitude, degreesLongitude, name, address } = content.locationMessage
    const label = name || address
    return label ? `${label} (${degreesLatitude}, ${degreesLongitude})` : `${degreesLatitude}, ${degreesLongitude}`
  }

  return null
}

/** Context info of whatever content type is present. */
export const extractContextInfo = content => {
  if (!content) return {}
  const key = contentKey(content)
  if (key && content[key]?.contextInfo) return content[key].contextInfo
  return content.messageContextInfo ?? {}
}

/**
 * Build a compact description of the quoted message, so plugins can read a
 * replied-to message without re-serializing the whole thing.
 */
export const serializeQuoted = quotedContent => {
  if (!quotedContent) return null
  const content = unwrapMessage(quotedContent)
  if (!content) return null
  const key = contentKey(content)
  return {
    type: FRIENDLY_TYPES[key] ?? 'unknown',
    mtype: key,
    text: extractText(content),
    isMedia: MEDIA_KEYS.has(key),
    mimetype: key ? content[key]?.mimetype : undefined,
    fileName: key ? content[key]?.fileName : undefined,
    message: content,
    raw: quotedContent
  }
}

/**
 * Serialize a raw WAMessage.
 *
 * @param {object} raw             The WAMessage emitted by `messages.upsert`
 * @param {{ meId?: string, meLid?: string }} [options]
 * @returns {object|null} `null` when the message carries no readable content
 */
export const serializeMessage = (raw, { meId = '', meLid = '' } = {}) => {
  if (!raw?.message || !raw?.key) return null

  const key = raw.key
  const chat = safeNormalize(key.remoteJid ?? '')

  if (!chat) return null
  // Status broadcasts and the bot's own presence pings are not commands.
  if (isJidStatusBroadcast(chat)) return null

  // `normalizeMessageContent` strips the view-once and ephemeral wrappers, so
  // the flags have to be read from the raw payload before unwrapping.
  const wrapFlags = {
    viewOnce: Boolean(
      raw.message.viewOnceMessage || raw.message.viewOnceMessageV2 || raw.message.viewOnceMessageV2Extension
    ),
    ephemeral: Boolean(raw.message.ephemeralMessage)
  }

  const content = unwrapMessage(raw.message)
  if (!content) return null

  const mtype = contentKey(content)
  const type = FRIENDLY_TYPES[mtype] ?? 'unknown'

  const isGroup = isJidGroup(chat)
  const isNewsletter = isJidNewsletter(chat)

  const participant = key.participant ? safeNormalize(key.participant) : null
  const participantAlt = key.participantAlt ? safeNormalize(key.participantAlt) : null
  const remoteAlt = key.remoteJidAlt ? safeNormalize(key.remoteJidAlt) : null

  // The address WhatsApp actually used for the sender.
  const sender = isGroup ? participant ?? participantAlt ?? chat : remoteAlt && !key.participant ? remoteAlt : chat

  // Collect every address form we were handed, whatever order they arrive in.
  const addressPool = [participant, participantAlt, chat, remoteAlt].filter(Boolean)
  const senderLid = addressPool.find(jid => isLidUser(jid) || isHostedForm(jid)) ?? null
  const senderPn =
    addressPool.find(jid => isPnUser(jid)) ?? (!isGroup && isPnUser(chat) ? chat : null) ?? null

  const contextInfo = extractContextInfo(content)
  const mentionedJid = Array.isArray(contextInfo.mentionedJid) ? contextInfo.mentionedJid.map(safeNormalize) : []

  const mediaNode = mtype ? content[mtype] : undefined

  return {
    // ── keys ───────────────────────────────────────────────
    key,
    id: key.id,
    fromMe: Boolean(key.fromMe),
    isGroup,
    isNewsletter,
    isPrivate: !isGroup && !isNewsletter,

    // ── addressing ─────────────────────────────────────────
    chat,
    remoteJid: chat,
    remoteJidAlt: remoteAlt,
    participant,
    participantAlt,
    sender,
    senderLid,
    senderPn,
    /** Digits only — never derived from a LID. */
    senderNumber: senderPn ? digitsOf(senderPn) : null,
    mentions: mentionedJid.map(jid => digitsOf(jid)),

    // ── content ────────────────────────────────────────────
    type,
    mtype,
    message: content,
    raw: raw,
    text: extractText(content),
    caption: mediaNode?.caption ?? null,

    isMedia: MEDIA_KEYS.has(mtype),
    isViewOnce: wrapFlags.viewOnce,
    isEphemeral: wrapFlags.ephemeral,
    mimetype: mediaNode?.mimetype ?? null,
    fileName: mediaNode?.fileName ?? null,
    fileLength: mediaNode?.fileLength ? Number(mediaNode.fileLength) : null,
    seconds: mediaNode?.seconds ?? null,
    isForwarded: Boolean(contextInfo.isForwarded),
    isFromChannel: contextInfo.forwardedNewsletterMessageInfo ?? null,

    quoted: serializeQuoted(contextInfo.quotedMessage),
    contextInfo,
    mentionedJid,

    // ── timestamps ─────────────────────────────────────────
    timestamp: Number(raw.messageTimestamp ?? 0) || null,
    pushName: raw.pushName ?? null,

    // ── convenience flags ──────────────────────────────────
    isBotSelf: isBotSelf({ sender, meId, meLid })
  }
}

export default { serializeMessage, serializeQuoted, extractText, unwrapMessage, contentKey }
