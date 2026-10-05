/**
 * KURO — messaging helpers.
 *
 * Thin wrappers over the Elaina socket methods KURO relies on. They exist so a
 * plugin never has to remember the exact option shape, and so every send path
 * in the bot is easy to audit.
 *
 * Everything funnels through `sock.sendMessage(jid, content, options)`, which
 * also handles newsletter (`@newsletter`) destinations natively.
 */

import { downloadMediaMessage, getContentType, normalizeMessageContent } from '@rexxhayanasi/elaina-baileys'
import { runWithSendContext } from '../utils/message-logger.js'

/**
 * Run `fn` with a logging context so every message sent inside it is tagged
 * with the plugin/command that produced it in the terminal log.
 *
 * @param {string} plugin  Plugin (command) name, e.g. `menu`
 * @param {Function} fn    The work to run
 */
export const withPluginContext = (plugin, fn) => runWithSendContext({ plugin }, fn)

/**
 * Send any content to any destination.
 *
 * @param {object} sock
 * @param {string} jid
 * @param {object} content  e.g. `{ text: 'hi' }`, `{ richLink: {...} }`
 * @param {object} [options] `{ quoted, mentions, ephemeralExpiration, ... }`
 */
export const sendMessage = (sock, jid, content, options = {}) => sock.sendMessage(jid, content, options)

/** Send plain text. */
export const sendText = (sock, jid, text, options = {}) => sock.sendMessage(jid, { text: String(text ?? '') }, options)

/** Send media by URL, Buffer or local path. */
export const sendMedia = (sock, jid, media, options = {}) =>
  sock.sendMessage(jid, { ...media }, options)

/**
 * Edit a message that is already on screen.
 *
 * Elaina exposes this through the ordinary send path: pass the original key in
 * `edit` and the new body alongside it.
 */
export const editMessage = (sock, jid, key, content, options = {}) =>
  sock.sendMessage(jid, { ...content, edit: key }, options)

/** React to a message (empty string removes the reaction). */
export const reactToMessage = (sock, key, emoji = '') => {
  if (!key) return null
  return sock.sendMessage(key.remoteJid, { react: { text: emoji ?? '', key } })
}

/** Remove a reaction. */
export const unreactToMessage = (sock, key) => reactToMessage(sock, key, '')

/** Mark messages as read (blue ticks). */
export const markRead = (sock, keys = []) => {
  const list = (Array.isArray(keys) ? keys : [keys]).filter(Boolean)
  if (!list.length) return null
  try {
    return sock.readMessages?.(list) ?? null
  } catch {
    return null
  }
}

/** Show "typing…" / "recording…" in a chat. */
export const sendPresence = (sock, jid, presence = 'composing', options = {}) => {
  if (!jid) return null
  try {
    return sock.sendPresenceUpdate?.(presence, jid, options) ?? null
  } catch {
    return null
  }
}

/**
 * Download the media attached to a message.
 *
 * @returns {Promise<Buffer|null>} `null` when the message has no media or the
 *   download failed — callers should not have to try/catch for the common case.
 */
export const downloadMedia = async (sock, message, options = {}) => {
  const raw = message?.raw ?? message
  if (!raw) return null
  try {
    const msg = raw.message ?? raw
    const content = normalizeMessageContent(msg) ?? msg
    const type = getContentType(content)
    if (!type || !type.includes('Message')) return null
    return await downloadMediaMessage({ ...raw, message: content }, 'buffer', options, {
      logger: options.logger,
      reuploadRequest: sock?.updateMediaMessage
    })
  } catch (error) {
    options.logger?.debug?.(`media download failed: ${error?.message}`)
    return null
  }
}

/**
 * Download the media of a *quoted* (replied-to) message.
 *
 * A quoted message carries its content but no wire key of its own, so the
 * parent message's key is reused — the media reference (`mediaKey`, `url`,
 * `directPath`) lives inside the quoted content itself.
 *
 * @returns {Promise<Buffer|null>}
 */
export const downloadQuotedMedia = async (sock, message, options = {}) => {
  const raw = message?.raw ?? message
  const quotedContent = raw?.message
  if (!raw?.key || !quotedContent) return null
  return downloadMedia(sock, { raw: { ...raw, message: quotedContent } }, options)
}

/** Reply to a message, keeping the quote. */
export const reply = (sock, message, content, options = {}) => {
  const jid = message?.chat ?? message?.key?.remoteJid
  const quoted = message?.raw ?? message
  return sock.sendMessage(jid, content, { quoted, ...options })
}

/**
 * Normalise a `mentions` shorthand into the JID array Elaina expects.
 * Accepts JIDs, `@lid` addresses, digits, or the serialized message's
 * `mentionedJid`.
 */
export const toMentionJids = values => {
  const list = Array.isArray(values) ? values : [values]
  return list
    .filter(Boolean)
    .map(value => String(value))
    .map(value => (value.includes('@') ? value : `${value.replace(/\D/g, '')}@s.whatsapp.net`))
}

export default {
  sendMessage,
  sendText,
  sendMedia,
  editMessage,
  reactToMessage,
  unreactToMessage,
  markRead,
  sendPresence,
  downloadMedia,
  downloadQuotedMedia,
  reply,
  toMentionJids,
  withPluginContext
}
