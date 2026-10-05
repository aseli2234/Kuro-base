/**
 * KURO — database manager.
 *
 * The only object allowed to talk to SQLite. Plugins receive it through
 * `ctx.db`, so a plugin never opens a connection of its own:
 *
 *   const user = await db.getUser(ctx.sender)
 *
 * Every statement is prepared once and cached, and every value goes through a
 * bound parameter — no string concatenation ever reaches a query.
 */

import { nowIso, normalizeJid, jidNumber, toJson, fromJson, toBool, fromBool } from './helpers.js'
import { getConnection, closeConnection, isConnected, getConnectionPath } from './connection.js'
import { runMigrations, getCurrentVersion, pendingMigrations, LATEST_VERSION, migrations } from './migrations.js'

const mapUser = row => {
  if (!row) return null
  return {
    id: row.id,
    jid: row.jid,
    number: row.number,
    lid: row.lid,
    name: row.name,
    pushName: row.push_name,
    isOwner: toBool(row.is_owner),
    isBanned: toBool(row.is_banned),
    isPremium: toBool(row.is_premium),
    premiumUntil: row.premium_until,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  }
}

const mapChat = row => {
  if (!row) return null
  return {
    id: row.id,
    jid: row.jid,
    type: row.type,
    name: row.name,
    settings: fromJson(row.settings, {}),
    createdAt: row.created_at,
    updatedAt: row.updated_at
  }
}

const mapGroup = row => {
  if (!row) return null
  return {
    id: row.id,
    jid: row.jid,
    name: row.name,
    settings: fromJson(row.settings, {}),
    createdAt: row.created_at,
    updatedAt: row.updated_at
  }
}

const mapPlugin = row => {
  if (!row) return null
  return {
    id: row.id,
    name: row.name,
    enabled: toBool(row.enabled),
    metadata: fromJson(row.metadata, {}),
    createdAt: row.created_at,
    updatedAt: row.updated_at
  }
}

export class DatabaseManager {
  /**
   * @param {{ path: string, logger?: import('../utils/logger.js').Logger }} options
   */
  constructor({ path, logger = null }) {
    this.path = path
    this.logger = logger
    this.db = null
    this.statements = new Map()
  }

  /** Open the file and bring the schema up to date. */
  open() {
    if (this.db && this.db.open) return this
    this.db = getConnection(this.path)
    const before = getCurrentVersion(this.db)
    const result = runMigrations(this.db, message => this.logger?.info(message))
    this.version = result.to
    this.created = before === 0
    return this
  }

  /** Ensure the connection is open before running a statement. */
  ensure() {
    if (!this.db || !this.db.open) this.open()
    return this.db
  }

  /** Prepared statement cache — one compile per SQL string per process. */
  stmt(sql) {
    if (!this.statements.has(sql)) {
      this.statements.set(sql, this.ensure().prepare(sql))
    }
    return this.statements.get(sql)
  }

  /** Run `fn` inside a single SQLite transaction. */
  transaction(fn) {
    return this.ensure().transaction(fn)()
  }

  // ────────────────────────────────────────────────────────────
  //  Users
  // ────────────────────────────────────────────────────────────

  getUser(jid) {
    return mapUser(this.stmt('SELECT * FROM users WHERE jid = ?').get(normalizeJid(jid)))
  }

  getUserByNumber(number) {
    const digits = String(number ?? '').replace(/\D/g, '')
    if (!digits) return null
    return mapUser(this.stmt('SELECT * FROM users WHERE number = ?').get(digits))
  }

  getUserByLid(lid) {
    return mapUser(this.stmt('SELECT * FROM users WHERE lid = ?').get(normalizeJid(lid)))
  }

