/**
 * KURO — plugin file management.
 *
 * The owner commands `.addplugin`, `.getplugin` and `.delplugin` all go through
 * here. Two rules keep it safe:
 *
 *   1. every path is resolved *inside* the plugin directory and re-checked
 *      after resolution, so `../../settings.js` can never be written or read
 *   2. the plugin name is slugified, so it can never introduce a path segment
 */

import fs from 'node:fs'
import path from 'node:path'
import { slugify } from '../utils/format.js'

/** Resolve a plugin file path, refusing anything outside `directory`. */
export const resolvePluginPath = ({ directory, category = 'general', name }) => {
  const safeCategory = slugify(category || 'general')
  const safeName = slugify(name)
  if (!safeName) throw new Error('A plugin name is required.')
  const target = path.resolve(directory, safeCategory, `${safeName}.js`)
  const root = path.resolve(directory)
  if (target !== root && !target.startsWith(root + path.sep)) {
    throw new Error('Refusing to touch a path outside the plugin directory.')
  }
  return target
}

/** Write a plugin file, creating the category folder when needed. */
export const writePluginFile = ({ directory, category, name, source, overwrite = false }) => {
  if (typeof source !== 'string' || source.trim().length === 0) {
    throw new Error('The plugin source is empty.')
  }
  const target = resolvePluginPath({ directory, category, name })
  if (fs.existsSync(target) && !overwrite) {
    throw new Error(`${path.relative(directory, target)} already exists — pass overwrite to replace it.`)
  }
  fs.mkdirSync(path.dirname(target), { recursive: true })
  fs.writeFileSync(target, source, 'utf8')
  return { file: target, bytes: Buffer.byteLength(source, 'utf8') }
}

/** Read a plugin file back as text. */
export const readPluginFile = ({ directory, category, name, file = null }) => {
  const target = file ? path.resolve(file) : resolvePluginPath({ directory, category, name })
  const root = path.resolve(directory)
  if (!target.startsWith(root + path.sep)) {
    throw new Error('Refusing to read a path outside the plugin directory.')
  }
  return { file: target, source: fs.readFileSync(target, 'utf8') }
}

/** Delete a plugin file, refusing to leave the plugin directory. */
export const deletePluginFile = ({ directory, file }) => {
  const root = path.resolve(directory)
  const target = path.resolve(file)
  if (!target.startsWith(root + path.sep)) {
    throw new Error('Refusing to delete a path outside the plugin directory.')
  }
  if (!fs.existsSync(target)) throw new Error(`${path.basename(target)} no longer exists.`)
  fs.unlinkSync(target)
  return { file: target }
}

/** List every plugin file with its relative path and size. */
export const listPluginFiles = directory => {
  const root = path.resolve(directory)
  const output = []
  const walk = current => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name)
      if (entry.isDirectory()) walk(full)
      else if (entry.isFile() && entry.name.endsWith('.js')) {
        output.push({
          file: full,
          relative: path.relative(root, full),
          bytes: fs.statSync(full).size,
          disabled: entry.name.startsWith('_')
        })
      }
    }
  }
  if (fs.existsSync(root)) walk(root)
  return output.sort((a, b) => a.relative.localeCompare(b.relative))
}

/**
 * Extract plugin source from an incoming message.
 *
 * Accepts, in order: an attached `.js` document, a quoted `.js` document, or
 * plain text that looks like a module. Nothing is executed here — the caller
 * decides whether to write and load it.
 *
 * @param {object} ctx  The command context
 * @param {(target: object) => Promise<Buffer|null>} download  Media downloader
 * @returns {Promise<{ source: string, origin: string }>}
 */
export const extractPluginSource = async (ctx, download) => {
  const isJs = target =>
    Boolean(target) &&
    (target.fileName?.endsWith('.js') || target.mimetype === 'application/javascript' || target.mimetype === 'text/javascript')

  // 1. Attached document
  if (isJs(ctx.m) && ctx.m.isMedia) {
    const buffer = await download(ctx.m)
    if (buffer) return { source: buffer.toString('utf8'), origin: ctx.m.fileName ?? 'attachment' }
  }

  // 2. A `.js` file inside the quoted message
  const quoted = ctx.message?.message
  const quotedContent = ctx.quoted?.message
  if (quotedContent) {
    const quotedIsJs =
      quotedContent.documentMessage?.fileName?.endsWith('.js') ||
      quotedContent.documentMessage?.mimetype === 'application/javascript'
    if (quotedIsJs) {
      const buffer = await download({ raw: { key: ctx.m.key, message: quoted }, fileName: quotedContent.documentMessage.fileName })
      if (buffer) return { source: buffer.toString('utf8'), origin: quotedContent.documentMessage.fileName }
    }
  }

  // 3. Quoted text that looks like a module
  if (ctx.quoted?.text && /export\s+default|module\.exports|^\s*import\s/m.test(ctx.quoted.text)) {
    return { source: ctx.quoted.text, origin: 'quoted text' }
  }

  // 4. Inline text after the command
  if (ctx.argText && /export\s+default/.test(ctx.argText)) {
    return { source: ctx.argText, origin: 'inline text' }
  }

  throw new Error(
    'No plugin source found. Attach a .js file, reply to one with the command, or paste the source inline.'
  )
}

export default {
  resolvePluginPath,
  writePluginFile,
  readPluginFile,
  deletePluginFile,
  listPluginFiles,
  extractPluginSource
}
