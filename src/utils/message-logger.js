/**
 * KURO — terminal message logger.
 *
 * Every message in and out is printed as one closed, self-contained block so
 * that a burst of messages never smears into an unreadable wall of text:
 *
 *   ╭──────────────────────────────────────────────
 *   │ 📩 INCOMING MESSAGE
 *   ├──────────────────────────────────────────────
 *   │ 🕒 Time     : 21:35:42
 *   │ 👤 Sender   : Galang
 *   │ 📱 Number   : 628xxxxxxxxxx
 *   │ 💬 Chat     : PRIVATE CHAT
 *   │ 🏷️ Type     : conversation
 *   │ 🔖 Message  : TEXT
 *   │ 👑 Owner    : YES
 *   ├──────────────────────────────────────────────
 *   │ 📝 Content:
 *   │ Halo bot, ini pesan percobaan.
 *   ╰──────────────────────────────────────────────
 *
 * Rules enforced here:
 *   - timestamps follow `settings.timezone`, never the server clock
 *   - owners are marked (resolved server-side, never from text)
 *   - media content is never printed — only its type and a safe descriptor
 *   - message bodies are printed in FULL (no silent substring cuts), wrapped
 *     to the terminal width with a consistent `│ ` indent
 *   - group names come from a cache/database; a miss shows `Unknown Group`
 *     plus the JID instead of blocking the message path on a WhatsApp query
 *   - blocks are written through a serializing queue, so concurrent messages
 *     stay whole and never interleave
 *   - every step is defensive; a logging failure can never interrupt message
 *     processing
 */

import { AsyncLocalStorage } from 'node:async_hooks'
import { clockTime } from './time.js'
import { formatBytes } from './format.js'

// ── terminal colours ─────────────────────────────────────────────────────────

const COLOR = {
  reset: '\u001b[0m',
  red: '\u001b[31m',
  green: '\u001b[32m',
  yellow: '\u001b[33m',
  blue: '\u001b[34m',
  magenta: '\u001b[35m',
  cyan: '\u001b[36m',
  white: '\u001b[37m',
  gray: '\u001b[90m'
}

// ── message type tables ──────────────────────────────────────────────────────

/** Readable kind for a content object (`imageMessage` → `image`). */
const FRIENDLY_TYPES = {
  conversation: 'text',
  extendedTextMessage: 'text',
  imageMessage: 'image',
  videoMessage: 'video',
  audioMessage: 'audio',
  pttMessage: 'voice',
  ptvMessage: 'video',
  documentMessage: 'document',
  documentWithCaptionMessage: 'document',
  stickerMessage: 'sticker',
  contactMessage: 'contact',
  contactsArrayMessage: 'contacts',
  locationMessage: 'location',
  liveLocationMessage: 'live-location',
  pollCreationMessage: 'poll',
  pollCreationMessageV2: 'poll',
  pollCreationMessageV3: 'poll',
  reactionMessage: 'reaction',
  protocolMessage: 'protocol',
  buttonsResponseMessage: 'button-reply',
  templateButtonReplyMessage: 'button-reply',
  listResponseMessage: 'list-reply',
  interactiveResponseMessage: 'interactive-reply',
  eventMessage: 'event',
  productMessage: 'product',
  orderMessage: 'order',
  albumMessage: 'album'
}