  createUser(data = {}) {
    const jid = normalizeJid(data.jid)
    if (!jid) throw new Error('createUser() requires a jid')
    const timestamp = nowIso()

    this.stmt(`
      INSERT INTO users (jid, number, lid, name, push_name, is_owner, is_banned, is_premium, premium_until, created_at, updated_at)
      VALUES (@jid, @number, @lid, @name, @push_name, @is_owner, @is_banned, @is_premium, @premium_until, @created_at, @updated_at)
      ON CONFLICT(jid) DO NOTHING
    `).run({
      jid,
      number: data.number ?? jidNumber(jid),
      lid: data.lid ? normalizeJid(data.lid) : null,
      name: data.name ?? null,
      push_name: data.pushName ?? data.push_name ?? null,
      is_owner: fromBool(toBool(data.isOwner ?? data.is_owner)),
      is_banned: fromBool(toBool(data.isBanned ?? data.is_banned)),
      is_premium: fromBool(toBool(data.isPremium ?? data.is_premium)),
      premium_until: data.premiumUntil ?? data.premium_until ?? null,
      created_at: timestamp,
      updated_at: timestamp
    })

    return this.getUser(jid)
  }

  updateUser(jid, data = {}) {
    const key = normalizeJid(jid)
    if (!this.getUser(key)) this.createUser({ jid: key, number: jidNumber(key) })
    if (!data || Object.keys(data).length === 0) return this.getUser(key)

    const assign = []
    const params = { jid: key, updated_at: nowIso() }
    const push = (column, value) => {
      assign.push(`${column} = @${column}`)
      params[column] = value
    }

    if ('number' in data) push('number', data.number ? String(data.number).replace(/\D/g, '') : null)
    if ('lid' in data) push('lid', data.lid ? normalizeJid(data.lid) : null)
    if ('name' in data) push('name', data.name ?? null)
    if ('pushName' in data || 'push_name' in data) push('push_name', data.pushName ?? data.push_name ?? null)
    if ('isOwner' in data || 'is_owner' in data) push('is_owner', fromBool(toBool(data.isOwner ?? data.is_owner)))
    if ('isBanned' in data || 'is_banned' in data) push('is_banned', fromBool(toBool(data.isBanned ?? data.is_banned)))
    if ('isPremium' in data || 'is_premium' in data) push('is_premium', fromBool(toBool(data.isPremium ?? data.is_premium)))
    if ('premiumUntil' in data || 'premium_until' in data) push('premium_until', data.premiumUntil ?? data.premium_until ?? null)

    if (assign.length === 0) return this.getUser(key)

    this.stmt(`UPDATE users SET ${assign.join(', ')}, updated_at = @updated_at WHERE jid = @jid`).run(params)
    return this.getUser(key)
  }

  /**
   * Create the user if unknown, refresh the mutable profile fields, and make
   * sure the persisted owner flag matches the configuration.
   */
  ensureUser(data = {}, { isOwner = false } = {}) {
    const jid = normalizeJid(data.jid)
    if (!jid) return null
    const patch = {}
    if (data.name) patch.name = data.name
    if (data.pushName) patch.pushName = data.pushName
    if (data.lid) patch.lid = data.lid
    if (data.number) patch.number = data.number
    if (isOwner) patch.isOwner = true

    return this.updateUser(jid, patch)
  }

  listUsers({ limit = 100, offset = 0 } = {}) {
    return this.stmt('SELECT * FROM users ORDER BY updated_at DESC LIMIT ? OFFSET ?')
      .all(limit, offset)
      .map(mapUser)
  }

  countUsers() {
    return Number(this.stmt('SELECT COUNT(*) AS total FROM users').get()?.total ?? 0)
  }

  // ────────────────────────────────────────────────────────────
  //  Chats
  // ────────────────────────────────────────────────────────────

  getChat(jid) {
    return mapChat(this.stmt('SELECT * FROM chats WHERE jid = ?').get(normalizeJid(jid)))
  }

  ensureChat({ jid, type = 'private', name = null } = {}) {
    const key = normalizeJid(jid)
    if (!key) return null
    if (!this.getChat(key)) {
      const timestamp = nowIso()
      this.stmt(`
        INSERT INTO chats (jid, type, name, settings, created_at, updated_at)
        VALUES (?, ?, ?, '{}', ?, ?)
        ON CONFLICT(jid) DO NOTHING
      `).run(key, type, name, timestamp, timestamp)
    } else if (name) {
      this.updateChat(key, { name })
    }
    return this.getChat(key)
  }

