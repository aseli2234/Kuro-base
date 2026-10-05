/**
 * KURO — authentication / session state.
 *
 * Elaina Baileys ships several stores with the same `{ state, saveCreds }`
 * contract. KURO defaults to the multi-file store so credentials stay inside
 * `session/`, which is git-ignored and never written to the bot database:
 * Signal keys and Noise keys are secrets, not application data.
 *
 *   import { createAuthState } from './connection/auth.js'
 *   const { state, saveCreds } = await createAuthState({ folder: './session' })
 *   sock.ev.on('creds.update', saveCreds)
 */

import fs from 'node:fs'
import path from 'node:path'
import { useMultiFileAuthState, useSqliteAuthState } from '@rexxhayanasi/elaina-baileys'

/** Path of the credential file inside a multi-file session folder. */
export const credsFilePath = folder => path.join(folder, 'creds.json')

/** True when a session folder already holds credentials. */
export const sessionExists = folder => {
  try {
    return fs.existsSync(credsFilePath(folder))
  } catch {
    return false
  }
}

/**
 * Create the auth state.
 *
 * @param {object} options
 * @param {'multi-file'|'sqlite'} [options.type]
 * @param {string} options.folder        Session folder (multi-file) or DB file (sqlite)
 * @param {object} [options.database]    An existing better-sqlite3 handle
 * @param {object} [options.logger]
 * @returns {Promise<{ state: object, saveCreds: Function, clearAuth?: Function, close?: Function, type: string }>}
 */
export const createAuthState = async ({ type = 'multi-file', folder, database = null, logger = null } = {}) => {
  if (type === 'sqlite') {
    const target = database ? { database } : { dbPath: folder }
    const result = await useSqliteAuthState(target)
    logger?.info?.(`Auth state ready (sqlite: ${database ? 'shared handle' : folder})`)
    return { ...result, type }
  }

  const result = await useMultiFileAuthState(folder)
  logger?.info?.(`Auth state ready (multi-file: ${folder})`)
  return { ...result, type }
}

/**
 * Forget a pairing attempt that never completed.
 *
 * `requestPairingCode` sets `creds.me` while a code is outstanding, and the
 * library picks between "register" and "log in" purely on that field. A code
 * nobody typed therefore leaves credentials that make WhatsApp answer the next
 * connection with 401 loggedOut — and KURO can never offer a new code, because
 * no QR is sent on the login path. Clearing the leftovers puts the session back
 * on the registration path, so pairing works again without deleting `session/`
 * by hand.
 *
 * @returns {Promise<boolean>} `true` when leftovers had to be cleared.
 */
export const clearUnfinishedPairing = async ({ authState, logger = null } = {}) => {
  const creds = authState?.state?.creds
  if (!creds || creds.registered || !creds.me) return false

  creds.me = undefined
  creds.pairingCode = undefined
  try {
    await authState.saveCreds?.()
  } catch (error) {
    logger?.error?.(`Could not rewrite the session after an unfinished pairing: ${error.message}`)
  }
  logger?.warn?.('Discarded an unfinished pairing attempt from the saved session — a fresh code is required.')
  return true
}

/**
 * Delete the persisted session. Used by the `.logout` flow: after this the bot
 * must pair again from scratch.
 */
export const destroySession = async ({ folder, authState = null, logger = null } = {}) => {
  try {
    await authState?.clearAuth?.()
  } catch {
    /* the sqlite store may not be in use */
  }
  try {
    await authState?.close?.()
  } catch {
    /* nothing to release */
  }
  try {
    if (folder && fs.existsSync(folder)) {
      fs.rmSync(folder, { recursive: true, force: true })
      logger?.warn?.(`Session removed from ${folder}`)
    }
    return true
  } catch (error) {
    logger?.error?.(`Failed to remove session at ${folder}: ${error.message}`)
    return false
  }
}

export default { createAuthState, sessionExists, destroySession, clearUnfinishedPairing, credsFilePath }