/** Wire-level content classification for the `🔖 Message` / `🔖 Content` row. */
const CONTENT_TYPES = {
  conversation: 'TEXT',
  extendedTextMessage: 'TEXT',
  imageMessage: 'IMAGE',
  videoMessage: 'VIDEO',
  pttMessage: 'VOICE',
  ptvMessage: 'VIDEO',
  audioMessage: 'AUDIO',
  documentMessage: 'DOCUMENT',
  documentWithCaptionMessage: 'DOCUMENT',
  stickerMessage: 'STICKER',
  contactMessage: 'CONTACT',
  contactsArrayMessage: 'CONTACTS',
  locationMessage: 'LOCATION',
  liveLocationMessage: 'LIVE LOCATION',
  pollCreationMessage: 'POLL',
  pollCreationMessageV2: 'POLL',
  pollCreationMessageV3: 'POLL',
  reactionMessage: 'REACTION',
  protocolMessage: 'PROTOCOL',
  buttonsResponseMessage: 'BUTTON REPLY',
  templateButtonReplyMessage: 'BUTTON REPLY',
  listResponseMessage: 'LIST REPLY',
  interactiveResponseMessage: 'INTERACTIVE REPLY',
  eventMessage: 'EVENT',
  productMessage: 'PRODUCT',
  orderMessage: 'ORDER',
  albumMessage: 'ALBUM',
  viewOnceMessage: 'VIEW ONCE',
  viewOnceMessageV2: 'VIEW ONCE',
  ephemeralMessage: 'EPHEMERAL',
  editedMessage: 'EDITED'
}

/** Envelope types WhatsApp wraps real content in. */
const WRAPPER_TYPES = new Set([
  'ephemeralMessage',
  'viewOnceMessage',
  'viewOnceMessageV2',
  'viewOnceMessageV2Extension',
  'viewOnceReplayMessage',
  'editedMessage',
  'documentWithCaptionMessage'
])

/** Readable type name for any content object. */
export const friendlyType = content => {
  if (!content || typeof content !== 'object') return 'unknown'
  const key = rawContentType(content)
  return FRIENDLY_TYPES[key] ?? (key ? key.replace(/Message$/, '').toLowerCase() : 'unknown')
}

/**
 * The actual top-level content key of a raw message object — e.g.
 * `conversation`, `extendedTextMessage`, `imageMessage`. Read from the object
 * itself, never guessed from the text.
 */
export const rawContentType = message => {
  if (!message || typeof message !== 'object') return null
  return (
    Object.keys(message).find(
      key => key === 'conversation' || (key.includes('Message') && key !== 'senderKeyDistributionMessage')
    ) ?? null
  )
}

/** `imageMessage` → `IMAGE` — the wire-level classification for the 🔖 row. */
export const contentTypeOf = key =>
  CONTENT_TYPES[key] ?? (key ? key.replace(/Message$/, '').toUpperCase() : 'UNKNOWN')

/**
 * The type row for a message: the envelope type and, when wrapped, the real
 * content type behind it — `ephemeralMessage → imageMessage`.
 */
export const displayType = ({ outerKey = null, innerKey = null } = {}) => {
  if (outerKey && WRAPPER_TYPES.has(outerKey)) {
    return innerKey && innerKey !== outerKey ? `${outerKey} → ${innerKey}` : outerKey
  }
  return innerKey ?? outerKey ?? 'unknown'
}

// ── send-context propagation (plugin name for outgoing logs) ─────────────────

const sendContext = new AsyncLocalStorage()

/** Run `fn` tagged with a log context (plugin/command) for outgoing logging. */
export const runWithSendContext = (context, fn) => sendContext.run(context ?? {}, fn)

/** The context of the currently running plugin, or `null`. */
export const currentSendContext = () => sendContext.getStore() ?? null

// ── helpers ──────────────────────────────────────────────────────────────────

/**
 * Patterns that look like credentials — redacted before printing a body.
 * Only *safely recognizable* secrets are masked: a `bearer …` token and a
 * very long base64-shaped blob (mixed case + digits). Ordinary long words
 * are never touched — the full message body must stay visible.
 */
const redactSecrets = text =>
  String(text ?? '')
    .replace(/bearer\s+\S+/gi, 'bearer [redacted]')
    .replace(/\b(?=[A-Za-z0-9+/]*\d)(?=[A-Za-z0-9+/]*[A-Z])(?=[A-Za-z0-9+/]*[a-z])[A-Za-z0-9+/]{120,}={0,2}\b/g, '[redacted]')

