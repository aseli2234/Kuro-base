/**
 * KURO — channel / newsletter helper.
 *
 * Elaina posts to a WhatsApp Channel with the ordinary send path: a
 * `@newsletter` JID is routed to the newsletter stanza form inside
 * `relayMessage`, so `sock.sendMessage(jid, content)` is all that is needed.
 *
 * Everything else (metadata, react, follow) uses the dedicated
 * `sock.newsletter*` methods the library exposes.
 */

import { isJidNewsletter } from '@rexxhayanasi/elaina-baileys'

export class ChannelHelper {
  /**
   * @param {{ sock: object, config: object, logger?: object, db?: object }} options
   */
  constructor({ sock, config, logger = null, db = null }) {
    this.sock = sock
    this.config = config?.channel ?? { enabled: false, jid: '', name: '' }
    this.logger = logger
    this.db = db
  }

  /** Re-bind after a reconnect; the socket object is replaced each time. */
  bind(sock) {
    this.sock = sock
    return this
  }

  get enabled() {
    return Boolean(this.config?.enabled && isJidNewsletter(this.jid))
  }

  get jid() {
    return this.config?.jid ?? ''
  }

  get name() {
    return this.config?.name || this.jid
  }

  /** Throw a descriptive error when the channel is not usable. */
  assertReady() {
    if (!this.config?.enabled) {
      throw new Error('The channel/newsletter feature is disabled — set `channel.enabled: true` in settings.js.')
    }
    if (!isJidNewsletter(this.jid)) {
      throw new Error(`channel.jid must end with @newsletter, got "${this.jid}"`)
    }
    if (!this.sock) throw new Error('No socket bound to the channel helper yet.')
  }

  /**
   * Post any message content to the channel.
   * @see https://www.npmjs.com/package/@rexxhayanasi/elaina-baileys — the
   *      newsletter send path accepts the same content objects as a normal send.
   */
  async send(content, options = {}) {
    this.assertReady()
    const result = await this.sock.sendMessage(this.jid, content, options)
    this.logger?.info?.(`Posted to channel ${this.name}`)
    return result
  }

  /** Post plain text. */
  async sendText(text, options = {}) {
    return this.send({ text: String(text ?? '') }, options)
  }

  /** React to a channel message by its `server_id`. */
  async react(serverId, emoji = '') {
    this.assertReady()
    return this.sock.newsletterReactMessage(this.jid, String(serverId), emoji ?? '')
  }

  /** Fetch the channel metadata (name, description, picture, subscriber count). */
  async info() {
    this.assertReady()
    return this.sock.newsletterMetadata('jid', this.jid)
  }

  /** Follow the channel from the bot's own account. */
  async follow() {
    this.assertReady()
    return this.sock.newsletterFollow(this.jid)
  }

  /** Unfollow the channel. */
  async unfollow() {
    this.assertReady()
    return this.sock.newsletterUnfollow(this.jid)
  }

  /** Read the latest posts. */
  async posts({ type = 'jid', count = 20, after, before } = {}) {
    this.assertReady()
    return this.sock.newsletterFetchMessages(type, this.jid, count, after, before)
  }
}

export const createChannelHelper = options => new ChannelHelper(options)

export default ChannelHelper
