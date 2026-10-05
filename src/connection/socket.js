/**
 * KURO — socket factory.
 *
 * Wraps `makeWASocket` from Elaina Baileys with KURO's defaults. Every option
 * below is documented in the library's README; the two that matter most here:
 *
 *   getMessage              answers resend requests. Without it, a recipient
 *                           can be left on "waiting for this message".
 *   generateHighQualityLinkPreview
 *                           makes the server-side link preview full size.
 *
 * The connection lifecycle (open/close/reconnect) lives in
 * `src/connection/index.js`; this file only builds the socket.
 */

import makeWASocket, { fetchLatestBaileysVersion, makeCacheableSignalKeyStore } from '@rexxhayanasi/elaina-baileys'
import { createSocketLogger } from '../utils/logger.js'
import { messageCache } from '../lib/message-cache.js'

/** Latest WhatsApp Web version advertised by the library, with a safe fallback. */
const resolveVersion = async logger => {
  try {
    const { version, isLatest } = await fetchLatestBaileysVersion()
    logger?.debug?.(`WhatsApp Web version ${version.join('.')}${isLatest ? ' (latest)' : ''}`)
    return version
  } catch (error) {
    logger?.warn?.(`Could not fetch the latest WhatsApp Web version, using the pinned one: ${error.message}`)
    return undefined
  }
}

/**
 * Build a socket.
 *
 * @param {object} options
 * @param {object} options.auth     `{ state, saveCreds }` from `createAuthState()`
 * @param {object} options.config   Central KURO config
 * @param {object} [options.logger] KURO logger
 * @returns {Promise<object>} the Elaina socket
 */
export const createSocket = async ({ auth, config, logger }) => {
  const version = await resolveVersion(logger)
  const connection = config?.connection ?? {}

  const sock = makeWASocket({
    auth: {
      creds: auth.state.creds,
      // Caching the Signal key store keeps large sessions responsive.
      keys: makeCacheableSignalKeyStore(auth.state.keys, createSocketLogger('error'))
    },
    version,
    logger: createSocketLogger('error'),
    browser: connection.browser,
    markOnlineOnConnect: connection.markOnlineOnConnect ?? false,
    syncFullHistory: connection.syncFullHistory ?? false,
    generateHighQualityLinkPreview: true,
    getMessage: messageCache.asResolver(),
    // Let reconnects be driven by KURO's backoff instead of falling back to QR.
    connectTimeoutMs: 20000,
    keepAliveIntervalMs: 15000,
    defaultQueryTimeoutMs: 60000,
    emitOwnEvents: true
  })

  return sock
}

export default createSocket
