/**
 * KURO — database helpers.
 *
 * Pure functions only: no connection, no state. They exist so the schema,
 * migrations and manager all marshal columns the same way.
 */

/** Current time as an ISO-8601 string, the only date format stored. */
export const nowIso = () => new Date().toISOString()

/**
 * Strip the device suffix from a JID.
 *
 * `62812:12@s.whatsapp.net` → `62812@s.whatsapp.net`
 * `12345:3@lid`             → `12345@lid`
 * The server part is preserved so LID, group and newsletter JIDs survive.
 */
export const normalizeJid = jid => {
  const value = String(jid ?? '').trim()
  if (!value.includes('@')) return value
  const [userPart, serverPart] = value.split('@')
  if (!serverPart) return value
  const user = userPart.split(':')[0]
  const server = serverPart.split(':')[0]
  return `${user}@${server}`
}

/** Digits of the user portion of a JID, or an empty string. */
export const jidNumber = jid => normalizeJid(jid).split('@')[0].replace(/\D/g, '')

/** Safe JSON serialisation for TEXT columns. */
export const toJson = value => {
  try {
    return JSON.stringify(value ?? {})
  } catch {
    return '{}'
  }
}

/** Safe JSON parsing for TEXT columns, with a fallback on corrupt data. */
export const fromJson = (value, fallback = {}) => {
  if (value === null || value === undefined || value === '') return fallback
  if (typeof value === 'object') return value
  try {
    return JSON.parse(value)
  } catch {
    return fallback
  }
}

/** SQLite has no boolean type; integers round-trip as booleans here. */
export const toBool = value => value === true || value === 1 || value === '1'
export const fromBool = value => (value ? 1 : 0)

export default {
  nowIso,
  normalizeJid,
  jidNumber,
  toJson,
  fromJson,
  toBool,
  fromBool
}
