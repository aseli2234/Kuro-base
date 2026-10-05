/**
 * KURO — message handler.
 *
 * The bridge between WhatsApp events and the plugin system:
 *
 *   messages.upsert → serialize → persist → mode & ban gates → parse →
 *   build context → run plugin
 *
 * Every stage is defensive. An exception while handling one message is logged
 * and the next message is processed normally.
 */

import { createContext } from './context.js'
import { PREFIX_MESSAGE, parseCommand, runPlugin } from './command.js'
import { serializeMessage } from '../lib/serializer.js'
import { messageCache } from '../lib/message-cache.js'
import { checkOwner } from './permissions.js'
import { getMessageLogger, bindOutgoingLogger } from '../utils/message-logger.js'

/**
 * Load group metadata, preferring the local cache and refreshing it when the
 * process has nothing stored yet.
 */
const resolveGroupMetadata = async ({ sock, db, jid, logger }) => {
  try {
    const cached = db?.getGroupMetadataCache(jid)
    if (cached?.participants?.length) return cached
  } catch {
    /* cache miss is fine */
  }

  try {
    const metadata = await sock.groupMetadata(jid)
    db?.cacheGroupMetadata(jid, metadata)
    return metadata
  } catch (error) {
    logger?.debug?.(`Could not fetch metadata for ${jid}: ${error.message}`)
    return null
  }
}

/** Should this chat be served at all, given the configured mode? */
const passesMode = ({ mode, m, isOwner }) => {
  if (mode === 'self' || mode === 'private') return isOwner
  if (mode === 'group') return m.isGroup || isOwner
  return true
}

/**
 * Handle one raw WAMessage.
 * @returns {Promise<{ handled: boolean, reason?: string }>}
 */
export const handleMessage = async ({ sock, raw, registry, db, config, logger, channel }) => {
  if (!raw?.message || !raw?.key) return { handled: false, reason: 'empty' }

  // Keep every message reachable for resend requests.
  messageCache.set(raw.key, raw)

  const m = serializeMessage(raw, { meId: sock.user?.id, meLid: sock.user?.lid })
  if (!m) return { handled: false, reason: 'unsupported-content' }

  // Ignore the bot's own messages; a bot that answers itself is a loop.
  if (m.fromMe) return { handled: false, reason: 'from-me' }

  const isOwner = await checkOwner({ sock, config, db, message: m })

  // ── message logger (never blocks or breaks the pipeline) ──
  // One block per message id. Group names come from the database/cache — the
  // logger never queries WhatsApp itself, so a miss prints `Unknown Group`.
  const messageLogger = getMessageLogger()
  if (m.isGroup) {
    messageLogger.rememberGroup(m.chat, db?.getGroupMetadataCache?.(m.chat) ?? null)
  }
  messageLogger.incoming({ m, isOwner, isCommand: false })

  // ── persistence ────────────────────────────────────────────
  try {
    db.ensureUser(
      { jid: m.sender, number: m.senderNumber, lid: m.senderLid, pushName: m.pushName },
      { isOwner }
    )
    if (m.isGroup) {
      db.ensureChat({ jid: m.chat, type: 'group' })
      db.ensureGroup({ jid: m.chat })
    } else {
      db.ensureChat({ jid: m.chat, type: m.isNewsletter ? 'newsletter' : 'private' })
    }
    db.incrementStat('messages_seen')
  } catch (error) {
    logger?.warn?.(`Could not persist message metadata: ${error.message}`)
  }

  const effectiveMode = db?.getSetting?.('bot_mode') ?? config.mode ?? 'public'
  if (!passesMode({ mode: effectiveMode, m, isOwner })) {
    return { handled: false, reason: 'mode' }
  }

  // ── group mute check (owners can always bypass to unmute/run commands) ──
  if (m.isGroup && !isOwner) {
    const groupData = db?.getGroup?.(m.chat)
    const chatData = db?.getChat?.(m.chat)
    const isMuted = groupData?.settings?.muted === true || chatData?.settings?.muted === true
    if (isMuted) {
      return { handled: false, reason: 'group-muted' }
    }
  }

  const parsed = parseCommand(m.text, config.prefix)
  if (!parsed.isCommand || !parsed.command) return { handled: false, reason: 'not-a-command' }

  const record = registry.resolve(parsed.command)
  if (!record) {
    logger?.debug?.(`Unknown command "${parsed.command}" from ${m.sender}`)
    // Only answer in private chats to avoid spamming groups.
    if (m.isPrivate) {
      await sock.sendMessage(m.chat, { text: `Unknown command: ${parsed.command}\n${PREFIX_MESSAGE}` }).catch(() => {})
    }
    return { handled: false, reason: 'unknown-command' }
  }

  const groupMetadata = m.isGroup ? await resolveGroupMetadata({ sock, db, jid: m.chat, logger }) : null

  // Remember the freshly fetched subject so later logs show the group name.
  if (groupMetadata) messageLogger.rememberGroup(m.chat, groupMetadata)

  const ctx = await createContext({
    sock,
    raw,
    m,
    config,
    db,
    registry,
    logger,
    channel,
    groupMetadata,
    parsed
  })

  // A banned user may still be an owner's ally — the ban always wins, except
  // for owners, who need a way back in.
  if (ctx.isBanned && !ctx.isOwner) {
    logger?.info?.(`Ignoring banned user ${m.sender}`)
    return { handled: false, reason: 'banned' }
  }

  const result = await runPlugin({ record, ctx, logger })

  // Refresh the cached admin list after a command that may have changed it.
  if (m.isGroup && /kick|promote|demote|admin/i.test(record.name)) {
    try {
      const fresh = await sock.groupMetadata(m.chat)
      db.cacheGroupMetadata(m.chat, fresh)
    } catch {
      /* non-fatal */
    }
  }

  return { handled: result.ok, reason: result.reason }
}

/**
 * Attach the handler to a socket.
 *
 * @returns {Function} detach function, so a reconnect can clean up
 */
export const registerMessageHandler = ({ sock, registry, db, config, logger, channel }) => {
  // Observe every send through the socket so outgoing messages reach the
  // terminal logger. The wrapper only observes — it never changes a send.
  const detachOutgoing = bindOutgoingLogger(sock)

  const onUpsert = async ({ messages, type }) => {
    // `append` is history backfill and `notify` is live traffic. Backfill is
    // logged as `dup` (dedupe by id) and never answered.
    if (type && type !== 'notify' && type !== 'append') return
    const isBackfill = type === 'append'

    for (const raw of messages ?? []) {
      try {
        if (isBackfill) {
          const m = serializeMessage(raw, { meId: sock.user?.id, meLid: sock.user?.lid })
          if (m && !m.fromMe) {
            getMessageLogger().incoming({ m, isOwner: false, isCommand: false, duplicate: true })
          }
          continue
        }
        await handleMessage({ sock, raw, registry, db, config, logger, channel })
      } catch (error) {
        logger?.error(`Handler failed for ${raw?.key?.id ?? 'unknown'}: ${error.stack ?? error.message}`)
      }
    }
  }

  sock.ev.on('messages.upsert', onUpsert)

  return () => {
    try {
      sock.ev.off?.('messages.upsert', onUpsert)
      sock.ev.removeListener?.('messages.upsert', onUpsert)
      detachOutgoing?.()
    } catch {
      /* the socket may already be gone */
    }
  }
}

export default registerMessageHandler