  updateChat(jid, data = {}) {
    const key = normalizeJid(jid)
    if (!key) return null
    if (!this.getChat(key)) this.ensureChat({ jid: key, type: data.type ?? 'private' })
    if (!data || Object.keys(data).length === 0) return this.getChat(key)

    const assign = []
    const params = { jid: key, updated_at: nowIso() }
    const push = (column, value) => {
      assign.push(`${column} = @${column}`)
      params[column] = value
    }

    if ('type' in data) push('type', data.type)
    if ('name' in data) push('name', data.name ?? null)
    if ('settings' in data) push('settings', toJson(data.settings))

    if (assign.length === 0) return this.getChat(key)

    this.stmt(`UPDATE chats SET ${assign.join(', ')}, updated_at = @updated_at WHERE jid = @jid`).run(params)
    return this.getChat(key)
  }

  /** Merge a partial settings object into a chat row. */
  updateChatSettings(jid, patch = {}) {
    const chat = this.ensureChat({ jid })
    if (!chat) return null
    return this.updateChat(jid, { settings: { ...chat.settings, ...patch } })
  }

  listChats({ type = null, limit = 100 } = {}) {
    if (type) {
      return this.stmt('SELECT * FROM chats WHERE type = ? ORDER BY updated_at DESC LIMIT ?').all(type, limit).map(mapChat)
    }
    return this.stmt('SELECT * FROM chats ORDER BY updated_at DESC LIMIT ?').all(limit).map(mapChat)
  }

  // ────────────────────────────────────────────────────────────
  //  Groups
  // ────────────────────────────────────────────────────────────

  getGroup(jid) {
    return mapGroup(this.stmt('SELECT * FROM groups WHERE jid = ?').get(normalizeJid(jid)))
  }

  ensureGroup({ jid, name = null } = {}) {
    const key = normalizeJid(jid)
    if (!key) return null
    if (!this.getGroup(key)) {
      const timestamp = nowIso()
      this.stmt(`
        INSERT INTO groups (jid, name, settings, created_at, updated_at)
        VALUES (?, ?, '{}', ?, ?)
        ON CONFLICT(jid) DO NOTHING
      `).run(key, name, timestamp, timestamp)
    } else if (name) {
      this.updateGroup(key, { name })
    }
    return this.getGroup(key)
  }

  updateGroup(jid, data = {}) {
    const key = normalizeJid(jid)
    if (!key) return null
    if (!this.getGroup(key)) this.ensureGroup({ jid: key })
    if (!data || Object.keys(data).length === 0) return this.getGroup(key)

    const assign = []
    const params = { jid: key, updated_at: nowIso() }
    const push = (column, value) => {
      assign.push(`${column} = @${column}`)
      params[column] = value
    }

    if ('name' in data) push('name', data.name ?? null)
    if ('settings' in data) push('settings', toJson(data.settings))

    if (assign.length === 0) return this.getGroup(key)

    this.stmt(`UPDATE groups SET ${assign.join(', ')}, updated_at = @updated_at WHERE jid = @jid`).run(params)
    return this.getGroup(key)
  }

  updateGroupSettings(jid, patch = {}) {
    const group = this.ensureGroup({ jid })
    if (!group) return null
    return this.updateGroup(jid, { settings: { ...group.settings, ...patch } })
  }

  /** Cache raw group metadata from Baileys so plugins skip the network call. */
  cacheGroupMetadata(jid, metadata) {
    const key = normalizeJid(jid)
    if (!key) return null
    this.stmt(`
      INSERT INTO group_metadata_cache (jid, metadata, updated_at)
      VALUES (?, ?, ?)
      ON CONFLICT(jid) DO UPDATE SET metadata = excluded.metadata, updated_at = excluded.updated_at
    `).run(key, toJson(metadata), nowIso())
    return metadata
  }

  getGroupMetadataCache(jid) {
    const row = this.stmt('SELECT metadata FROM group_metadata_cache WHERE jid = ?').get(normalizeJid(jid))
    return row ? fromJson(row.metadata, null) : null
  }

  // ────────────────────────────────────────────────────────────
  //  Settings
  // ────────────────────────────────────────────────────────────

  getSetting(key, fallback = null) {
    const row = this.stmt('SELECT value FROM settings WHERE key = ?').get(String(key))
    if (!row) return fallback
    return fromJson(row.value, row.value)
  }

  setSetting(key, value) {
    this.stmt(`
      INSERT INTO settings (key, value, updated_at)
      VALUES (?, ?, ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
    `).run(String(key), toJson(value), nowIso())
    return this.getSetting(key)
  }

