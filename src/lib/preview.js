/**
 * KURO — link preview cards.
 *
 * The menu's LARGE full-width card uses the `thumbnail-link` flow (the same
 * mechanism as Angelina Bot's `createThumbnailLink`): the cover is uploaded
 * through `prepareWAMessageMedia(…, { mediaTypeOverride: 'thumbnail-link' })`
 * and the returned `imageMessage` fields (`directPath`, `mediaKey`,
 * `fileSha256`, …) are copied onto a manually built `extendedTextMessage`
 * which is relayed via `sock.relayMessage()`. The URL leads the body
 * (`text: url + '\n' + content`) so the client folds it into the card.
 *
 * Fallbacks, in order:
 *
 * 1. `thumbnail-link` — the large card (needs `sock.waUploadToServer`)
 * 2. `externalAdReply` — large card from an inline JPEG in `contextInfo`
 *    (`renderLargerThumbnail`), body stays clean
 * 3. `extendedTextMessage` — classic manual inline-JPEG preview, chosen when
 *    `thumbnailHeightRatioOverride > 0` (URL appended so the preview renders)
 * 4. `richLink` — only when the body already contains the URL
 * 5. plain text
 *
 * Cover sources: remote HTTPS URLs are fetched once per URL; local paths are
 * read from disk (root-relative paths like the Theme Manager's
 * `/media/thumbnails/thumb-*.jpg` public path are resolved against the
 * project root). WhatsApp never receives the local path or its URL — the
 * cover always rides inside the message as an uploaded blob or an inline
 * JPEG, so no web server is needed for a custom theme cover.
 *
 * Every failure path degrades: a broken cover falls through to the next
 * mode, and the menu itself is always delivered exactly once.
 *
 * All are wrapped here so plugins never touch the raw option shapes.
 */

import fs from 'node:fs'
import path from 'node:path'
import {
  generateWAMessageFromContent,
  hasOptionalMedia,
  prepareWAMessageMedia
} from '@rexxhayanasi/elaina-baileys'
import { getMessageLogger } from '../utils/message-logger.js'
import { config as rootConfig } from '../config/index.js'

/**
 * Resolve a cover source against the project root (paths may be relative).
 *
 * The Theme Manager's public path (`/media/thumbnails/thumb-*.ext`) starts
 * with a slash but is project-root-relative — on Windows `path.resolve` would
 * otherwise pin it to the current drive root, and on Linux to the filesystem
 * root, so that exact shape is joined onto the project root explicitly.
 */
const resolveCoverPath = value => {
  const root = rootConfig?.paths?.root ?? process.cwd()
  if (/^\/media\/thumbnails\/thumb-\d+-[0-9a-f]+\.(?:jpg|png|webp)$/i.test(value)) {
    return path.join(root, 'media', 'thumbnails', path.basename(value))
  }
  return path.isAbsolute(value) ? value : path.resolve(root, value)
}

/** Small `[THEME]` pipeline log line — never throws, never logs secrets. */
const themeLog = message => {
  try {
    getMessageLogger()?.logger?.info?.(`[THEME] ${message}`)
  } catch {
    /* logging must never break the pipeline */
  }
}

const IMAGE_LIBRARIES = ['sharp', '@napi-rs/image', 'jimp']

let imageLibraryCache = null

/**
 * Is a library available that can measure and scale a preview cover?
 * Without one, `richLink` cards cannot be uploaded at full size.
 */
export const hasImageLibrary = async () => {
  if (imageLibraryCache !== null) return imageLibraryCache
  for (const name of IMAGE_LIBRARIES) {
    try {
      if (await hasOptionalMedia(name)) {
        imageLibraryCache = name
        return name
      }
    } catch {
      /* try the next library */
    }
  }
  imageLibraryCache = false
  return false
}

/** Reset the cached probe (used after installing a library at runtime). */
export const resetImageLibraryCache = () => {
  imageLibraryCache = null
}

/**
 * Turn a configured thumbnail value into the `{ url }` shape Elaina accepts.
 * Accepts a remote URL or an existing local file (root-relative paths such as
 * the Theme Manager's `/media/thumbnails/thumb-*.jpg` are resolved against
 * the project root); returns `null` otherwise.
 */
