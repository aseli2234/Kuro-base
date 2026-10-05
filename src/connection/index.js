/**
 * KURO — connection manager.
 *
 * Owns the whole WhatsApp lifecycle:
 *
 *   start → auth state → socket → (pair if needed) → connection.update
 *                                                        ├── open  → ready
 *                                                        ├── close → backoff reconnect
 *                                                        └── fatal → stop, tell the owner
 *
 * Reconnect policy:
 *   - `loggedOut` / `badSession`  → never auto-reconnect; the session is gone
 *   - `connectionReplaced`        → another device took the slot; stop
 *   - `restartRequired`           → immediate reconnect, no backoff
 *   - anything else               → bounded exponential backoff with jitter
 */

import { EventEmitter } from 'node:events'
import { DisconnectReason } from '@rexxhayanasi/elaina-baileys'
import { clearUnfinishedPairing, createAuthState, destroySession, sessionExists } from './auth.js'
import { requestPairing } from './pairing.js'
import { createSocket } from './socket.js'
import { ReconnectStrategy } from './reconnect.js'

const STATUS = {
  [DisconnectReason.loggedOut]: 'loggedOut',
  [DisconnectReason.badSession]: 'badSession',
  [DisconnectReason.connectionReplaced]: 'connectionReplaced',
  [DisconnectReason.restartRequired]: 'restartRequired',
  [DisconnectReason.connectionClosed]: 'connectionClosed',
  [DisconnectReason.connectionLost]: 'connectionLost',
  [DisconnectReason.timedOut]: 'timedOut',
  [DisconnectReason.forbidden]: 'forbidden',
  [DisconnectReason.unavailableService]: 'unavailableService',
  [DisconnectReason.multideviceMismatch]: 'multideviceMismatch'
}

/**
 * Problems that a retry cannot solve — the operator has to change the
 * configuration first.
 */
const CONFIGURATION_ERRORS = [
  'No pairing number available',
  'pairing.number is invalid',
  'The phone number must contain',
  'Use the international format',
  'must be exactly 8 characters',
  'The channel/newsletter feature is disabled'
]

/**
 * Pairing rejections that belong to the account, not to KURO's settings.
 * WhatsApp disables link-with-phone-number for some accounts.
 */
const UNPAIRABLE_ERRORS = ['not-allowed', 'not allowed']

/** WhatsApp answered "you are asking too often". Retrying only prolongs it. */
const isRateLimitError = error =>
  error?.data === 429 ||
  error?.output?.statusCode === 429 ||
  /rate-overlimit|too many/i.test(String(error?.message ?? ''))

/** How long KURO stays quiet after WhatsApp rate-limits the pairing request. */
export const PAIRING_COOLDOWN_MS = 5 * 60 * 1000

const isConfigurationError = error => {
  const message = String(error?.message ?? '')
  return CONFIGURATION_ERRORS.some(fragment => message.includes(fragment))
}

/** Disconnects that mean "this session is finished" — do not retry. */
const FATAL_STATUSES = new Set([
  DisconnectReason.loggedOut,
  DisconnectReason.badSession,
  DisconnectReason.multideviceMismatch,
  DisconnectReason.forbidden
])

export class ConnectionManager extends EventEmitter {
  /**
   * @param {object} options
   * @param {object} options.config
   * @param {object} options.logger
   * @param {(sock: object) => void} [options.onSocket]  Called for every new socket.
   */
  constructor({ config, logger, onSocket = null }) {
    super()
    this.config = config
    this.logger = logger
    this.onSocket = onSocket

    this.sock = null
    this.auth = null
    this.stopped = false
    this.connecting = false
    this.ready = false
    this.pairingRequested = false
    this.pairingInFlight = false
    this.pairOnConnect = false
    /** Set when pairing cannot succeed until the configuration is fixed. */
    this.pairingBlocked = false
    /** Epoch ms before which asking again would be pointless (rate limit). */
    this.pairingCooldownUntil = 0

    const connection = config?.connection ?? {}
    this.backoff = new ReconnectStrategy({
      baseDelayMs: connection.reconnectDelayMs,
      maxDelayMs: connection.reconnectMaxDelayMs,
      maxAttempts: connection.reconnectMaxAttempts
    })
  }

  /** The live socket, or `null`. */
  get socket() {
    return this.sock
  }

  /** Is the socket currently open? */
  get isOpen() {
    return this.ready
  }