  deleteSetting(key) {
    return this.stmt('DELETE FROM settings WHERE key = ?').run(String(key)).changes > 0
  }

  allSettings() {
    const rows = this.stmt('SELECT key, value FROM settings').all()
    const output = {}
    for (const row of rows) output[row.key] = fromJson(row.value, row.value)
    return output
  }

  // ────────────────────────────────────────────────────────────
  //  Plugins
  // ────────────────────────────────────────────────────────────

  getPlugin(name) {
    return mapPlugin(this.stmt('SELECT * FROM plugins WHERE name = ?').get(String(name)))
  }

  setPlugin(name, data = {}) {
    const key = String(name)
    const timestamp = nowIso()
    this.stmt(`
      INSERT INTO plugins (name, enabled, metadata, created_at, updated_at)
      VALUES (@name, @enabled, @metadata, @created_at, @updated_at)
      ON CONFLICT(name) DO UPDATE SET
        enabled    = excluded.enabled,
        metadata   = excluded.metadata,
        updated_at = excluded.updated_at
    `).run({
      name: key,
      enabled: fromBool(data.enabled !== false),
      metadata: toJson(data.metadata ?? {}),
      created_at: timestamp,
      updated_at: timestamp
    })
    return this.getPlugin(key)
  }

  setPluginEnabled(name, enabled) {
    const existing = this.getPlugin(name)
    if (!existing) return this.setPlugin(name, { enabled })
    return this.setPlugin(name, { enabled, metadata: existing.metadata })
  }

  deletePlugin(name) {
    return this.stmt('DELETE FROM plugins WHERE name = ?').run(String(name)).changes > 0
  }

  listPlugins() {
    return this.stmt('SELECT * FROM plugins ORDER BY name ASC').all().map(mapPlugin)
  }

  /** Map of plugin name → enabled flag, for the loader's disable list. */
  pluginEnabledMap() {
    const output = {}
    for (const row of this.listPlugins()) output[row.name] = row.enabled
    return output
  }

  // ────────────────────────────────────────────────────────────
  //  Stats
  // ────────────────────────────────────────────────────────────

  getStat(key) {
    const row = this.stmt('SELECT value FROM stats WHERE key = ?').get(String(key))
    return Number(row?.value ?? 0)
  }

  setStat(key, value) {
    this.stmt(`
      INSERT INTO stats (key, value, updated_at)
      VALUES (?, ?, ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
    `).run(String(key), Number(value) || 0, nowIso())
    return this.getStat(key)
  }

  incrementStat(key, by = 1) {
    this.stmt(`
      INSERT INTO stats (key, value, updated_at)
      VALUES (?, ?, ?)
      ON CONFLICT(key) DO UPDATE SET value = value + excluded.value, updated_at = excluded.updated_at
    `).run(String(key), Number(by) || 0, nowIso())
    return this.getStat(key)
  }

  allStats() {
    const rows = this.stmt('SELECT key, value FROM stats').all()
    const output = {}
    for (const row of rows) output[row.key] = Number(row.value)
    return output
  }

  /** Per-command usage counters, used by `.plugins` and future analytics. */
  incrementCommandUsage(command) {
    this.stmt(`
      INSERT INTO command_usage (command, uses, last_used_at)
      VALUES (?, 1, ?)
      ON CONFLICT(command) DO UPDATE SET
        uses         = uses + 1,
        last_used_at = excluded.last_used_at
    `).run(String(command), nowIso())
    return this.getCommandUsage(command)
  }

  getCommandUsage(command) {
    const row = this.stmt('SELECT uses, last_used_at FROM command_usage WHERE command = ?').get(String(command))
    return row ? { uses: Number(row.uses), lastUsedAt: row.last_used_at } : { uses: 0, lastUsedAt: null }
  }

  topCommands(limit = 10) {
    return this.stmt('SELECT command, uses, last_used_at FROM command_usage ORDER BY uses DESC LIMIT ?')
      .all(limit)
      .map(row => ({ command: row.command, uses: Number(row.uses), lastUsedAt: row.last_used_at }))
  }

