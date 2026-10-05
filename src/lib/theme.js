/**
 * KURO — Theme Manager store.
 *
 * Dynamic menu appearance (bot name, description, thumbnail) resolved from the
 * SQLite `theme_config` table with `settings.js` as the fallback:
 *
 *   getThemeConfig(db, config) → { botName, description, thumbnail, ... }
 *
 * Thumbnail sources:
 *   - a public HTTPS URL (validated against SSRF: no localhost, no private or
 *     link-local addresses, HTTPS only, size and type capped)
 *   - a WhatsApp image (reply) — downloaded, verified as a real image and
 *     stored under `media/thumbnails/`
 *
 * The menu pipeline reads the stored thumbnail straight from disk (the same
 * file the Theme Manager wrote), so a custom cover works without any web
 * server. The database only ever stores a KURO-managed reference
 * (`/media/thumbnails/thumb-*.ext`) — never a binary, never a base64 blob,
 * never a local absolute path, and never a public URL that nothing serves.
 *
 * Every step is defensive: a failure leaves the previous theme untouched.
 */

import fs from 'node:fs'
import net from 'node:net'
import path from 'node:path'
import { randomBytes } from 'node:crypto'
import { config as rootConfig } from '../config/index.js'
import { ensureDir } from './media.js'
import { getMessageLogger } from '../utils/message-logger.js'

// ── limits ───────────────────────────────────────────────────────────────────

export const THEME_LIMITS = Object.freeze({
  /** WhatsApp folds long preview bodies; keep the description short. */
  maxDescriptionLength: 200,
  /** Menu title / bot name length. */
  maxNameLength: 60,
  /** Largest accepted image, in bytes. */
  maxImageBytes: 5 * 1024 * 1024,
  /** Only these image types are accepted for the menu cover. */
  allowedMimeTypes: ['image/jpeg', 'image/png', 'image/webp']
})

/** Where downloaded thumbnails are stored (under the project root). */
export const THUMBNAIL_DIR = 'media/thumbnails'

/** Where the web server should expose the thumbnail directory from. */
export const THUMBNAIL_PUBLIC_PATH = '/media/thumbnails'

/** File name shape of a KURO-managed thumbnail (see `saveThumbnailFile`). */
export const THUMB_REF_PATTERN = /^thumb-\d+-[0-9a-f]+\.(?:jpg|png|webp)$/i

/**
 * `[THEME]` pipeline logging — helps debugging without ever leaking secrets
 * (no API keys, no session data, no credentials) and never throwing.
 */
export const themeLog = message => {
  try {
    getMessageLogger()?.logger?.info?.(`[THEME] ${message}`)
  } catch {
    /* logging must never break the pipeline */
  }
}

/** Magic numbers of the accepted image formats. */
const MAGIC_NUMBERS = [
  { mime: 'image/jpeg', bytes: [0xff, 0xd8, 0xff] },
  { mime: 'image/png', bytes: [0x89, 0x50, 0x4e, 0x47] },
  { mime: 'image/webp', bytes: [0x52, 0x49, 0x46, 0x46] }
]

/** Sniff the image type from the first bytes — never trust a name or header. */
export const sniffImageMime = buffer => {
  if (!Buffer.isBuffer(buffer) || buffer.length < 12) return null
  for (const candidate of MAGIC_NUMBERS) {
    if (candidate.bytes.every((byte, index) => buffer[index] === byte)) {
      // RIFF alone is not enough — WEBP needs the size in bytes 8-11.
      if (candidate.mime === 'image/webp' && buffer.toString('ascii', 8, 12) !== 'WEBP') continue
      return candidate.mime
    }
  }
  return null
}

/**
 * Is this URL safe to fetch — public HTTPS only?
 *
 * Rejects non-HTTPS schemes, credentials in the URL, unresolvable hosts and
 * every loopback / private / link-local address, so a theme command can never
 * be used to probe the VPS itself.
 */
