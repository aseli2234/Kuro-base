/**
 * KURO — the one and only SQLite connection.
 *
 * Plugins must never open their own handle; they go through the database
 * manager, which goes through here. WAL mode plus a busy timeout keeps reads
 * working while the migrations and writes are happening.
 */

import fs from 'node:fs'
import path from 'node:path'
import Database from 'better-sqlite3'

let connection = null
let connectionPath = null

/**
 * Open (or return) the shared connection.
 *
 * @param {string} dbPath Absolute path of the SQLite file.
 * @returns {import('better-sqlite3').Database}
 */
export const getConnection = dbPath => {
  if (connection && connection.open) {
    if (!dbPath || dbPath === connectionPath) return connection
    // A different path was requested — close the old handle first.
    closeConnection()
  }

  if (!dbPath) throw new Error('getConnection() needs a database path')

  const directory = path.dirname(dbPath)
  fs.mkdirSync(directory, { recursive: true })

  const db = new Database(dbPath)

  // Safety and concurrency pragmas.
  db.pragma('journal_mode = WAL')
  db.pragma('synchronous = NORMAL')
  db.pragma('foreign_keys = ON')
  db.pragma('busy_timeout = 5000')
  db.pragma('temp_store = MEMORY')

  connection = db
  connectionPath = dbPath
  return connection
}

/** The shared handle, or `null` when nothing has been opened yet. */
export const currentConnection = () => (connection && connection.open ? connection : null)

/** True while the shared handle is usable. */
export const isConnected = () => Boolean(connection && connection.open)

/** Path of the open database file. */
export const getConnectionPath = () => connectionPath

/**
 * Close the shared handle. Safe to call more than once.
 * Runs a WAL checkpoint first so no committed data is left in the -wal file.
 */
export const closeConnection = () => {
  if (!connection) return false
  try {
    if (connection.open) {
      try {
        connection.pragma('wal_checkpoint(TRUNCATE)')
      } catch {
        /* checkpoint is best effort */
      }
      connection.close()
    }
  } finally {
    connection = null
    connectionPath = null
  }
  return true
}

export default { getConnection, currentConnection, isConnected, getConnectionPath, closeConnection }
