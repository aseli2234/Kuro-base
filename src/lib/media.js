/**
 * KURO — media helpers.
 *
 * Downloading itself lives in `src/lib/messages.js#downloadMedia`; this module
 * covers what you do with the result: temp files, buffers, extensions and
 * cleanup.
 */

import fs from 'node:fs'
import path from 'node:path'
import { randomBytes } from 'node:crypto'

const EXTENSION_BY_MIME = {
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'video/mp4': 'mp4',
  'video/3gpp': '3gp',
  'audio/mpeg': 'mp3',
  'audio/mp4': 'm4a',
  'audio/ogg': 'ogg',
  'application/pdf': 'pdf',
  'application/zip': 'zip',
  'text/plain': 'txt',
  'application/json': 'json'
}

/** Best-effort file extension for a mimetype. */
export const extensionFor = mimetype => EXTENSION_BY_MIME[String(mimetype ?? '').toLowerCase()] ?? 'bin'

/** Create the temp directory if it is missing. */
export const ensureDir = directory => {
  fs.mkdirSync(directory, { recursive: true })
  return directory
}

/** Write a buffer into the temp directory and return the path. */
export const saveTmp = (buffer, extension = 'bin', tmpDir) => {
  if (!Buffer.isBuffer(buffer)) throw new TypeError('saveTmp() expects a Buffer')
  const directory = ensureDir(tmpDir ?? path.resolve(process.cwd(), 'tmp'))
  const file = path.join(directory, `${Date.now()}-${randomBytes(4).toString('hex')}.${extension}`)
  fs.writeFileSync(file, buffer)
  return file
}

/** Remove a file, ignoring "already gone". */
export const removeFile = file => {
  try {
    fs.unlinkSync(file)
    return true
  } catch {
    return false
  }
}

/** Delete every file in the temp directory older than `maxAgeMs`. */
export const cleanTmp = (tmpDir, maxAgeMs = 60 * 60 * 1000) => {
  let removed = 0
  try {
    const directory = tmpDir ?? path.resolve(process.cwd(), 'tmp')
    if (!fs.existsSync(directory)) return 0
    const cutoff = Date.now() - maxAgeMs
    for (const entry of fs.readdirSync(directory)) {
      const file = path.join(directory, entry)
      try {
        const stat = fs.statSync(file)
        if (stat.isFile() && stat.mtimeMs < cutoff) {
          fs.unlinkSync(file)
          removed += 1
        }
      } catch {
        /* a file that vanished mid-scan is already clean */
      }
    }
  } catch {
    /* the temp folder is scratch space; failures are non-fatal */
  }
  return removed
}

/** Read a local file or a remote URL into a Buffer. */
export const toBuffer = async source => {
  if (Buffer.isBuffer(source)) return source
  if (typeof source !== 'string') throw new TypeError('toBuffer() expects a Buffer, path or URL')
  if (/^https?:\/\//i.test(source)) {
    const response = await fetch(source)
    if (!response.ok) throw new Error(`Failed to fetch ${source}: HTTP ${response.status}`)
    return Buffer.from(await response.arrayBuffer())
  }
  return fs.readFileSync(source)
}

/** Base64 of a buffer, optionally as a data URL. */
export const toBase64 = (buffer, mimetype = '') =>
  mimetype ? `data:${mimetype};base64,${buffer.toString('base64')}` : buffer.toString('base64')

export default {
  extensionFor,
  ensureDir,
  saveTmp,
  removeFile,
  cleanTmp,
  toBuffer,
  toBase64
}
