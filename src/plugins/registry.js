/**
 * KURO — plugin registry.
 *
 * Holds every loaded plugin and resolves a typed command back to its module.
 * Two maps matter:
 *
 *   plugins  name        → record
 *   commands trigger     → record   (command names *and* aliases, lowercased)
 *
 * A duplicate trigger never replaces the incumbent: the first plugin to claim
 * it wins and the clash is recorded in `conflicts` so `.plugins` can report it.
 */

export class PluginRegistry {
  constructor({ logger = null } = {}) {
    this.logger = logger
    this.plugins = new Map()
    this.commands = new Map()
    this.conflicts = []
    this.failures = []
  }

  /**
   * Register a validated plugin.
   *
   * @param {object} plugin          The module's default export
   * @param {{ file: string, category?: string }} meta
   * @returns {{ ok: boolean, reason?: string, record?: object }}
   */
  register(plugin, { file, category = 'general' } = {}) {
    if (!plugin?.name) return { ok: false, reason: 'plugin has no name' }
    if (this.plugins.has(plugin.name)) {
      return { ok: false, reason: `a plugin named "${plugin.name}" is already registered` }
    }

    const commands = (Array.isArray(plugin.command) ? plugin.command : [plugin.command])
      .filter(Boolean)
      .map(value => String(value).toLowerCase())

    if (commands.length === 0) return { ok: false, reason: 'plugin declares no command' }

    const aliases = (Array.isArray(plugin.aliases) ? plugin.aliases : plugin.aliases ? [plugin.aliases] : [])
      .filter(Boolean)
      .map(value => String(value).toLowerCase())

    const record = {
      name: plugin.name,
      plugin,
      file,
      category: plugin.category ?? category,
      description: plugin.description ?? '',
      usage: plugin.usage ?? '',
      example: plugin.example ?? '',
      hidden: Boolean(plugin.hidden),
      enabled: plugin.enabled !== false,

      commands,
      aliases,
      /** Every trigger this plugin answers to. */
      triggers: [...new Set([...commands, ...aliases])],

      ownerOnly: Boolean(plugin.ownerOnly),
      adminOnly: Boolean(plugin.adminOnly),
      groupOnly: Boolean(plugin.groupOnly),
      privateOnly: Boolean(plugin.privateOnly),
      botAdmin: Boolean(plugin.botAdmin),

      execute: plugin.execute,
      loadedAt: Date.now()
    }

    const claimed = []
    for (const trigger of record.triggers) {
      const existing = this.commands.get(trigger)
      if (existing) {
        const conflict = { trigger, plugin: record.name, keptBy: existing.name }
        this.conflicts.push(conflict)
        this.logger?.warn?.(`Conflict on "${trigger}": "${record.name}" ignored, "${existing.name}" already owns it.`)
        continue
      }
      this.commands.set(trigger, record)
      claimed.push(trigger)
    }

    if (claimed.length === 0) {
      return { ok: false, reason: `every trigger is already taken (${record.triggers.join(', ')})` }
    }

    this.plugins.set(record.name, record)
    return { ok: true, record }
  }

  /** Look up the plugin that answers to a trigger. */
  resolve(trigger) {
    if (!trigger) return null
    return this.commands.get(String(trigger).toLowerCase()) ?? null
  }

  /** Look up a plugin by its name. */
  get(name) {
    return this.plugins.get(String(name)) ?? null
  }

  /** Remove a plugin and release all of its triggers. */
  unregister(name) {
    const record = this.plugins.get(String(name))
    if (!record) return false
    for (const trigger of record.triggers) {
      if (this.commands.get(trigger) === record) this.commands.delete(trigger)
    }
    this.plugins.delete(String(name))
    return true
  }

  /** Enable or disable a plugin without unloading it. */
  setEnabled(name, enabled) {
    const record = this.plugins.get(String(name))
    if (!record) return false
    record.enabled = Boolean(enabled)
    return true
  }

  isEnabled(name) {
    return Boolean(this.plugins.get(String(name))?.enabled)
  }

  /** Every primary command name, sorted — what the menu advertises. */
  commandNames() {
    return [...this.plugins.values()].flatMap(record => record.commands).sort()
  }

  all() {
    return [...this.plugins.values()].sort((a, b) => a.name.localeCompare(b.name))
  }

  /** Visible plugins grouped by category, for the dynamic menu. */
  byCategory({ includeHidden = false } = {}) {
    const groups = {}
    for (const record of this.all()) {
      if (record.hidden && !includeHidden) continue
      if (!groups[record.category]) groups[record.category] = []
      groups[record.category].push(record)
    }
    return groups
  }

  /** Record a plugin that failed to load, so `.plugins` can surface it. */
  recordFailure(file, error) {
    this.failures.push({ file, error: error?.message ?? String(error) })
  }

  clear() {
    this.plugins.clear()
    this.commands.clear()
    this.conflicts = []
    this.failures = []
  }

  get size() {
    return this.plugins.size
  }

  get commandCount() {
    return this.commands.size
  }
}

export default PluginRegistry
