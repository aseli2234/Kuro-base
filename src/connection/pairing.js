/**
 * KURO — pairing code flow.
 *
 * Elaina Baileys:
 *
 *   const sock = makeWASocket({ auth: state })
 *   if (!state.creds.registered) {
 *     const code = await sock.requestPairingCode('6281234567890', 'KURODEV1')
 *   }
 *
 * Both the number and the custom code come from `settings.js`.
 *
 * Two rules the library enforces, so KURO enforces them first with a readable
 * message instead of a raw exception:
 *
 *   - the phone number must be international format, digits only, 6–15 of
 *     them, and must not start with `0`
 *   - a **custom** pairing code must be **exactly 8 characters**
 *
 * Only one request may be outstanding at a time; a second one is rejected with
 * HTTP 409 until the first is used, expires, or is cancelled with
 * `sock.cancelPairingCode()`.
 */

import { createInterface } from 'node:readline/promises'
import process from 'node:process'

/** Elaina's hard requirement for a custom pairing code. */
export const PAIRING_CODE_LENGTH = 8

/** Keep digits only — `+62 812-3456-7890` becomes `6281234567890`. */
export const normalizePairingNumber = raw => String(raw ?? '').replace(/\D/g, '')

/**
 * @returns {string|null} A human readable problem, or `null` when valid.
 */
export const validatePairingNumber = number => {
  const digits = normalizePairingNumber(number)
  if (!digits) return 'A phone number is required.'
  if (digits.length < 6 || digits.length > 15) return 'The phone number must contain 6 to 15 digits.'
  if (digits.startsWith('0')) {
    return 'Use the international format: country code first, without the leading 0 (e.g. 6281234567890).'
  }
  return null
}

/**
 * @returns {string|null} A human readable problem, or `null` when valid.
 */
export const validateCustomCode = code => {
  if (!code) return null
  if (String(code).length !== PAIRING_CODE_LENGTH) {
    return `A custom pairing code must be exactly ${PAIRING_CODE_LENGTH} characters (got ${String(code).length}).`
  }
  return null
}

/**
 * Ask the operator for a phone number, unless one is configured.
 *
 * Order: `pairing.number` from settings.js → interactive prompt when a TTY is
 * attached → error with instructions.
 */
export const resolvePairingNumber = async ({ config, logger = null } = {}) => {
  const configured = normalizePairingNumber(config?.pairing?.number)
  if (configured) {
    const problem = validatePairingNumber(configured)
    if (problem) throw new Error(`pairing.number is invalid: ${problem}`)
    return configured
  }

  if (!process.stdin.isTTY) {
    throw new Error(
      "No pairing number available. Set pairing.number in settings.js (e.g. '6281234567890'), or run KURO in an interactive terminal."
    )
  }

  const rl = createInterface({ input: process.stdin, output: process.stdout })
  try {
    logger?.raw?.('')
    logger?.info?.('No session found — a fresh WhatsApp login is required.')
    const answer = await rl.question('  Enter the WhatsApp number to pair (international format): ')
    const digits = normalizePairingNumber(answer)
    const problem = validatePairingNumber(digits)
    if (problem) throw new Error(problem)
    return digits
  } finally {
    rl.close()
  }
}

/**
 * Drive the whole pairing request.
 *
 * @param {object} options
 * @param {object} options.sock      A socket created with an unregistered auth state
 * @param {object} options.config    The central KURO config
 * @param {object} [options.logger]
 * @returns {Promise<{ number: string, code: string, custom: boolean }>}
 */
export const requestPairing = async ({ sock, config, logger = null }) => {
  if (!sock?.requestPairingCode) throw new Error('requestPairing() needs a live socket')

  const number = await resolvePairingNumber({ config, logger })
  const customCode = config?.pairing?.customCode ?? ''

  const codeProblem = validateCustomCode(customCode)
  if (codeProblem) {
    logger?.warn?.(`Ignoring pairing.customCode: ${codeProblem} Falling back to a generated code.`)
  }

  const useCustom = Boolean(customCode) && !codeProblem

  const attempt = async () => {
    try {
      return await sock.requestPairingCode(number, useCustom ? customCode : undefined)
    } catch (error) {
      const status = error?.output?.statusCode ?? error?.statusCode
      if (status === 409) {
        // A previous request is still pending — clear it and try once more.
        logger?.warn?.('A pairing request is still pending — cancelling it and requesting a new code.')
        sock.cancelPairingCode?.()
        return sock.requestPairingCode(number, useCustom ? customCode : undefined)
      }
      throw error
    }
  }

  const code = await attempt()

  logger?.success?.(`Pairing code issued for ${number}${useCustom ? ' (custom)' : ''}: ${code}`)
  logger?.info?.('Open WhatsApp → Linked devices → Link with phone number, then enter the code above.')
  logger?.info?.('The code expires after 3 minutes; KURO keeps trying until the link completes.')

  return { number, code, custom: useCustom }
}

export default {
  PAIRING_CODE_LENGTH,
  normalizePairingNumber,
  validatePairingNumber,
  validateCustomCode,
  resolvePairingNumber,
  requestPairing
}