/** `62812…@s.whatsapp.net` → `62812…`, groups keep their short form. */
const shortJid = jid => {
  const value = String(jid ?? '')
  const [user, server] = value.split('@')
  if (!server) return value
  if (server === 'g.us') return `${user.slice(0, 10)}…@g.us`
  if (server === 'newsletter') return `${user.slice(0, 10)}…@newsletter`
  if (server === 'lid') return `${user.slice(0, 10)}…@lid`
  return `${user.split(':')[0]}@${server === 's.whatsapp.net' ? '…' : server}`
}

/** Wrap one logical line to `width` columns, keeping words where possible. */
const wrapLine = (text, width) => {
  const value = String(text ?? '')
  if (!Number.isFinite(width) || width < 20 || value.length <= width) return [value]

  const lines = []
  let rest = value
  while (rest.length > width) {
    let cut = rest.lastIndexOf(' ', width)
    if (cut <= 0) cut = width
    lines.push(rest.slice(0, cut))
    rest = rest.slice(cut).replace(/^ +/, '')
  }
  if (rest.length) lines.push(rest)
  return lines
}

// ── the logger ───────────────────────────────────────────────────────────────

export class MessageLogger {
  /**
   * @param {object} options
   * @param {object} options.config   Central config (`messageLog`, `timezone`, `botName`)
   * @param {object} [options.logger] Base logger for warnings
   * @param {object} [options.stream] Writable stream (defaults to process.stdout)
   */
  constructor({ config, logger = null, stream = null } = {}) {
    this.config = config ?? {}
    this.logger = logger
    this.stream = stream ?? process.stdout
    /** jid → { name, members } cache, filled opportunistically. */
    this.groupCache = new Map()
    /** Message ids already logged this session (reconnect dedupe). */
    this.seen = new Set()
    /** Serializes block writes so concurrent messages never interleave. */
    this.queue = Promise.resolve()
  }

  /** Merge the runtime `messageLog` switches. */
  get options() {
    return this.config?.messageLog ?? {}
  }

  get enabled() {
    return this.options.enabled !== false
  }

  /** Honour `useColors`, `NO_COLOR`, `FORCE_COLOR` and non-TTY streams. */
  get useColor() {
    if (this.options.useColors === false) return false
    if (process.env.NO_COLOR) return false
    if (process.env.FORCE_COLOR) return true
    return Boolean(this.stream?.isTTY)
  }

  /** Terminal width, clamped to a sane range. */
  width() {
    const columns = Number(this.stream?.columns)
    if (Number.isFinite(columns) && columns >= 40) return Math.min(columns, 100)
    return 80
  }

  /** Remember a group's metadata for nicer logs (fire-and-forget). */
  rememberGroup(jid, metadata) {
    if (!jid || !metadata) return
    this.groupCache.set(jid, {
      name: metadata.subject ?? '',
      members: Array.isArray(metadata.participants) ? metadata.participants.length : 0
    })
    if (this.groupCache.size > 500) {
      const oldest = this.groupCache.keys().next().value
      this.groupCache.delete(oldest)
    }
  }

  /** Look up a cached group name, or `null` — the caller decides the fallback. */
  groupName(jid) {
    return this.groupCache.get(jid)?.name ?? null
  }

  // ── block primitives ───────────────────────────────────────────────────────

  /** One metadata row: `│ 🕒 Time     : value`. */
  row(icon, label, value, color = null) {
    const line = `│ ${icon} ${String(label).padEnd(9, ' ')}: ${value}`
    return this.useColor && color ? `${color}${line}${COLOR.reset}` : line
  }

  /** `╭────` / `├────` / `╰────` separators. */
  border(kind = '─') {
    const line = `${kind}${'─'.repeat(this.width())}`
    return this.useColor ? `${COLOR.gray}${line}${COLOR.reset}` : line
  }

  /** Free-form row starting with the `│ ` indent. */
  line(text, color = null) {
    const value = `│ ${text}`
    return this.useColor && color ? `${color}${value}${COLOR.reset}` : value
  }

