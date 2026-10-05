/**
 * KURO — menu manager.
 *
 * Builds the dynamic menu data from the plugin registry:
 *
 *   categoryArray   ['general', 'tools', …]                 (ordered)
 *   categoryMap     category → { name, commandArray }      (command-only)
 *   allMenuText     the styled `┌─── ❖` blocks              (styledAllMenu)
 *
 * Only plugins that actually load are listed — a file that failed validation
 * never reaches the registry, so it can never appear here.
 */

import { categoryLabel } from '../plugins/utils.js'

/** Preferred display order; anything unknown is appended alphabetically. */
const CATEGORY_ORDER = ['general', 'tools', 'ai', 'downloader', 'group', 'fun', 'owner']

const orderCategories = names =>
  [...names].sort((a, b) => {
    const indexA = CATEGORY_ORDER.indexOf(a)
    const indexB = CATEGORY_ORDER.indexOf(b)
    if (indexA !== -1 && indexB !== -1) return indexA - b === 0 ? 0 : indexA - indexB
    if (indexA !== -1) return -1
    if (indexB !== -1) return 1
    return a.localeCompare(b)
  })

/** Pick one element at random; `null` for an empty array (spec §6). */
export const getOneRandomElemenFrom = list => {
  if (!Array.isArray(list) || list.length === 0) return null
  return list[Math.floor(Math.random() * list.length)]
}

export class MenuManager {
  /**
   * @param {object} options
   * @param {object} options.registry      PluginRegistry
   * @param {object} [options.ctx]         Execution context (for permission filtering)
   * @param {object} [options.config]
   */
  constructor({ registry, ctx = null, config = null }) {
    this.registry = registry ?? { byCategory: () => ({}) }
    this.ctx = ctx
    this.config = config ?? ctx?.config ?? {}
    this.categoryMap = new Map()
    this.categoryArray = []
    this.allMenuText = ''
    this.rebuild()
  }

  /** Can `this.ctx` run this plugin? Without a ctx, everything is listed. */
  canUse(record) {
    if (!this.ctx) return true
    if (record.ownerOnly && !this.ctx.isOwner) return false
    if (record.groupOnly && !this.ctx.isGroup) return false
    if (record.privateOnly && this.ctx.isGroup) return false
    if (record.adminOnly && !this.ctx.isAdmin && !this.ctx.isOwner) return false
    if (record.botAdmin && !this.ctx.isBotAdmin) return false
    return true
  }

  /** Recompute categoryArray / categoryMap / allMenuText from the registry. */
  rebuild() {
    const groups = this.registry.byCategory ? this.registry.byCategory({ includeHidden: false }) : {}
    this.categoryMap = new Map()
    this.categoryArray = []

    for (const category of orderCategories(Object.keys(groups))) {
      const commandArray = (groups[category] ?? [])
        .filter(record => this.canUse(record))
        .map(record => record.commands[0])

      // Categories with no usable commands are skipped entirely — an empty
      // box tells the user nothing (spec §7).
      if (commandArray.length === 0) continue

      this.categoryMap.set(category, { name: categoryLabel(category), commandArray })
      this.categoryArray.push(category)
    }

    this.allMenuText = this.buildStyledAllMenu()
    return this
  }

  /** The `┌─── ❖ *CATEGORY*` blocks, commands only (spec RULE 12). */
  buildStyledAllMenu() {
    const blocks = []
    for (const [category, entry] of this.categoryMap.entries()) {
      const lines = entry.commandArray.map(command => `│ • ${command}`)
      blocks.push([`┌─── ❖ *${entry.name}*`, ...lines, '└───────────────┈'].join('\n'))
    }
    return blocks.join('\n\n')
  }

  /** Commands of one category; a missing category yields `[]` (spec §7). */
  commandsOf(category) {
    return this.categoryMap.get(String(category ?? ''))?.commandArray ?? []
  }

  /** Registry record for one command — used for `bypassPrefix`. */
  getPluginRecord(command) {
    return this.registry.resolve ? this.registry.resolve(command) : null
  }

  get size() {
    return this.categoryArray.length
  }

  get commandCount() {
    let total = 0
    for (const entry of this.categoryMap.values()) total += entry.commandArray.length
    return total
  }
}

/**
 * `buatKataKata()` — the "how to invoke" footer from the original spec:
 * a random example line under the menu, honouring `bypassPrefix`.
 *
 * @param {string} displayPrefix   Prefix to show (already bypass-resolved)
 * @param {string|null} command    The random command, if any
 * @param {string} header          The header/menu text built so far
 * @returns {string} The full message content
 */
export const buatKataKata = (displayPrefix = '', command = null, header = '') => {
  const base = String(header ?? '')
  if (!command) return `${base}\n`
  return `${base}\n⚡ Coba: \`${displayPrefix}${command}\`\n`
}

export default MenuManager
