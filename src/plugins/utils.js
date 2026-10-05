/**
 * KURO — plugin utilities.
 *
 * Validation happens *before* registration so a malformed plugin produces one
 * clear line in the log instead of a confusing runtime error later. A plugin
 * that fails validation is skipped; the bot keeps running.
 */

import fs from 'node:fs'
import path from 'node:path'
import { titleCase } from '../utils/format.js'

/** Recognised metadata fields, with their expected type. */
const METADATA_SHAPE = {
  name: 'string',
  command: 'string|array',
  aliases: 'string|array',
  category: 'string',
  description: 'string',
  usage: 'string',
  example: 'string',
  ownerOnly: 'boolean',
  adminOnly: 'boolean',
  groupOnly: 'boolean',
  privateOnly: 'boolean',
  botAdmin: 'boolean',
  hidden: 'boolean',
  enabled: 'boolean'
}

const typeOf = value => {
  if (Array.isArray(value)) return 'array'
  if (value === null) return 'null'
  return typeof value
}

const matches = (value, expected) => expected.split('|').includes(typeOf(value))

/**
 * Collect the names of plugins whose command is `command`.
 */
export const pluginsByCommand = (registry, command) => {
  const record = registry?.resolve(command)
  return record ? [record] : []
}

/**
 * Validate a plugin module.
 *
 * @param {any} plugin
 * @param {{ file?: string }} [meta]
 * @returns {{ ok: boolean, errors: string[], warnings: string[] }}
 */
export const validatePlugin = (plugin, { file = '' } = {}) => {
  const errors = []
  const warnings = []

  if (!plugin || typeof plugin !== 'object') {
    return { ok: false, errors: ['module has no default export object'], warnings }
  }

  if (typeof plugin.name !== 'string' || !plugin.name.trim()) {
    errors.push('missing a non-empty "name"')
  } else if (!/^[a-z0-9._-]+$/i.test(plugin.name.trim())) {
    errors.push('"name" may only contain letters, digits, dot, dash and underscore')
  }

  const commands = plugin.command
  if (!commands || (typeof commands !== 'string' && !Array.isArray(commands))) {
    errors.push('missing "command" (a string or an array of strings)')
  } else {
    const list = Array.isArray(commands) ? commands : [commands]
    if (list.filter(Boolean).length === 0) errors.push('"command" is empty')
    for (const entry of list.filter(Boolean)) {
      if (typeof entry !== 'string') errors.push('every "command" entry must be a string')
      else if (/\s/.test(entry)) errors.push(`command "${entry}" may not contain spaces`)
    }
  }

  if (typeof plugin.execute !== 'function') {
    errors.push('missing an "execute" function')
  }

  for (const [field, expected] of Object.entries(METADATA_SHAPE)) {
    if (field in plugin && plugin[field] !== undefined && !matches(plugin[field], expected)) {
      // `command`/`aliases` accept either shape; everything else must match.
      errors.push(`"${field}" must be a ${expected.replace('|', ' or ')}, got ${typeOf(plugin[field])}`)
    }
  }

  if (plugin.adminOnly && plugin.ownerOnly) {
    warnings.push('declares both adminOnly and ownerOnly — ownerOnly wins')
  }
  if (!file) warnings.push('loaded without a source path, so it cannot be reloaded')

  return { ok: errors.length === 0, errors, warnings }
}

/** Normalise a plugin record into the shape the menu and `.plugins` render. */
export const describePlugin = record => ({
  name: record.name,
  category: record.category,
  description: record.description,
  usage: record.usage,
  example: record.example,
  commands: record.commands,
  aliases: record.aliases,
  enabled: record.enabled,
  ownerOnly: record.ownerOnly,
  adminOnly: record.adminOnly,
  groupOnly: record.groupOnly,
  privateOnly: record.privateOnly,
  botAdmin: record.botAdmin,
  hidden: record.hidden,
  file: record.file
})

/** Read a plugin's source from disk, refusing anything oversized. */
export const readPluginSource = (file, { maxBytes = 512 * 1024 } = {}) => {
  const stat = fs.statSync(file)
  if (stat.size > maxBytes) {
    throw new Error(`plugin source is ${stat.size} bytes, over the ${maxBytes} byte limit`)
  }
  return fs.readFileSync(file, 'utf8')
}

/**
 * Turn a category folder name into the label used in the menu.
 * `downloaders` → `DOWNLOADERS`
 */
export const categoryLabel = value => titleCase(value).toUpperCase()

/**
 * Build the category → lines text used by `.plugins` and `.menu`.
 */
export const renderCategoryList = (groups, { showDescription = true } = {}) => {
  const blocks = []
  for (const category of Object.keys(groups).sort()) {
    const lines = groups[category]
      .map(record => {
        const trigger = record.commands[0]
        return showDescription && record.description ? `- ${trigger} — ${record.description}` : `- ${trigger}`
      })
      .join('\n')
    blocks.push(`*${categoryLabel(category)}*\n${lines}`)
  }
  return blocks.join('\n\n')
}

/** Sort plugin files deterministically so load order is reproducible. */
export const sortPluginFiles = files => [...files].sort((a, b) => a.localeCompare(b))

/** `plugins/general/ping.js` → `general` */
export const categoryFromPath = (file, root) => {
  const relative = path.relative(root, file)
  const parts = relative.split(path.sep)
  return parts.length > 1 ? parts[0] : 'general'
}

export default {
  validatePlugin,
  describePlugin,
  readPluginSource,
  categoryLabel,
  renderCategoryList,
  sortPluginFiles,
  categoryFromPath,
  pluginsByCommand
}