  /**
   * The content section: header plus the full body, wrapped to the terminal
   * width with a consistent indent. Nothing is ever cut away.
   */
  contentSection(text, { multiline = true, wrap = true } = {}) {
    const rows = [this.line('📝 Content:', COLOR.cyan)]
    if (text === null || text === undefined || text === '') {
      rows.push(this.line('(no text content)', COLOR.gray))
      return rows
    }

    const body = redactSecrets(text)
    const lines = multiline ? body.split(/\r?\n/) : [body.replace(/\r?\n/g, ' / ')]
    const wrapWidth = this.width() - 2

    for (const logical of lines) {
      const physical = wrap && multiline ? wrapLine(logical, wrapWidth) : [logical]
      for (const piece of physical) rows.push(this.line(piece))
    }
    return rows
  }

  /** A safe, human description of a media payload — never its binary. */
  mediaDescriptor({ type = null, mimetype = null, fileLength = null, seconds = null, fileName = null, flags = [] } = {}) {
    const parts = [type ? `[${type}]` : '[media]']
    if (mimetype) parts.push(String(mimetype))
    const bytes = Number(fileLength)
    if (Number.isFinite(bytes) && bytes > 0) parts.push(formatBytes(bytes))
    const secs = Number(seconds)
    if (Number.isFinite(secs) && secs > 0) parts.push(`${Math.round(secs)}s`)
    if (fileName) parts.push(String(fileName))
    for (const flag of flags) if (flag) parts.push(flag)
    return parts.join(' · ')
  }

  /**
   * Emit one finished block, followed by a blank line.
   *
   * `write` is synchronous, so blocks can never interleave — JavaScript runs
   * the writers one at a time. The promise chain is kept so callers that
   * need to wait for the output (tests) can `await logger.queue`.
   */
  emit(rows) {
    const block = rows.join('\n')
    try {
      this.write(block)
    } catch {
      /* never break message processing for a log line */
    }
    this.queue = this.queue.then(() => {}).catch(() => {})
    return this.queue
  }

  write(block) {
    try {
      this.stream?.write?.(`${block}\n\n`)
    } catch {
      /* stdout gone — never break message processing for a log line */
    }
  }

  // ── incoming ───────────────────────────────────────────────────────────────

  /** True when the message id has been logged before (reconnect dedupe). */
  isDuplicate(id) {
    if (!id) return false
    if (this.seen.has(id)) return true
    this.seen.add(id)
    if (this.seen.size > 3000) {
      const oldest = this.seen.values().next().value
      this.seen.delete(oldest)
    }
    return false
  }

