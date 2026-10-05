/**
 * KURO — message cache.
 *
 * WhatsApp sometimes asks the sender to re-encrypt a message ("waiting for
 * this message" on the recipient's side). Elaina takes a `getMessage(key)`
 * callback for exactly that. This is a small bounded LRU that the message
 * handler fills and the socket reads.
 */

export class MessageCache {
  constructor(maxEntries = 500) {
    this.maxEntries = Math.max(16, maxEntries)
    this.map = new Map()
  }

  static keyOf(key) {
    if (!key) return null
    const chat = key.remoteJid ?? key.remoteJidAlt ?? ''
    return `${chat}::${key.id ?? ''}`
  }

  /** Store a raw WAMessage (or anything with `.message`). */
  set(key, message) {
    const cacheKey = MessageCache.keyOf(key)
    if (!cacheKey || !message) return null
    if (this.map.has(cacheKey)) this.map.delete(cacheKey)
    this.map.set(cacheKey, message)
    while (this.map.size > this.maxEntries) {
      this.map.delete(this.map.keys().next().value)
    }
    return message
  }

  /** Retrieve the raw message for a key, or `undefined`. */
  get(key) {
    const cacheKey = MessageCache.keyOf(key)
    if (!cacheKey) return undefined
    const hit = this.map.get(cacheKey)
    if (hit === undefined) return undefined
    // Refresh recency.
    this.map.delete(cacheKey)
    this.map.set(cacheKey, hit)
    return hit
  }

  /** The `getMessage` callback shape Elaina expects. */
  asResolver() {
    return async key => {
      const cached = this.get(key)
      return cached?.message ?? undefined
    }
  }

  clear() {
    this.map.clear()
  }

  get size() {
    return this.map.size
  }
}

export const messageCache = new MessageCache()

export default MessageCache