export const thumbnailSource = value => {
  if (!value || typeof value !== 'string') return null
  if (/^https?:\/\//i.test(value)) return { url: value }
  try {
    const resolved = resolveCoverPath(value)
    if (fs.existsSync(resolved)) return { url: resolved }
  } catch {
    /* unreadable path is simply "no thumbnail" */
  }
  return null
}

/**
 * Read a local image into a Buffer for `externalAdReply.thumbnail`.
 * Remote URLs are fetched by the async `fetchRemoteCover` helper first —
 * this sync reader only handles local files; failures return `null`.
 */
const readThumbnailBuffer = value => {
  if (!value || typeof value !== 'string' || /^https?:\/\//i.test(value)) return null
  try {
    return fs.readFileSync(resolveCoverPath(value))
  } catch {
    return null
  }
}

/**
 * Fetch a remote cover once (5 s timeout) and cache the raw bytes by URL —
 * used by the ad-reply fallback when no image library can resize the cover.
 * A failed fetch returns `null` and is not cached (the next menu may retry).
 */
const remoteCoverCache = new Map()
const fetchRemoteCover = async url => {
  if (remoteCoverCache.has(url)) return remoteCoverCache.get(url)
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(5000) })
    if (!response.ok) return null
    const buffer = Buffer.from(await response.arrayBuffer())
    if (remoteCoverCache.size > 10) remoteCoverCache.delete(remoteCoverCache.keys().next().value)
    remoteCoverCache.set(url, buffer)
    return buffer
  } catch {
    return null
  }
}

/**
 * Build a `richLink` message body.
 *
 * @param {object} card
 * @param {string} card.text              Message body; the URL is appended when missing.
 * @param {string} card.url               Required by Elaina — the link the card opens.
 * @param {string} [card.title]
 * @param {string} [card.description]
 * @param {string|object} [card.image]    Local path or remote URL of the cover.
 * @param {boolean} [card.large]          `false` forces the small card.
 * @param {number} [card.thumbnailWidth]  Cover width, Elaina defaults to 640.
 * @param {number} [card.previewType]     `proto.Message.ExtendedTextMessage.PreviewType`
 * @param {object} [card.extra]           Any extra keys pass straight through.
 * @returns {object} `{ richLink: {...} }`
 */
export const buildRichLink = ({
  text = '',
  url,
  title,
  description,
  image,
  large,
  thumbnailWidth,
  previewType,
  extra = {}
} = {}) => {
  if (!url) throw new Error('buildRichLink() requires a url — Elaina rejects a richLink without one')

  const richLink = {
    ...extra,
    url,
    text: text || url
  }

  if (title) richLink.title = title
  if (description) richLink.description = description
  if (image) richLink.image = typeof image === 'string' ? thumbnailSource(image) ?? undefined : image
  if (large !== undefined) richLink.large = large
  if (thumbnailWidth !== undefined) richLink.thumbnailWidth = thumbnailWidth
  if (previewType !== undefined) richLink.previewType = previewType

  return { richLink }
}

/**
 * Build an `externalAdReply` card.
 *
 * @param {object} card
 * @param {string} [card.text]           Message body sent alongside the card.
 * @param {string} [card.title]
 * @param {string} [card.body]
 * @param {string} [card.sourceUrl]
 * @param {string} [card.thumbnail]      Local image path (read into a Buffer).
 * @param {string} [card.thumbnailUrl]
 * @param {boolean} [card.largeThumbnail]
 * @param {number} [card.mediaType]
 */
export const buildAdReply = ({
  text = '',
  title,
  body,
  sourceUrl,
  thumbnail,
  thumbnailUrl,
  largeThumbnail = true,
  mediaType = 1,
  mediaUrl
} = {}) => {
  const buffer = Buffer.isBuffer(thumbnail) ? thumbnail : readThumbnailBuffer(thumbnail)

  const externalAdReply = {
    title: title || undefined,
    body: body || undefined,
    url: sourceUrl || undefined,
    largeThumbnail: Boolean(largeThumbnail),
    mediaType,
    thumbnail: buffer || undefined,
    thumbnailUrl: thumbnailUrl || undefined,
    mediaUrl: mediaUrl || undefined
  }

  return { text, externalAdReply }
}

const measuredThumbnailCache = new Map()
const uploadedCoverCache = new Map()

/** Reset in-memory thumbnail and cover upload caches. */
export const resetThumbnailCaches = () => {
  measuredThumbnailCache.clear()
  uploadedCoverCache.clear()
  remoteCoverCache.clear()
}