export const validateImageUrl = async rawUrl => {
  const url = String(rawUrl ?? '').trim()
  if (!url) return { ok: false, reason: 'The URL is empty.' }

  let parsed
  try {
    parsed = new URL(url)
  } catch {
    return { ok: false, reason: 'That is not a valid URL.' }
  }

  if (parsed.protocol !== 'https:') {
    return { ok: false, reason: 'Only HTTPS URLs are accepted.' }
  }
  if (parsed.username || parsed.password) {
    return { ok: false, reason: 'URLs with credentials are not accepted.' }
  }

  const hostname = parsed.hostname.toLowerCase().replace(/^\[|\]$/g, '')
  const isIp = net.isIP(hostname) !== 0

  if (!isIp) {
    // A hostname that resolves to a private address is just as private.
    try {
      const { lookup } = await import('node:dns/promises')
      const records = await lookup(hostname, { all: true, verbatim: true })
      if (!records?.length) return { ok: false, reason: 'The host could not be resolved.' }
      for (const record of records) {
        if (isPrivateAddress(record.address)) {
          return { ok: false, reason: 'That host points to a private address.' }
        }
      }
    } catch {
      return { ok: false, reason: 'The host could not be resolved.' }
    }
  } else if (isPrivateAddress(hostname)) {
    return { ok: false, reason: 'That host points to a private address.' }
  }

  return { ok: true, url: parsed.toString() }
}

/** Loopback, private, link-local, CGNAT and the metadata addresses. */
export const isPrivateAddress = address => {
  const value = String(address ?? '')
  if (value === 'localhost') return true
  if (net.isIPv4(value)) {
    const [a, b] = value.split('.').map(Number)
    if (a === 10 || a === 127 || a === 0) return true
    if (a === 172 && b >= 16 && b <= 31) return true
    if (a === 192 && b === 168) return true
    if (a === 169 && b === 254) return true
    if (a === 100 && b >= 64 && b <= 127) return true
    return false
  }
  if (value.includes(':')) {
    const lower = value.toLowerCase()
    if (lower === '::1' || lower === '::') return true
    if (lower.startsWith('fe80') || lower.startsWith('fc') || lower.startsWith('fd')) return true
    if (lower.startsWith('::ffff:')) return isPrivateAddress(lower.slice(7))
  }
  return false
}

/**
 * Fetch an image over HTTPS with a hard size cap.
 *
 * @returns {Promise<{ ok: true, buffer: Buffer, contentType: string|null } | { ok: false, reason: string }>}
 */