  /**
   * Create (or recreate) the auth state and socket, then wire the events.
   * @returns {Promise<object>} the socket
   */
  async start() {
    this.stopped = false
    if (this.connecting) {
      this.logger.warn('Connection is already starting — ignoring duplicate start()')
      return this.sock
    }
    this.connecting = true

    try {
      if (!this.auth) {
        const exists = sessionExists(this.config.auth.folder)
        this.logger.info(exists ? 'Existing session found — connecting' : 'No session found — login required')
        this.auth = await createAuthState({
          type: this.config.auth?.type ?? 'multi-file',
          folder: this.config.auth.folder,
          logger: this.logger
        })
      }

      // A pairing code nobody typed leaves `creds.me` behind, which makes
      // WhatsApp refuse the next connection with 401 instead of offering a new
      // QR. Clear it so pairing can start over without deleting `session/`.
      await clearUnfinishedPairing({ authState: this.auth, logger: this.logger })

      // A fresh socket must not inherit listeners from the previous one.
      if (this.sock) this.sock.ev?.removeAllListeners?.()

      this.sock = await createSocket({ auth: this.auth, config: this.config, logger: this.logger })
      this.wireEvents(this.sock)
      this.onSocket?.(this.sock)

      // A pairing code can only be requested once the socket is ready to carry
      // an iq, so the request is deferred to the first `qr` update instead of
      // being fired here. Asking during the initial `connecting` phase either
      // drops the socket or comes back as `bad-request`, because WhatsApp has
      // not offered a pairing slot yet.
      if (this.needsPairing && this.config.pairing.enabled) {
        this.pairOnConnect = true
        this.pairingRequested = false
      }

      this.connecting = false
      return this.sock
    } catch (error) {
      this.connecting = false
      this.logger.error(`Failed to create the socket: ${error.message}`)
      throw error
    }
  }

  /** Attach the events that drive KURO's lifecycle. */
  wireEvents(sock) {
    sock.ev.on('creds.update', async () => {
      try {
        await this.auth.saveCreds()
      } catch (error) {
        this.logger.error(`Could not persist credentials: ${error.message}`)
      }
    })

    sock.ev.on('connection.update', update => {
      void this.handleConnectionUpdate(update).catch(error => {
        this.logger.error(`connection.update handler failed: ${error.message}`)
      })
    })
  }

  /** React to a `connection.update` payload. */
  async handleConnectionUpdate({ connection, lastDisconnect, qr, isNewLogin, reachoutTimeLock } = {}) {
    if (typeof reachoutTimeLock === 'number' && reachoutTimeLock > 0) {
      const minutes = Math.round(reachoutTimeLock / 60000)
      this.logger.warn(`WhatsApp rate-limited new chats; ${minutes} minute(s) of reachout cooldown.`)
    }

    if (qr) {
      // Only shown when pairing is disabled in config.
      this.emit('qr', qr)
      if (!this.config.pairing.enabled) {
        await this.printQr(qr)
      }
    }

    if (connection === 'connecting') {
      this.logger.info('Connecting to WhatsApp…')
      this.emit('connecting')
    }

    // Request the pairing code once WhatsApp has offered a pairing slot. The
    // `qr` update is that moment — pairing earlier is answered with
    // `bad-request` or kills the connection outright.
    if (
      qr &&
      this.pairOnConnect &&
      !this.pairingRequested &&
      !this.pairingBlocked &&
      Date.now() >= this.pairingCooldownUntil
    ) {
      this.pairingRequested = true
      this.pairOnConnect = false
      void this.pair().catch(error => {
        if (isConfigurationError(error)) {
          // Retrying cannot help until settings.js changes, so stop trying.
          this.pairingBlocked = true
          this.logger.error('Pairing is disabled until KURO is restarted with a valid settings.js → pairing.number and pairing.customCode.')
          return
        }
        if (isRateLimitError(error)) {
          // WhatsApp throttles repeated attempts, so back off instead of
          // hammering it on every QR rotation.
          this.pairingCooldownUntil = Date.now() + PAIRING_COOLDOWN_MS
          this.pairingRequested = false
          this.pairOnConnect = true
          this.logger.warn(
            `WhatsApp is rate-limiting pairing requests: wait about ${Math.round(PAIRING_COOLDOWN_MS / 60000)} minute(s) and KURO will ask again by itself. Restarting sooner will not help.`
          )
          return
        }
        if (UNPAIRABLE_ERRORS.some(fragment => String(error?.message ?? '').includes(fragment))) {
          // Account-side restriction: no retry can get past it.
          this.pairingBlocked = true
          this.logger.error(
            'WhatsApp refuses to link this account with a phone number. Set pairing.enabled to false in settings.js and scan the QR code instead.'
          )
          return
        }
        this.pairingRequested = false
        this.pairOnConnect = true
        this.logger.warn('Pairing request failed — it will be retried on the next connection update.')
      })
    }

    if (connection === 'open') {
      this.ready = true
      this.backoff.reset()
      const me = this.sock?.user
      this.logger.success(`Connected as ${me?.id ?? 'unknown'}${me?.name ? ` (${me.name})` : ''}`)
      if (isNewLogin) this.logger.success('New device linked successfully.')
      this.emit('open', this.sock)
      return
    }

    if (connection === 'close') {
      this.ready = false
      const statusCode = lastDisconnect?.error?.output?.statusCode ?? lastDisconnect?.error?.statusCode ?? null
      const label = STATUS[statusCode] ?? 'unknown'
      const message = lastDisconnect?.error?.message ?? 'no reason given'
      this.logger.warn(`Connection closed (${label}${statusCode ? `/${statusCode}` : ''}): ${message}`)
      this.emit('close', { statusCode, label, error: lastDisconnect?.error })

      if (this.stopped) return

      if (FATAL_STATUSES.has(statusCode)) {
        this.logger.error('This session can no longer be used. Delete the session folder and pair again.')
        this.emit('logout', { statusCode })
        return
      }

      if (statusCode === DisconnectReason.connectionReplaced) {
        this.logger.error('Another device replaced this session. KURO will not fight over the slot.')
        this.emit('replaced', { statusCode })
        return
      }

      if (statusCode === DisconnectReason.restartRequired) {
        this.logger.info('WhatsApp asked for a restart — reconnecting immediately.')
        this.backoff.reset()
        void this.start().catch(error => this.logger.error(`Immediate reconnect failed: ${error.message}`))
        return
      }

      this.scheduleReconnect()
    }
  }