/**
 * Read the cover into a JPEG Buffer and measure it, using the same image
 * libraries Elaina itself accepts (`sharp` → `@napi-rs/image` → `jimp`, which
 * ships as a dependency). Returns `null` without a library or a bad file —
 * callers then fall back to the paths that do not need dimensions.
 * Results are cached in memory to optimize subsequent .menu requests.
 *
 * @returns {Promise<{buffer: Buffer, width: number, height: number}|null>}
 */
export const readMeasuredThumbnail = async (value, { width = 640 } = {}) => {
  const source = thumbnailSource(value)
  if (!source?.url) return null

  // Cache key includes the file mtime for local files, so replacing the file
  // behind a stable name can never serve a stale cover (test J).
  let cacheKey = `${source.url}:${width}`
  if (!/^https?:\/\//i.test(source.url)) {
    try {
      cacheKey = `${source.url}:${width}:${Math.floor(fs.statSync(source.url).mtimeMs)}`
    } catch {
      /* stat failure falls back to the plain key; the read below fails too */
    }
  }
  if (measuredThumbnailCache.has(cacheKey)) {
    themeLog(`Thumbnail cache: HIT (${path.basename(source.url)})`)
    return measuredThumbnailCache.get(cacheKey)
  }

  let buffer
  try {
    if (/^https?:\/\//i.test(source.url)) {
      themeLog(`Thumbnail source: CDN — fetching ${source.url}`)
      const response = await fetch(source.url, { signal: AbortSignal.timeout(5000) })
      if (!response.ok) {
        themeLog(`Thumbnail fetch: HTTP ${response.status} — cover skipped`)
        return null
      }
      buffer = Buffer.from(await response.arrayBuffer())
    } else {
      themeLog(`Thumbnail source: local file`)
      buffer = fs.readFileSync(source.url)
    }
  } catch {
    themeLog('Thumbnail fetch: FAILED — cover skipped')
    return null
  }

  try {
    const jimp = await import('jimp')
    const Jimp = jimp?.Jimp ?? jimp?.default?.Jimp
    if (!Jimp?.read) return null

    const image = await Jimp.read(buffer)
    const original = { width: image.width, height: image.height }
    if (!original.width || !original.height) return null

    const target = Math.max(32, Math.min(width || original.width, original.width))
    const resized = await image
      .resize({ w: target, mode: jimp.ResizeStrategy?.BILINEAR ?? jimp.default?.ResizeStrategy?.BILINEAR })
      .getBuffer('image/jpeg', { quality: 80 })

    const result = {
      buffer: resized,
      width: target,
      height: Math.round((original.height * target) / original.width)
    }

    if (measuredThumbnailCache.size > 50) {
      const firstKey = measuredThumbnailCache.keys().next().value
      measuredThumbnailCache.delete(firstKey)
    }
    measuredThumbnailCache.set(cacheKey, result)
    themeLog(`Thumbnail processed: ${target}×${result.height}px, ${Math.round(resized.length / 1024)} KB (JPEG)`)
    return result
  } catch {
    themeLog('Thumbnail processing FAILED — cover skipped')
    return null
  }
}

/**
 * Upload a cover as a `thumbnail-link` blob and return the `imageMessage`
 * fields the wire format needs — the same mechanism as Angelina Bot's
 * `createThumbnailLink` (src/helper/thumbnail-link.js):
 *
 *   prepareWAMessageMedia({ image }, { upload: sock.waUploadToServer,
 *                                       mediaTypeOverride: 'thumbnail-link' })
 *
 * The upload fills `directPath`, `mediaKey`, `mediaKeyTimestamp`,
 * `fileSha256`, `fileEncSha256` and the dimensions — exactly the fields a
 * client needs to fetch and decrypt the big cover. Accepts a local path, a
 * remote URL or a raw Buffer. Returns `null` when there is no usable cover or
 * the socket cannot upload (never fatal — callers fall back).
 *
 * @param {object} sock            Socket providing `waUploadToServer`
 * @param {object} source          `{ url }` from `thumbnailSource()` or `{ buffer }`
 * @param {number} [width]         Cover width passed to the library
 * @returns {Promise<{directPath, mediaKey, mediaKeyTimestamp, fileSha256, fileEncSha256, thumbnailWidth, thumbnailHeight}|null>}
 */