  // ────────────────────────────────────────────────────────────
  //  Theme configuration (menu appearance — Theme Manager)
  // ────────────────────────────────────────────────────────────

  /** Read one theme value, `fallback` when it has never been set. */
  getTheme(key, fallback = null) {
    const row = this.stmt('SELECT theme_value FROM theme_config WHERE theme_key = ?').get(String(key))
    if (!row || row.theme_value === null || row.theme_value === '') return fallback
    return fromJson(row.theme_value, row.theme_value)
  }

  /** Persist one theme key (upsert, prepared statement). */
  setTheme(key, value) {
    this.stmt(`
      INSERT INTO theme_config (theme_key, theme_value, updated_at)
      VALUES (?, ?, ?)
      ON CONFLICT(theme_key) DO UPDATE SET
        theme_value = excluded.theme_value,
        updated_at  = excluded.updated_at
    `).run(String(key), toJson(value), nowIso())
    return this.getTheme(key)
  }

  /** Remove one theme key so its default from settings.js applies again. */
  deleteTheme(key) {
    return this.stmt('DELETE FROM theme_config WHERE theme_key = ?').run(String(key)).changes > 0
  }

  /** Every theme key as a plain object — used to build the live menu config. */
  allTheme() {
    const rows = this.stmt('SELECT theme_key, theme_value, updated_at FROM theme_config').all()
    const output = {}
    for (const row of rows) output[row.theme_key] = fromJson(row.theme_value, row.theme_value)
    return output
  }

  // ────────────────────────────────────────────────────────────
  //  LID ↔ PN mappings
  // ────────────────────────────────────────────────────────────

  setLidMapping(lid, pn) {
    const lidKey = normalizeJid(lid)
    const pnKey = normalizeJid(pn)
    if (!lidKey || !pnKey) return null
    const timestamp = nowIso()
    this.stmt(`
      INSERT INTO lid_mappings (lid, pn, created_at, updated_at)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(lid) DO UPDATE SET pn = excluded.pn, updated_at = excluded.updated_at
    `).run(lidKey, pnKey, timestamp, timestamp)
    return { lid: lidKey, pn: pnKey }
  }

  getPnForLid(lid) {
    const row = this.stmt('SELECT pn FROM lid_mappings WHERE lid = ?').get(normalizeJid(lid))
    return row?.pn ?? null
  }

  getLidForPn(pn) {
    const row = this.stmt('SELECT lid FROM lid_mappings WHERE pn = ? ORDER BY updated_at DESC LIMIT 1').get(normalizeJid(pn))
    return row?.lid ?? null
  }

  // ────────────────────────────────────────────────────────────
  //  Introspection
  // ────────────────────────────────────────────────────────────

  /** Snapshot used by `.runtime` and the boot log. */
  status() {
    if (!isConnected()) {
      return { connected: false, path: this.path, version: null, tables: 0, sizeBytes: null }
    }
    const tables = Number(
      this.stmt("SELECT COUNT(*) AS total FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'").get()
        ?.total ?? 0
    )
    let sizeBytes = null
    try {
      const pageCount = this.stmt('PRAGMA page_count').get()?.page_count
      const pageSize = this.stmt('PRAGMA page_size').get()?.page_size
      if (pageCount && pageSize) sizeBytes = Number(pageCount) * Number(pageSize)
    } catch {
      /* size is informational only */
    }
    return {
      connected: true,
      path: getConnectionPath() ?? this.path,
      version: getCurrentVersion(this.ensure()),
      latestVersion: LATEST_VERSION,
      pending: pendingMigrations(this.ensure()).length,
      tables,
      sizeBytes
    }
  }

  /** Cheap integrity probe used at boot and by `.runtime`. */
  healthCheck() {
    try {
      this.ensure().prepare('SELECT 1 AS ok').get()
      return true
    } catch {
      return false
    }
  }

  /** Close the shared connection. Called by the graceful shutdown path. */
  close() {
    this.statements.clear()
    const closed = closeConnection()
    this.db = null
    return closed
  }
}

/** Build and open a manager in one call. */
export const createDatabase = ({ path, logger = null } = {}) => new DatabaseManager({ path, logger }).open()

export { migrations, LATEST_VERSION, getCurrentVersion, pendingMigrations }
export default DatabaseManager
