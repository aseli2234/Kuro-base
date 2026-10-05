/**
 * KURO — versioned schema migrations.
 *
 * Every entry is applied exactly once, in ascending `version` order, and the
 * applied version is recorded in SQLite's own `PRAGMA user_version`. Adding a
 * new migration means appending to this array — never editing a shipped one.
 *
 * Naming mirrors the classic `001_initial.sql` convention while staying in
 * JavaScript so KURO has no external migration tool to install.
 */

/** Tables created by `001_initial`. */
const INITIAL_SQL = `
CREATE TABLE IF NOT EXISTS users (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  jid          TEXT NOT NULL UNIQUE,
  number       TEXT,
  lid          TEXT,
  name         TEXT,
  push_name    TEXT,
  is_owner     INTEGER NOT NULL DEFAULT 0,
  is_banned    INTEGER NOT NULL DEFAULT 0,
  is_premium   INTEGER NOT NULL DEFAULT 0,
  created_at   TEXT NOT NULL,
  updated_at   TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_users_number ON users(number);
CREATE INDEX IF NOT EXISTS idx_users_lid    ON users(lid);

CREATE TABLE IF NOT EXISTS chats (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  jid          TEXT NOT NULL UNIQUE,
  type         TEXT NOT NULL DEFAULT 'private',
  name         TEXT,
  settings     TEXT NOT NULL DEFAULT '{}',
  created_at   TEXT NOT NULL,
  updated_at   TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_chats_type ON chats(type);

CREATE TABLE IF NOT EXISTS groups (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  jid          TEXT NOT NULL UNIQUE,
  name         TEXT,
  settings     TEXT NOT NULL DEFAULT '{}',
  created_at   TEXT NOT NULL,
  updated_at   TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS settings (
  key          TEXT PRIMARY KEY,
  value        TEXT,
  updated_at   TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS plugins (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  name         TEXT NOT NULL UNIQUE,
  enabled      INTEGER NOT NULL DEFAULT 1,
  metadata     TEXT NOT NULL DEFAULT '{}',
  created_at   TEXT NOT NULL,
  updated_at   TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS stats (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  key          TEXT NOT NULL UNIQUE,
  value        INTEGER NOT NULL DEFAULT 0,
  updated_at   TEXT NOT NULL
);
`

export const migrations = [
  {
    version: 1,
    name: '001_initial',
    description: 'Users, chats, groups, settings, plugins and stats.',
    up: db => {
      db.exec(INITIAL_SQL)
    }
  },
  {
    version: 2,
    name: '002_add_premium',
    description: 'Premium expiry on users plus an index for lookups.',
    up: db => {
      db.exec(`
        ALTER TABLE users ADD COLUMN premium_until TEXT;
        CREATE INDEX IF NOT EXISTS idx_users_premium ON users(is_premium);
      `)
    }
  },
  {
    version: 3,
    name: '003_add_lid_mappings',
    description: 'Persist LID ↔ PN pairs so owner checks survive a restart.',
    up: db => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS lid_mappings (
          lid        TEXT PRIMARY KEY,
          pn         TEXT NOT NULL,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_lid_mappings_pn ON lid_mappings(pn);
      `)
    }
  },
  {
    version: 4,
    name: '004_add_command_usage',
    description: 'Per-command usage counters and group metadata cache.',
    up: db => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS command_usage (
          id           INTEGER PRIMARY KEY AUTOINCREMENT,
          command      TEXT NOT NULL UNIQUE,
          uses         INTEGER NOT NULL DEFAULT 0,
          last_used_at TEXT
        );

        CREATE TABLE IF NOT EXISTS group_metadata_cache (
          jid          TEXT PRIMARY KEY,
          metadata     TEXT NOT NULL DEFAULT '{}',
          updated_at   TEXT NOT NULL
        );
      `)
    }
  },
  {
    version: 5,
    name: '005_add_theme_config',
    description: 'Dynamic theme configuration (bot name, description, thumbnail) for the menu.',
    up: db => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS theme_config (
          theme_key    TEXT PRIMARY KEY,
          theme_value  TEXT,
          updated_at   TEXT NOT NULL
        );
      `)
    }
  }
]

/** Highest migration version this build knows about. */
export const LATEST_VERSION = migrations.reduce((max, item) => Math.max(max, item.version), 0)

export default migrations