export const uploadThumbnailLinkCover = async (sock, source) => {
  if (typeof sock?.waUploadToServer !== 'function') {
    themeLog('Preview upload: socket has no waUploadToServer — falling back')
    return null
  }

  // Cache key: URL, resolved path + mtime (a replaced file must never serve a
  // stale upload), or the first bytes of a raw buffer.
  let cacheKey = source?.url || (Buffer.isBuffer(source?.buffer) ? source.buffer.toString('base64', 0, 32) : null)
  if (cacheKey && !/^https?:\/\//i.test(cacheKey)) {
    try {
      cacheKey = `${cacheKey}:${Math.floor(fs.statSync(cacheKey).mtimeMs)}`
    } catch {
      /* stat failure — the upload below fails too */
    }
  }
  if (cacheKey && uploadedCoverCache.has(cacheKey)) {
    themeLog('Preview cover upload: cache HIT')
    return uploadedCoverCache.get(cacheKey)
  }

  try {
    // Accepts `{ url }` (path or https) or a raw Buffer — both are shapes the
    // library's `getStream()` understands. Dimensions are read from the image
    // itself during upload.
    const media = Buffer.isBuffer(source?.buffer) ? source.buffer : source
    themeLog('Preview cover upload: preparing thumbnail-link blob (Elaina prepareWAMessageMedia)')
    const { imageMessage } = await prepareWAMessageMedia(
      { image: media },
      { upload: sock.waUploadToServer, mediaTypeOverride: 'thumbnail-link' }
    )
    if (!imageMessage?.directPath || !imageMessage?.mediaKey) {
      themeLog('Preview cover upload: incomplete upload result — falling back')
      return null
    }

    const result = {
      directPath: imageMessage.directPath,
      mediaKey: imageMessage.mediaKey,
      mediaKeyTimestamp: imageMessage.mediaKeyTimestamp,
      fileSha256: imageMessage.fileSha256,
      fileEncSha256: imageMessage.fileEncSha256,
      thumbnailWidth: imageMessage.width,
      thumbnailHeight: imageMessage.height
    }

    if (cacheKey) {
      if (uploadedCoverCache.size > 50) {
        const firstKey = uploadedCoverCache.keys().next().value
        uploadedCoverCache.delete(firstKey)
      }
      uploadedCoverCache.set(cacheKey, result)
    }

    themeLog('Preview cover upload: OK')
    return result
  } catch (error) {
    themeLog(`Preview cover upload: FAILED (${error?.message ?? 'unknown'}) — falling back`)
    return null
  }
}

/**
 * Build the `extendedTextMessage` body for a thumbnail-link card — the field
 * set is the one Angelina Bot's `createThumbnailLink` assembles on the same
 * proto (`previewType: NONE`, `inviteLinkGroupTypeV2: DEFAULT`, the uploaded
 * cover fields, and a tiny 1×1 placeholder `jpegThumbnail` so the client
 * never waits on a small-image fetch):
 *
 *   text          → `${url}\n${content}`  (URL leads, the client folds it)
 *   matchedText   → the url
 *   thumbnail*    → from `uploadThumbnailLinkCover()`
 *
 * @param {object} card
 * @param {string} card.text                    Body sent under the card.
 * @param {string} card.url                     Link the preview opens (`matchedText`).
 * @param {string} [card.title]
 * @param {string} [card.description]
 * @param {object} [card.cover]                 Uploaded cover fields.
 * @param {string} card.cover.directPath
 * @param {Uint8Array|Buffer} card.cover.mediaKey
 * @param {number|string} [card.cover.mediaKeyTimestamp]
 * @param {Uint8Array|Buffer} card.cover.fileSha256
 * @param {Uint8Array|Buffer} card.cover.fileEncSha256
 * @param {number} [card.cover.thumbnailWidth]
 * @param {number} [card.cover.thumbnailHeight]
 * @param {Buffer} [card.jpegThumbnail]         Overrides the 1×1 placeholder.
 * @returns {{ extendedTextMessage: object }}
 */
export const buildThumbnailLinkCard = ({ text = '', url, title, description, cover, jpegThumbnail } = {}) => {
  if (!url) throw new Error('buildThumbnailLinkCard() requires a url')
  if (!cover?.directPath || !cover?.mediaKey) throw new Error('buildThumbnailLinkCard() requires an uploaded cover (directPath + mediaKey)')

  const extendedTextMessage = {
    text: text.includes(url) ? text : `${url}\n${text}`,
    matchedText: url,
    title: title || undefined,
    description: description || undefined,
    previewType: 0, // proto PreviewType.NONE
    inviteLinkGroupTypeV2: 0, // proto InviteLinkGroupTypeV2.DEFAULT
    thumbnailDirectPath: cover.directPath,
    thumbnailSha256: cover.fileSha256,
    thumbnailEncSha256: cover.fileEncSha256,
    mediaKey: cover.mediaKey,
    mediaKeyTimestamp: cover.mediaKeyTimestamp,
    thumbnailWidth: cover.thumbnailWidth,
    thumbnailHeight: cover.thumbnailHeight,
    jpegThumbnail: Buffer.isBuffer(jpegThumbnail)
      ? jpegThumbnail
      : Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAoAAAAKCAQAAAAnOwc2AAAADElEQVR4nGNgGG4AAADSAAFQmYCvAAAAAElFTkSuQmCC', 'base64')
  }
  return { extendedTextMessage }
}