  /**
   * Log one incoming message as a boxed block.
   *
   * @param {object} options
   * @param {object} options.m              Serialized message (src/lib/serializer.js)
   * @param {boolean} [options.isOwner]     Resolved server-side
   * @param {boolean} [options.isCommand]   Parser matched a command
   * @param {string}  [options.command]     Command name, when `isCommand`
   * @param {boolean} [options.duplicate]   Already handled in a previous session
   * @param {string|null} [options.groupName] Group subject from metadata/cache
   */
  incoming({ m, isOwner = false, isCommand = false, command = null, duplicate = false, groupName = null } = {}) {
    if (!this.enabled || !m) return
    // One id is logged exactly once — a backfill (duplicate) or a re-delivery
    // after reconnect never prints a second block.
    if (this.isDuplicate(m.id)) return

    try {
      const opts = this.options
      const chatKind = m.isGroup ? 'GROUP' : m.isNewsletter ? 'CHANNEL' : 'PRIVATE CHAT'
      const outerKey = rawContentType(m.raw?.message ?? m.raw) ?? m.mtype ?? null
      const typeText = opts.showMediaType !== false ? displayType({ outerKey, innerKey: m.mtype ?? outerKey }) : null
      const contentKind = opts.showMessageType !== false ? contentTypeOf(outerKey ?? m.mtype) : null

      const rows = [this.border('╭'), this.line('📩 INCOMING MESSAGE', COLOR.cyan), this.border('├')]

      if (opts.showTimestamp !== false) {
        rows.push(this.row('🕒', 'Time', clockTime(this.config?.timezone)))
      }

      if (opts.showSender !== false) {
        const name = m.pushName || m.senderNumber || shortJid(m.sender)
        rows.push(this.row('👤', 'Sender', String(name)))
        const number = m.senderNumber ?? (m.sender ? shortJid(m.sender) : 'unknown')
        rows.push(this.row('📱', 'Number', String(number)))
      }

      rows.push(this.row('💬', 'Chat', chatKind))

      if (m.isGroup) {
        const label = opts.showGroupName !== false ? groupName ?? this.groupName(m.chat) ?? 'Unknown Group' : 'hidden'
        rows.push(this.row('🏠', 'Group', label))
        rows.push(this.row('🆔', 'Group ID', shortJid(m.chat) || 'unknown'))
      } else {
        rows.push(this.row('🆔', 'Chat ID', shortJid(m.chat) || 'unknown'))
      }

      if (typeText) rows.push(this.row('🏷️', 'Type', typeText, COLOR.yellow))
      if (contentKind) rows.push(this.row('🔖', 'Message', contentKind))
      if (isCommand && command) rows.push(this.row('📌', 'Command', String(command)))
      rows.push(
        this.row('👑', 'Owner', isOwner ? 'YES' : 'NO', isOwner ? COLOR.green : COLOR.gray)
      )

      rows.push(this.border('├'))

      if (opts.showContent !== false) {
        const body =
          m.text ??
          this.mediaDescriptor({
            type: friendlyType(m.message),
            mimetype: m.mimetype,
            fileLength: m.fileLength,
            seconds: m.seconds,
            fileName: m.fileName,
            flags: [m.isViewOnce && 'view-once', m.isEphemeral && 'ephemeral']
          })
        rows.push(...this.contentSection(body, { multiline: opts.multiline !== false, wrap: opts.wrapText !== false }))
      } else {
        rows.push(this.line('📝 Content: (hidden)', COLOR.gray))
      }

      rows.push(this.border('╰'))
      this.emit(rows)
    } catch (error) {
      this.fail(error)
    }
  }

  // ── outgoing ───────────────────────────────────────────────────────────────