  /** Queue a reconnect attempt with backoff. */
  scheduleReconnect() {
    const scheduled = this.backoff.schedule(
      () => {
        this.logger.info(`Reconnecting (attempt ${this.backoff.attempts})…`)
        void this.start().catch(error => {
          this.logger.error(`Reconnect failed: ${error.message}`)
          if (!this.stopped) this.scheduleReconnect()
        })
      },
      (delay, attempt) => this.logger.info(`Reconnect #${attempt} in ${(delay / 1000).toFixed(1)}s`)
    )

    if (!scheduled) {
      this.logger.error(`Giving up after ${this.backoff.attempts} attempts. Restart KURO to try again.`)
      this.emit('exhausted')
    }
  }

  /** Render a QR code in the terminal for the non-pairing login path. */
  async printQr(qr) {
    try {
      const qrcode = (await import('qrcode-terminal')).default
      this.logger.raw('')
      this.logger.info('Scan this QR code: WhatsApp → Linked devices → Link a device')
      qrcode.generate(qr, { small: true })
    } catch {
      this.logger.warn(`qrcode-terminal is not installed. Raw QR payload:\n${qr}`)
    }
  }

  /**
   * Ask WhatsApp for a pairing code. Called once per unregistered session.
   * @returns {Promise<object|null>}
   */
  async pair() {
    if (!this.sock) throw new Error('pair() needs a socket — call start() first')
    if (this.auth?.state?.creds?.registered) {
      this.logger.debug('Already registered — skipping the pairing request.')
      return null
    }
    if (this.pairingInFlight) {
      this.logger.debug('A pairing request is already in flight.')
      return null
    }

    this.pairingInFlight = true
    try {
      const result = await requestPairing({ sock: this.sock, config: this.config, logger: this.logger })
      this.pairingRequested = true
      this.emit('pairing', result)
      return result
    } catch (error) {
      this.logger.error(`Pairing failed: ${error.message}`)
      this.emit('pairing-error', error)
      throw error
    } finally {
      this.pairingInFlight = false
    }
  }

  /** True when the session still needs to be linked. */
  get needsPairing() {
    return !this.auth?.state?.creds?.registered
  }

  /** Log the account out of WhatsApp and wipe the local session. */
  async logout() {
    this.stopped = true
    this.backoff.cancel()
    try {
      await this.sock?.logout?.()
      this.logger.warn('Logged out of WhatsApp.')
    } catch (error) {
      this.logger.error(`Logout request failed: ${error.message}`)
    }
    await destroySession({ folder: this.config.auth.folder, authState: this.auth, logger: this.logger })
    this.auth = null
    this.ready = false
    this.emit('logout', { manual: true })
  }

  /**
   * Graceful shutdown: stop scheduling work, close the socket, keep the
   * session intact so the next start reconnects without pairing.
   */
  async stop({ reason = 'shutdown' } = {}) {
    this.stopped = true
    this.backoff.cancel()
    if (!this.sock) return
    try {
      this.logger.info(`Closing the WhatsApp connection (${reason})…`)
      await this.sock.end?.(undefined)
    } catch (error) {
      this.logger.debug(`Socket close raised: ${error.message}`)
    } finally {
      this.ready = false
      this.sock = null
    }
  }
}

export default ConnectionManager