/**
 * Build the `extendedTextMessage` body for a link-preview card.
 *
 * This mirrors the classic manual-preview flow — the fields are exactly the
 * ones the Elaina proto defines for `extendedTextMessage` (`matchedText`,
 * `title`, `description`, `jpegThumbnail`, `thumbnailWidth`,
 * `thumbnailHeight`). `canonicalUrl` no longer exists in the proto and is
 * intentionally not set.
 *
 * @param {object} card
 * @param {string} card.text            Body sent above/with the link.
 * @param {string} card.url             Link the preview opens (`matchedText`).
 * @param {string} [card.title]
 * @param {string} [card.description]
 * @param {Buffer} [card.jpegThumbnail] Inline JPEG preview.
 * @param {number} [card.thumbnailWidth]
 * @param {number} [card.thumbnailHeight]
 * @returns {{ extendedTextMessage: object }}
 */
export const buildExtendedTextCard = ({ text = '', url, title, description, jpegThumbnail, thumbnailWidth, thumbnailHeight } = {}) => {
  if (!url) throw new Error('buildExtendedTextCard() requires a url')

  // URL FIRST — a client folds a leading URL into the preview card, while a
  // trailing one shows as a bare link line under the text.
  const body = text.includes(url) ? text : `${url}\n${text}`
  const extendedTextMessage = {
    text: body,
    matchedText: url,
    title: title || undefined,
    description: description || undefined,
    previewType: 0,
    jpegThumbnail: Buffer.isBuffer(jpegThumbnail) ? jpegThumbnail : undefined,
    thumbnailWidth: Number.isFinite(thumbnailWidth) ? thumbnailWidth : undefined,
    thumbnailHeight: Number.isFinite(thumbnailHeight) ? thumbnailHeight : undefined
  }
  return { extendedTextMessage }
}

/**
 * Send the card through `generateWAMessageFromContent` + `sock.relayMessage`.
 *
 * The low-level path from the original KURO spec. Quoting is handled inside
 * `generateWAMessageFromContent` (`{ quoted }` writes the contextInfo) — not
 * in the relay options, which the library does not read.
 *
 * @param {object} options
 * @param {object} options.sock
 * @param {string} options.jid
 * @param {object} options.extendedTextMessage  Body from `buildExtendedTextCard()`
 * @param {object} [options.quoted]             Raw WAMessage to quote
 * @param {string} [options.botJid]             `sock.user.id`, for the message id
 */
export const relayExtendedTextCard = async ({ sock, jid, extendedTextMessage, quoted = undefined, botJid = '' }) => {
  if (!sock?.relayMessage) throw new Error('relayExtendedTextCard() needs a socket with relayMessage()')

  const full = generateWAMessageFromContent(
    jid,
    { extendedTextMessage },
    { quoted, userJid: botJid || sock?.user?.id || '' }
  )

  await sock.relayMessage(jid, full.message, { messageId: full.key.id })
  return full
}

/**
 * Send the best card available for the given configuration.
 *
 * The primary path is the Angelina-style `thumbnail-link` upload: the cover
 * becomes a WhatsApp-hosted blob referenced by `thumbnailDirectPath` +
 * `mediaKey` on a manually built `extendedTextMessage`, relayed through
 * `sock.relayMessage()` — the large full-width card, quoted when
 * `{ quoted }` is passed. Everything else is a fallback:
 *
 *   1. `thumbnail-link` — the large card (needs `waUploadToServer` + a cover)
 *   2. `externalAdReply` — large card from an inline JPEG (`renderLargerThumbnail`)
 *   3. `extendedTextMessage` — manual inline-JPEG preview; forced by
 *      `thumbnailHeightRatioOverride > 0`
 *   4. `richLink` — only when the body already contains the URL
 *   5. plain text (URL appended so WhatsApp can still build a preview)
 *
 * @returns {Promise<{mode: string, result: object}>}
 */
