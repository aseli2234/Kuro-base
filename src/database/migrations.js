/**
 * KURO — migration runner.
 *
 * Flow:
 *   check database → exists? → run pending migrations → done
 *                  → missing  → create file, schema is applied by migration 1
 *
 * Each migration runs inside its own transaction together with the
 * `user_version` bump, so a failure leaves the database on the last good
 * version instead of half-migrated.
 */

import { migrations, LATEST_VERSION } from './schema.js'

/** Read the schema version recorded in the file. */
export const getCurrentVersion = db => {
  const row = db.pragma('user_version', { simple: true })
  return Number(row) || 0
}

/**
 * Apply every migration newer than the recorded version.
 *
 * @param {import('better-sqlite3').Database} db
 * @param {(message: string, meta?: object) => void} [log]
 * @returns {{ from: number, to: number, applied: string[] }}
 */
export const runMigrations = (db, log = () => {}) => {
  const from = getCurrentVersion(db)
  const applied = []
  const pending = migrations.filter(item => item.version > from).sort((a, b) => a.version - b.version)

  if (pending.length === 0) {
    log(`Schema already at version ${from} — nothing to migrate`)
    return { from, to: from, applied }
  }

  log(`Migrating schema from v${from} to v${LATEST_VERSION}`)

  for (const migration of pending) {
    const apply = db.transaction(() => {
      migration.up(db)
      // pragma values cannot be bound, and the version is a trusted integer.
      db.pragma(`user_version = ${migration.version}`)
    })

    try {
      apply()
      applied.push(migration.name)
      log(`  applied ${migration.name} — ${migration.description}`)
    } catch (error) {
      error.message = `Migration ${migration.name} failed: ${error.message}`
      throw error
    }
  }

  const to = getCurrentVersion(db)
  log(`Schema ready at version ${to}`)
  return { from, to, applied }
}

/** List migrations that have not been applied yet. */
export const pendingMigrations = db =>
  migrations.filter(item => item.version > getCurrentVersion(db)).sort((a, b) => a.version - b.version)

export { migrations, LATEST_VERSION }

export default { runMigrations, getCurrentVersion, pendingMigrations, migrations, LATEST_VERSION }
