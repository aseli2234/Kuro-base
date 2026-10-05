/**
 * KURO — LID ↔ PN resolution.
 *
 * Elaina Baileys addresses users by LID as well as by phone-number JID. The
 * authoritative mapping lives in `sock.signalRepository.lidMapping`, which
 * implements `getLIDForPN(pn)` and `getPNForLID(lid)`:
 *
 *   sock.signalRepository.lidMapping.getPNForLID('12345@lid')  // '62812@s.whatsapp.net'
 *   sock.signalRepository.lidMapping.getLIDForPN('62812@s.whatsapp.net')  // '12345@lid'
 *
 * A LID is **not** a phone number and can never be converted into one
 * arithmetically. When no mapping is known these helpers return `null` (or the
 * original value, when the caller asks for it) — never a guess.
 */

import { isLidUser, isPnUser, jidNormalizedUser } from '@rexxhayanasi/elaina-baileys'

/** In-memory memo so a busy group does not re-query the mapping store. */
const CACHE_TTL_MS = 30 * 60 * 1000
const cache = new Map()

const readCache = key => {
  const entry = cache.get(key)
  if (!entry) return undefined
  if (Date.now() - entry.at > CACHE_TTL_MS) {
    cache.delete(key)
    return undefined
  }
  return entry.value
}

const writeCache = (key, value) => {
  cache.set(key, { value, at: Date.now() })
  if (cache.size > 2000) {
    // Simple bound: drop the oldest insertion.
    const oldest = cache.keys().next().value
    cache.delete(oldest)
  }
  return value
}

/** Drop the memo (used after a session change). */
export const clearLidCache = () => cache.clear()

/** Digits of the user part of a JID. */
export const digitsOf = jid => String(jid ?? '').split('@')[0].replace(/\D/g, '')

const safeNormalize = jid => {
  try {
    return jidNormalizedUser(jid)
  } catch {
    return String(jid ?? '')
  }
}

const mappingStore = sock => sock?.signalRepository?.lidMapping ?? null

/**
 * Resolve the phone-number JID for any address form.
 *
 * @param {object} sock  Elaina socket
 * @param {string} jid   `...@lid`, `...@s.whatsapp.net` or `...@hosted`
 * @param {{ db?: object }} [options] Persisted fallback mapping
 * @returns {Promise<string|null>}
 */
export const resolvePN = async (sock, jid, { db = null } = {}) => {
  if (!jid) return null
  const value = safeNormalize(jid)
  if (isPnUser(value)) return value

  const cached = readCache(`pn:${value}`)
  if (cached !== undefined) return cached

  if (!isLidUser(value)) {
    // `@hosted` and `@hosted.lid` forms: only the mapping store can answer.
    const store = mappingStore(sock)
    try {
      const resolved = await store?.getPNForLID?.(value)
      return writeCache(`pn:${value}`, resolved ? safeNormalize(resolved) : null)
    } catch {
      return writeCache(`pn:${value}`, null)
    }
  }

  // 1. Persisted mapping, so owner detection survives a restart.
  if (db) {
    const stored = db.getPnForLid(value)
    if (stored) return writeCache(`pn:${value}`, stored)
  }

  // 2. Ask the library — it consults its cache, the auth keys and finally USync.
  const store = mappingStore(sock)
  try {
    const resolved = await store?.getPNForLID?.(value)
    if (resolved) {
      const normalized = safeNormalize(resolved)
      if (db) db.setLidMapping(value, normalized)
      return writeCache(`pn:${value}`, normalized)
    }
  } catch {
    /* fall through to "unknown" */
  }

  return writeCache(`pn:${value}`, null)
}

/**
 * Resolve the LID for any address form.
 *
 * @returns {Promise<string|null>}
 */
export const resolveLID = async (sock, jid, { db = null } = {}) => {
  if (!jid) return null
  const value = safeNormalize(jid)
  if (isLidUser(value)) return value

  const cached = readCache(`lid:${value}`)
  if (cached !== undefined) return cached

  if (db) {
    const stored = db.getLidForPn(value)
    if (stored) return writeCache(`lid:${value}`, stored)
  }

  const store = mappingStore(sock)
  try {
    const resolved = await store?.getLIDForPN?.(value)
    if (resolved) {
      const normalized = safeNormalize(resolved)
      if (db) db.setLidMapping(normalized, value)
      return writeCache(`lid:${value}`, normalized)
    }
  } catch {
    /* fall through to "unknown" */
  }

  return writeCache(`lid:${value}`, null)
}

/**
 * Resolve a phone number (digits) for a sender that may be addressed by LID.
 * Returns `null` when no mapping is known — never a fabricated number.
 */
export const resolveNumber = async (sock, jid, options = {}) => {
  if (!jid) return null
  const value = safeNormalize(jid)
  if (isPnUser(value)) return digitsOf(value)
  const pn = await resolvePN(sock, value, options)
  return pn ? digitsOf(pn) : null
}

export {
  /** Kept as an alias so plugins can express intent in either direction. */
  digitsOf as numberFromJid
}

export default { resolvePN, resolveLID, resolveNumber, clearLidCache, digitsOf }