export const sendPreviewCard = async (sock, jid, card, options = {}) => {
  const { text, url, title, description, thumbnail } = card
  const cover = thumbnailSource(thumbnail)
  if (thumbnail && !cover) {
    themeLog(`Preview cover unavailable ("${String(thumbnail).slice(0, 80)}") — degrading to a card without a cover`)
  }

  /**
   * Log the card delivery once, at the single exit point of this pipeline.
   * Paths through `sock.sendMessage` are already logged by the outgoing
   * wrapper — only the `relayMessage()` paths need an explicit log here.
   */
  const finish = async (mode, result, { viaRelay = false } = {}) => {
    themeLog(`Preview generation: OK (mode=${mode})`)
    if (viaRelay) {
      getMessageLogger().outgoing({ jid, content: { text: text ?? '' }, type: 'text', ok: true })
    }
    return { mode, result }
  }

  // A positive ratio override is the operator's explicit opt-in to the classic
  // manual flow (§22 of the KURO spec) — it skips the thumbnail-link upload.
  const ratio = Number(card.thumbnailHeightRatioOverride)
  const wantsManual = Number.isFinite(ratio) && ratio > 0

  if (url && cover && !wantsManual) {
    // 1. Large card via the `thumbnail-link` upload.
    const uploaded = await uploadThumbnailLinkCover(sock, cover)
    if (uploaded) {
      const body = buildThumbnailLinkCard({ text, url, title, description, cover: uploaded })
      try {
        const result = await relayExtendedTextCard({ sock, jid, extendedTextMessage: body.extendedTextMessage, quoted: options.quoted })
        return finish('thumbnailLink', result, { viaRelay: true })
      } catch {
        /* relay unavailable (test socket) — fall through */
      }
    }
  }

  if (url && cover && !wantsManual) {
    // 2. Big ad-reply card: the thumbnail Buffer rides inline in the message's
    //    contextInfo, so the client renders the large card without needing a
    //    URL in the body — the menu text stays clean.
    const measured = await readMeasuredThumbnail(thumbnail, { width: card.thumbnailWidth })
    const remote = measured ? null : await fetchRemoteCover(cover.url)
    const buffer = measured?.buffer ?? remote ?? readThumbnailBuffer(thumbnail)
    if (buffer) {
      const content = buildAdReply({
        text,
        title,
        body: description,
        sourceUrl: url,
        thumbnail: buffer,
        largeThumbnail: true
      })
      return finish('externalAdReply', await sock.sendMessage(jid, content, options))
    }
  }

  if (url && cover) {
    // 3. Manual flow: measure the image locally and relay an
    // `extendedTextMessage` with an inline JPEG; the ratio scales the height.
    // The URL leads the body — the client needs it to render.
    const measured = await readMeasuredThumbnail(thumbnail, { width: card.thumbnailWidth })
    if (measured) {
      const height = Math.floor(measured.height * ratio)
      const body = buildExtendedTextCard({
        text,
        url,
        title,
        description,
        jpegThumbnail: measured.buffer,
        thumbnailWidth: measured.width,
        thumbnailHeight: height
      })
      try {
        const result = await relayExtendedTextCard({ sock, jid, extendedTextMessage: body.extendedTextMessage, quoted: options.quoted })
        return finish('extendedTextMessage', result, { viaRelay: true })
      } catch {
        /* relay unavailable (test socket, old library) — fall through */
      }
    }

    // 4. Native `richLink` upload — only when the caller's body already
    // carries the URL (a visible URL is accepted there anyway).
    if (text.includes(url)) {
      const content = buildRichLink({
        text,
        url,
        title,
        description,
        image: cover,
        large: true,
        thumbnailWidth: card.thumbnailWidth
      })
      return finish('richLink', await sock.sendMessage(jid, content, options))
    }
  }

  if (url) {
    const body = text.includes(url) ? text : `${url}\n${text}`
    return finish('text', await sock.sendMessage(jid, { text: body }, options))
  }

  return finish('text', await sock.sendMessage(jid, { text }, options))
}

export default {
  hasImageLibrary,
  resetImageLibraryCache,
  resetThumbnailCaches,
  thumbnailSource,
  buildRichLink,
  buildAdReply,
  readMeasuredThumbnail,
  uploadThumbnailLinkCover,
  buildThumbnailLinkCard,
  buildExtendedTextCard,
  relayExtendedTextCard,
  sendPreviewCard
}