  /**
   * Log one outgoing message as a boxed block.
   *
   * @param {object} options
   * @param {string} options.jid        Destination chat
   * @param {object|string} [options.content] What was sent
   * @param {string} [options.type]     Override the derived type
   * @param {string} [options.plugin]   Plugin/command name, when known
   * @param {boolean} [options.ok]      Delivery succeeded (default true)
   * @param {string} [options.error]    Failure reason, when `ok` is false
   */
  outgoing({ jid, content = null, type = null, plugin = null, ok = true, error = null } = {}) {
    if (!this.enabled || !jid) return
    if (this.options.showOutgoing === false) return

    try {
      const opts = this.options
      const context = currentSendContext()
      const pluginName = plugin ?? context?.plugin ?? null
      const isGroup = String(jid).endsWith('@g.us')

      const outerKey = typeof content === 'string' ? null : rawContentType(content)
      const typeText =
        type ?? (opts.showMediaType !== false ? outerKey ?? (typeof content === 'string' || content?.text ? 'text' : 'unknown') : null)
      const contentKind = opts.showMessageType !== false && outerKey ? contentTypeOf(outerKey) : null

      const bodyText =
        opts.showContent === false
          ? null
          : typeof content === 'string'
            ? content
            : typeof content?.text === 'string' && content.text
              ? content.text
              : null

      const rows = [this.border('╭'), this.line('📤 OUTGOING MESSAGE', COLOR.green), this.border('├')]

      if (opts.showTimestamp !== false) {
        rows.push(this.row('🕒', 'Time', clockTime(this.config?.timezone)))
      }

      rows.push(this.row('🤖', 'Bot', String(this.config?.botName ?? 'KURO')))
      rows.push(this.row('💬', 'Chat', isGroup ? 'GROUP' : 'PRIVATE CHAT'))

      if (isGroup) {
        const label = opts.showGroupName !== false ? this.groupName(jid) ?? 'Unknown Group' : 'hidden'
        rows.push(this.row('🏠', 'Group', label))
        rows.push(this.row('🆔', 'Target', shortJid(jid) || 'unknown'))
      } else {
        rows.push(this.row('🆔', 'Target', shortJid(jid) || 'unknown'))
      }

      if (typeText) rows.push(this.row('🏷️', 'Type', String(typeText), COLOR.yellow))
      if (contentKind) rows.push(this.row('🔖', 'Content', contentKind))
      if (pluginName) rows.push(this.row('🔧', 'Plugin', String(pluginName)))
      rows.push(
        this.row('📊', 'Status', ok ? 'SENT' : 'FAILED', ok ? COLOR.green : COLOR.red)
      )

      rows.push(this.border('├'))

      if (opts.showContent !== false) {
        const body = bodyText ?? this.mediaDescriptor({ type: typeof content === 'object' && content ? friendlyType(content) : null })
        if (body) {
          rows.push(...this.contentSection(body, { multiline: opts.multiline !== false, wrap: opts.wrapText !== false }))
        } else {
          rows.push(this.line('📝 Content: (no text content)', COLOR.gray))
        }
      } else {
        rows.push(this.line('📝 Content: (hidden)', COLOR.gray))
      }

      if (!ok && error) {
        rows.push(this.line(`❌ ${redactSecrets(String(error)).slice(0, 300)}`, COLOR.red))
      }

      rows.push(this.border('╰'))
      this.emit(rows)
    } catch (err) {
      this.fail(err)
    }
  }

  fail(error) {
    try {
      this.logger?.debug?.(`message logger failed: ${error?.message}`)
    } catch {
      /* ignore */
    }
  }

  /** Test helper: forget the dedupe history. */
  reset() {
    this.seen.clear()
  }
}

const messageLogger = new MessageLogger({ config: null, logger: null })

/** Bind the runtime config (called from the entrypoint at boot). */
export const bindMessageLogger = (config, logger = null) => {
  messageLogger.config = config
  messageLogger.logger = logger
  return messageLogger
}

export const getMessageLogger = () => messageLogger

/**
 * Attach send/relay observers to a socket so every outgoing message produced
 * by the central sender is logged. The wrappers never change what is sent —
 * they only observe the result.
 *
 * @param {object} sock Live Elaina socket
 * @returns {Function} detach function
 */
export const bindOutgoingLogger = sock => {
  if (!sock || sock.__kuroOutgoingBound) return () => {}
  if (typeof sock.sendMessage !== 'function') return () => {}
  sock.__kuroOutgoingBound = true

  const originalSend = sock.sendMessage.bind(sock)
  /** Wrapped sender — observed, never altered. */
  const wrappedSend = async (jid, content, options = {}) => {
    // Reactions and edits are protocol updates, not messages — skip them.
    const isProtocol =
      content && typeof content === 'object' && !Array.isArray(content) &&
      (content.react !== undefined || content.edit !== undefined || content.delete !== undefined)

    try {
      const result = await originalSend(jid, content, options)
      if (!isProtocol) messageLogger.outgoing({ jid, content, ok: true })
      return result
    } catch (error) {
      if (!isProtocol) messageLogger.outgoing({ jid, content, ok: false, error: error?.message })
      throw error
    }
  }

  wrappedSend.wrapped = true
  sock.sendMessage = wrappedSend

  return () => {
    try {
      if (sock.sendMessage === wrappedSend) sock.sendMessage = originalSend
      sock.__kuroOutgoingBound = false
    } catch {
      /* the socket may already be gone */
    }
  }
}

export default messageLogger