export const fetchImageFromUrl = async (url, { maxBytes = THEME_LIMITS.maxImageBytes } = {}) => {
  const check = await validateImageUrl(url)
  if (!check.ok) return { ok: false, reason: check.reason }

  try {
    const response = await fetch(check.url, {
      redirect: 'follow',
      signal: AbortSignal.timeout(15_000),
      headers: { 'user-agent': 'KURO-Bot ThemeManager (+https://github.com)' }
    })
    if (!response.ok) return { ok: false, reason: `The server answered HTTP ${response.status}.` }

    const declaredType = String(response.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase()
    if (declaredType && !THEME_LIMITS.allowedMimeTypes.includes(declaredType)) {
      return { ok: false, reason: `The file is ${declaredType}, not an accepted image.` }
    }

    const declaredLength = Number(response.headers.get('content-length') ?? 0)
    if (declaredLength > maxBytes) {
      return { ok: false, reason: `The image is larger than the ${Math.round(maxBytes / 1024 / 1024)} MB limit.` }
    }

    const buffer = Buffer.from(await response.arrayBuffer())
    if (buffer.length > maxBytes) {
      return { ok: false, reason: `The image is larger than the ${Math.round(maxBytes / 1024 / 1024)} MB limit.` }
    }
    if (buffer.length < 64) {
      return { ok: false, reason: 'The downloaded file is too small to be an image.' }
    }

    const sniffed = sniffImageMime(buffer)
    if (!sniffed) return { ok: false, reason: 'The downloaded file is not a supported image.' }
    if (declaredType && declaredType !== sniffed && declaredType !== 'image/jpg') {
      return { ok: false, reason: 'The file content does not match its declared image type.' }
    }

    return { ok: true, buffer, contentType: sniffed }
  } catch (error) {
    const reason = error?.name === 'TimeoutError' ? 'The download timed out.' : `The download failed (${error?.message ?? 'unknown error'}).`
    return { ok: false, reason }
  }
}

/** Verify a downloaded WhatsApp image the same way a URL download is checked. */
export const verifyImageBuffer = buffer => {
  if (!Buffer.isBuffer(buffer) || buffer.length < 64) {
    return { ok: false, reason: 'The downloaded media is not a readable image.' }
  }
  if (buffer.length > THEME_LIMITS.maxImageBytes) {
    return { ok: false, reason: `The image is larger than the ${Math.round(THEME_LIMITS.maxImageBytes / 1024 / 1024)} MB limit.` }
  }
  const mime = sniffImageMime(buffer)
  if (!mime) return { ok: false, reason: 'The media is not a supported image (JPEG, PNG or WebP).' }
  return { ok: true, mime }
}

/** Extension for a sniffed mime type. */
const EXTENSIONS = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' }

/**
 * Persist a verified image under `media/thumbnails/` and return its public
 * path — relative to the project root, never an absolute filesystem path.
 *
 * @returns {{ ok: true, file: string, publicPath: string } | { ok: false, reason: string }}
 */
export const saveThumbnailFile = buffer => {
  try {
    const check = verifyImageBuffer(buffer)
    if (!check.ok) return check

    const directory = path.resolve(rootConfig?.paths?.root ?? process.cwd(), THUMBNAIL_DIR)
    ensureDir(directory)
    const file = path.join(directory, `thumb-${Date.now()}-${randomBytes(4).toString('hex')}.${EXTENSIONS[check.mime]}`)

    // Write to a temp name first, then rename — a crash cannot leave a
    // half-written image behind for the preview pipeline to trip over.
    const temp = `${file}.part`
    fs.writeFileSync(temp, buffer)
    fs.renameSync(temp, file)

    return { ok: true, file, publicPath: `${THUMBNAIL_PUBLIC_PATH}/${path.basename(file)}` }
  } catch (error) {
    return { ok: false, reason: `Could not store the image (${error?.message ?? 'unknown error'}).` }
  }
}

/**
 * The public URL a stored thumbnail WOULD be reachable at, if `menu.url`
 * pointed at a public origin that actually serves `media/thumbnails/`.
 *
 * NOTE: the KURO menu pipeline does not need this URL — it reads the stored
 * file directly (see `getThemeConfig`). Kept for tooling and diagnostics.
 */
export const publicThumbnailUrl = publicPath => {
  const base = String(rootConfig?.menu?.url ?? '').trim().replace(/\/+$/, '')
  if (!base || !/^https:\/\//i.test(base)) return null
  return `${base}${publicPath}`
}

/**
 * The KURO-managed public path (`/media/thumbnails/thumb-*.ext`) a stored
 * thumbnail reference points at — accepted as a stored path OR a full URL —
 * or `null` when the reference is NOT a KURO-managed thumbnail (e.g. the
 * settings.js `menu.thumbnail` default or an external CDN URL), which must
 * never be healed or deleted by the theme pipeline.
 *
 * @param {string} value  stored `thumbnail_url` value
 * @returns {string|null}
 */
export const thumbnailPublicPathFromUrl = value => {
  const text = String(value ?? '').trim()
  if (!text) return null
  if (/^https?:\/\//i.test(text)) {
    try {
      const url = new URL(text)
      const name = path.basename(url.pathname)
      if (url.pathname.startsWith(`${THUMBNAIL_PUBLIC_PATH}/`) && THUMB_REF_PATTERN.test(name)) {
        return `${THUMBNAIL_PUBLIC_PATH}/${name}`
      }
    } catch {
      /* not a URL after all */
    }
    return null
  }
  const name = path.basename(text.replace(/\\/g, '/'))
  return THUMB_REF_PATTERN.test(name) ? `${THUMBNAIL_PUBLIC_PATH}/${name}` : null
}

let cachedDb = null
let themeConfigCache = null

/** Invalidate the in-memory theme configuration cache. */
export const invalidateThemeCache = () => {
  cachedDb = null
  themeConfigCache = null
}

/**
 * Resolve the live theme values: SQLite first, `settings.js` as the default.
 * Cached in memory for near-instant .menu performance.
 *
 * @param {object} db   DatabaseManager (may be null → pure defaults)
 * @param {object} config
 * @param {{ forceRefresh?: boolean }} [options]
 * @returns {{ botName: string, description: string, thumbnail: string, title: string, source: object }}
 */
export const getThemeConfig = (db, config, { forceRefresh = false } = {}) => {
  if (!forceRefresh && themeConfigCache !== null && cachedDb === db) {
    return themeConfigCache
  }

  const defaultName = config?.theme?.name ?? config?.botName ?? 'KURO'
  const defaultDesc = config?.theme?.description ?? config?.menu?.description ?? ''
  const defaultThumb = config?.theme?.thumbnail ?? config?.menu?.thumbnail ?? ''

  const defaults = {
    name: defaultName,
    botName: defaultName,
    description: defaultDesc,
    thumbnail: defaultThumb
  }
  if (!db || typeof db.getTheme !== 'function') {
    const result = {
      ...defaults,
      title: config?.theme?.name ?? config?.menu?.title ?? defaults.botName,
      source: { botName: 'default', description: 'default', thumbnail: 'default' }
    }
    themeConfigCache = result
    return result
  }

  const stored = {
    botName: db.getTheme('bot_name', null),
    description: db.getTheme('description', null),
    thumbnail: db.getTheme('thumbnail_url', null)
  }

  const activeName = stored.botName ?? defaults.botName

  // ── thumbnail reference resolution ─────────────────────────
  // A Theme Manager thumbnail is stored as a KURO-managed reference
  // (`/media/thumbnails/thumb-*.ext`) or — for rows written by older builds —
  // as a public URL that points back at this bot's own media folder. The menu
  // pipeline reads the file from disk, so here the reference is (a) healed to
  // the path form when the file exists, or (b) dropped when it does not, so
  // the menu falls back to the configured default instead of a dead cover.
  let thumbnail = stored.thumbnail ?? defaults.thumbnail
  let thumbnailSource = stored.thumbnail !== null ? 'database' : 'default'
  const storedThumbPath = thumbnailPublicPathFromUrl(stored.thumbnail)
  if (storedThumbPath) {
    const file = path.resolve(rootConfig?.paths?.root ?? process.cwd(), `.${storedThumbPath}`)
    if (fs.existsSync(file)) {
      if (thumbnail !== storedThumbPath) {
        thumbnail = storedThumbPath
        try {
          db.setTheme('thumbnail_url', storedThumbPath)
        } catch {
          /* the heal is best-effort; the resolved path still works this boot */
        }
        themeLog(`Thumbnail reference healed: ${storedThumbPath}`)
      }
    } else {
      try {
        db.deleteTheme('thumbnail_url')
      } catch {
        /* best-effort */
      }
      thumbnail = defaults.thumbnail
      thumbnailSource = 'default'
      themeLog('Thumbnail reference is stale (file missing) — reverted to the default cover')
    }
  }

  const result = {
    name: activeName,
    botName: activeName,
    description: stored.description ?? defaults.description,
    thumbnail,
    title: stored.botName ?? config?.theme?.name ?? config?.menu?.title ?? defaults.botName,
    source: {
      botName: stored.botName !== null ? 'database' : 'default',
      description: stored.description !== null ? 'database' : 'default',
      thumbnail: thumbnailSource
    }
  }

  cachedDb = db
  themeConfigCache = result
  return result
}

/**
 * Central resolver for effective theme, returning { name, description, thumbnail, ... }.
 */
export const getEffectiveTheme = (db, config, options) => getThemeConfig(db, config, options)

/**
 * Clean up an uploaded thumbnail file from media/thumbnails/ if no longer used.
 *
 * @param {string} urlOrPath
 */
export const cleanupOldThumbnailFile = urlOrPath => {
  try {
    if (!urlOrPath || typeof urlOrPath !== 'string') return false
    const match = urlOrPath.match(/thumb-\d+-[0-9a-f]+\.(?:jpg|png|webp)/i)
    if (!match) return false
    const filename = match[0]
    const rootDir = rootConfig?.paths?.root ?? process.cwd()
    const filePath = path.resolve(rootDir, THUMBNAIL_DIR, filename)
    if (fs.existsSync(filePath)) {
      fs.rmSync(filePath, { force: true })
      return true
    }
  } catch {
    /* ignore deletion errors */
  }
  return false
}

/**
 * Delete all files in the thumbnail storage directory (media/thumbnails/) to free server disk space.
 *
 * @returns {number} The count of deleted files.
 */
export const clearThumbnailsDirectory = () => {
  let count = 0
  try {
    const rootDir = rootConfig?.paths?.root ?? process.cwd()
    const directory = path.resolve(rootDir, THUMBNAIL_DIR)
    if (!fs.existsSync(directory)) return 0
    const entries = fs.readdirSync(directory)
    for (const entry of entries) {
      const filePath = path.join(directory, entry)
      try {
        const stat = fs.statSync(filePath)
        if (stat.isFile()) {
          fs.unlinkSync(filePath)
          count++
        }
      } catch {
        /* ignore individual file deletion errors */
      }
    }
  } catch {
    /* non-fatal */
  }
  return count
}

export default {
  THEME_LIMITS,
  THUMBNAIL_DIR,
  THUMBNAIL_PUBLIC_PATH,
  THUMB_REF_PATTERN,
  themeLog,
  sniffImageMime,
  validateImageUrl,
  isPrivateAddress,
  fetchImageFromUrl,
  verifyImageBuffer,
  saveThumbnailFile,
  publicThumbnailUrl,
  thumbnailPublicPathFromUrl,
  getThemeConfig,
  getEffectiveTheme,
  invalidateThemeCache,
  cleanupOldThumbnailFile,
  clearThumbnailsDirectory
}
