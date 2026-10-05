/**
 * `.theme` — Theme Manager (owner only).
 *
 * Changes the menu appearance live through WhatsApp commands, persisted in the
 * SQLite `theme_config` table (migration 005) and applied on the very next
 * menu — no restart.
 *
 * Thumbnails are stored under `media/thumbnails/` and referenced by a public
 * path (`/media/thumbnails/thumb-*.ext`) — never by a local absolute path and
 * never by a URL that nothing serves. The menu pipeline (src/lib/preview.js)
 * reads the file back and uploads it to WhatsApp itself, so a custom cover
 * works with or without a public web server:
 *
 *   .theme                     → this guide
 *   .theme thumb set <url>     → set the cover from a public HTTPS image URL
 *   .theme thumb set           → set the cover from a replied WhatsApp image
 *   .theme desc set <teks>     → set the description under the thumbnail
 *   .theme name set <nama>     → set the bot name shown on the menu
 *   .theme reset               → reset all theme settings to defaults
 *   .theme name reset          → reset bot name to default
 *   .theme desc reset          → reset description to default
 *   .theme thumb reset         → reset thumbnail to default
 *
 * Only the owner can run any of it (`ownerOnly: true` + server-side permissions).
 * Failed downloads or writes never touch the previously stored theme.
 */

import fs from 'node:fs'
import path from 'node:path'
import {
  THEME_LIMITS,
  THUMBNAIL_DIR,
  themeLog,
  fetchImageFromUrl,
  verifyImageBuffer,
  saveThumbnailFile,
  getEffectiveTheme,
  invalidateThemeCache,
  cleanupOldThumbnailFile,
  clearThumbnailsDirectory
} from '../../src/lib/theme.js'
import { resetThumbnailCaches } from '../../src/lib/preview.js'
import { bold } from '../../src/utils/format.js'

const GUIDE = [
  '🎨 *KURO THEME MANAGER*',
  '',
  `› ${bold('.theme')}`,
  '  Menampilkan panduan.',
  '',
  `› ${bold('.theme thumb set <url>')}`,
  '  Mengubah thumbnail menggunakan URL/CDN.',
  '',
  `› ${bold('.theme thumb set')}`,
  '  Mengubah thumbnail menggunakan reply gambar WhatsApp.',
  '',
  `› ${bold('.theme thumb reset')}`,
  '  Mengembalikan thumbnail default.',
  '',
  `› ${bold('.theme desc set <teks>')}`,
  '  Mengubah deskripsi link preview.',
  '',
  `› ${bold('.theme desc reset')}`,
  '  Mengembalikan deskripsi default.',
  '',
  `› ${bold('.theme name set <nama>')}`,
  '  Mengubah nama bot.',
  '',
  `› ${bold('.theme name reset')}`,
  '  Mengembalikan nama bot default.',
  '',
  `› ${bold('.theme reset')}`,
  '  Reset seluruh tema ke default.',
  '',
  'Semua perintah hanya dapat digunakan oleh owner.'
].join('\n')

/** Current values + source, for the status replies. */
const statusLines = (db, config) => {
  const theme = getEffectiveTheme(db, config, { forceRefresh: true })
  const nameLabel = theme.source.botName === 'database' ? `${theme.name} (SQLite)` : `${theme.name}`
  const descLabel = theme.source.description === 'database' ? `${theme.description} (SQLite)` : `${theme.description || '-'}`
  const thumbLabel = theme.thumbnail ? 'Terpasang' : 'Belum ada'
  return [
    `› Nama: ${nameLabel}`,
    `› Deskripsi: ${descLabel}`,
    `› Thumbnail: ${thumbLabel}`
  ]
}

/**
 * Parse theme section, action, and value cleanly.
 * Guarantees subcommand words ('name set', 'desc set', etc.) NEVER leak into value.
 */
export const parseThemeArgs = (args = [], argText = '') => {
  const cleanArgs = (args ?? []).map(a => String(a ?? '').trim()).filter(Boolean)
  const first = cleanArgs[0]?.toLowerCase()
  const rawText = String(argText ?? '').trim()

  if (!first) {
    return { section: null, action: null, value: '' }
  }

  // Bare ".theme reset"
  if (first === 'reset') {
    return { section: 'all', action: 'reset', value: '' }
  }

  // Canonicalize section names and common aliases
  let section = null
  if (first === 'name' || first === 'title') section = 'name'
  else if (first === 'desc' || first === 'description') section = 'desc'
  else if (first === 'thumb' || first === 'thumbnail') section = 'thumb'
  else section = first

  const second = cleanArgs[1]?.toLowerCase()
  const action = second

  let value = ''
  if (action === 'set') {
    // Regex matches either:
    // "name set Kazuha" -> captures "Kazuha"
    // "set Kazuha"      -> captures "Kazuha"
    const match = rawText.match(new RegExp(`^(?:(?:${first}|${section})\\s+)?${second}(?:\\s+(.*))?$`, 'is'))
    if (match) {
      value = (match[1] ?? '').trim()
    } else if (cleanArgs.length > 2) {
      value = cleanArgs.slice(2).join(' ').trim()
    }
  }

  return { section, action, value }
}

export default {
  name: 'theme',
  command: ['theme'],
  category: 'owner',
  description: 'Theme Manager: set or reset the menu name, description and thumbnail',
  usage: '.theme | .theme thumb set <url> | .theme desc set <teks> | .theme name set <nama> | .theme reset',
  ownerOnly: true,
  parseThemeArgs,

  async execute(ctx) {
    if (ctx.isOwner === false) {
      await ctx.reply('❌ Perintah ini hanya dapat digunakan oleh Owner bot.')
      return
    }

    const db = ctx.db
    const config = ctx.config
    const { section, action, value } = parseThemeArgs(ctx.args, ctx.argText)

    // ── .theme — guide ───────────────────────────────────────────────────
    if (!section) {
      await ctx.reply([GUIDE, '', ...statusLines(db, config)].join('\n'))
      return
    }

    // ── .theme reset — reset everything ──────────────────────────────────
    if (section === 'all' && action === 'reset') {
      try {
        const oldThumb = db ? db.getTheme('thumbnail_url', null) : null
        if (db) {
          db.deleteTheme('bot_name')
          db.deleteTheme('description')
          db.deleteTheme('thumbnail_url')
        }
        invalidateThemeCache()
        resetThumbnailCaches()
        if (oldThumb) cleanupOldThumbnailFile(oldThumb)
        clearThumbnailsDirectory()

        const defaultName = config?.theme?.name ?? config?.botName ?? 'KURO'
        const defaultDesc = config?.theme?.description ?? config?.menu?.description ?? '-'

        await ctx.react('✅').catch(() => {})
        await ctx.reply(
          [
            '✅ *THEME BERHASIL DI-RESET*',
            '',
            'Theme reset successfully.',
            '',
            `› Nama: ${defaultName} (Default)`,
            `› Deskripsi: ${defaultDesc} (Default)`,
            '› Thumbnail: Default settings.js'
          ].join('\n')
        )
      } catch (error) {
        ctx.logger?.warn?.(`theme reset failed: ${error.message}`)
        await ctx.reply('❌ Gagal mereset tema di database. Tema sebelumnya tidak diubah.')
      }
      return
    }

    // ── .theme desc [set|reset] ──────────────────────────────────────────
    if (section === 'desc') {
      if (action === 'reset') {
        try {
          if (db) db.deleteTheme('description')
          invalidateThemeCache()
          const defaultDesc = config?.theme?.description ?? config?.menu?.description ?? '-'
          await ctx.react('✅').catch(() => {})
          await ctx.reply(
            [
              '✅ *DESKRIPSI DI-RESET*',
              '',
              'Theme description reset to default.',
              '',
              `› Deskripsi: ${defaultDesc} (Default)`
            ].join('\n')
          )
        } catch (error) {
          ctx.logger?.warn?.(`theme desc reset failed: ${error.message}`)
          await ctx.reply('❌ Gagal mereset deskripsi di database. Tema sebelumnya tidak diubah.')
        }
        return
      }

      if (action !== 'set') {
        await ctx.reply(`Format: ${bold('.theme desc set <teks>')} atau ${bold('.theme desc reset')}\nContoh: ${bold('.theme desc set Modern modular WhatsApp bot')}`)
        return
      }

      const text = value
      if (!text) {
        await ctx.reply('❌ Deskripsi tidak boleh kosong. Contoh: `​.theme desc set Modern modular WhatsApp bot`')
        return
      }
      if (text.length > THEME_LIMITS.maxDescriptionLength) {
        await ctx.reply(`❌ Deskripsi terlalu panjang (${text.length} karakter). Maksimal ${THEME_LIMITS.maxDescriptionLength} agar sesuai batasan link preview WhatsApp.`)
        return
      }
      try {
        if (db) db.setTheme('description', text)
        invalidateThemeCache()
        await ctx.react('✅').catch(() => {})
        await ctx.reply(
          [
            '✅ *DESKRIPSI DIPERBARUI*',
            '',
            `Theme description updated:\n${text}`,
            '',
            ...statusLines(db, config)
          ].join('\n')
        )
      } catch (error) {
        ctx.logger?.warn?.(`theme desc update failed: ${error.message}`)
        await ctx.reply('❌ Gagal menyimpan deskripsi ke database. Tema sebelumnya tidak diubah.')
      }
      return
    }

    // ── .theme name [set|reset] ──────────────────────────────────────────
    if (section === 'name') {
      if (action === 'reset') {
        try {
          if (db) db.deleteTheme('bot_name')
          invalidateThemeCache()
          const defaultName = config?.theme?.name ?? config?.botName ?? 'KURO'
          await ctx.react('✅').catch(() => {})
          await ctx.reply(
            [
              '✅ *NAMA BOT DI-RESET*',
              '',
              'Theme name reset to default.',
              '',
              `› Nama: ${defaultName} (Default)`
            ].join('\n')
          )
        } catch (error) {
          ctx.logger?.warn?.(`theme name reset failed: ${error.message}`)
          await ctx.reply('❌ Gagal mereset nama bot di database. Tema sebelumnya tidak diubah.')
        }
        return
      }

      if (action !== 'set') {
        await ctx.reply(`Format: ${bold('.theme name set <nama>')} atau ${bold('.theme name reset')}\nContoh: ${bold('.theme name set Kazuha')}`)
        return
      }

      const name = value
      if (!name) {
        await ctx.reply('❌ Nama tidak boleh kosong. Contoh: `​.theme name set Kazuha`')
        return
      }
      if (name.length > THEME_LIMITS.maxNameLength) {
        await ctx.reply(`❌ Nama terlalu panjang (${name.length} karakter). Maksimal ${THEME_LIMITS.maxNameLength} karakter.`)
        return
      }
      try {
        if (db) db.setTheme('bot_name', name)
        invalidateThemeCache()
        await ctx.react('✅').catch(() => {})
        await ctx.reply(
          [
            '✅ *NAMA BOT DIPERBARUI*',
            '',
            `Theme name updated:\n${name}`,
            '',
            ...statusLines(db, config)
          ].join('\n')
        )
      } catch (error) {
        ctx.logger?.warn?.(`theme name update failed: ${error.message}`)
        await ctx.reply('❌ Gagal menyimpan nama bot ke database. Tema sebelumnya tidak diubah.')
      }
      return
    }

    // ── .theme thumb [set|reset] ─────────────────────────────────────────
    if (section === 'thumb') {
      if (action === 'reset') {
        try {
          const oldThumb = db ? db.getTheme('thumbnail_url', null) : null
          if (db) db.deleteTheme('thumbnail_url')
          invalidateThemeCache()
          resetThumbnailCaches()
          if (oldThumb) cleanupOldThumbnailFile(oldThumb)
          clearThumbnailsDirectory()
          await ctx.react('✅').catch(() => {})
          await ctx.reply(
            [
              '✅ *THUMBNAIL DI-RESET*',
              '',
              'Theme thumbnail reset to default.',
              '',
              '› Thumbnail: Default settings.js'
            ].join('\n')
          )
        } catch (error) {
          ctx.logger?.warn?.(`theme thumb reset failed: ${error.message}`)
          await ctx.reply('❌ Gagal mereset thumbnail di database. Tema sebelumnya tidak diubah.')
        }
        return
      }

      if (action !== 'set') {
        await ctx.reply(
          [
            `Format 1: ${bold('.theme thumb set <url>')}`,
            '‹ URL gambar HTTPS publik (JPEG/PNG/WebP).',
            `Format 2: ${bold('.theme thumb set')}`,
            '‹ Balas (reply) sebuah gambar WhatsApp dengan perintah ini.',
            `Format 3: ${bold('.theme thumb reset')}`,
            '‹ Kembalikan thumbnail ke default settings.js.'
          ].join('\n')
        )
        return
      }

      const inlineUrl = value

      // Method 1 — a public HTTPS image URL.
      if (inlineUrl) {
        themeLog('Thumbnail source: CDN')
        themeLog(`Thumbnail URL: ${inlineUrl}`)
        themeLog('Thumbnail validation: fetching + verifying the resource is a real image…')
        const fetched = await fetchImageFromUrl(inlineUrl)
        if (!fetched.ok) {
          themeLog(`Thumbnail fetch: FAILED (${fetched.reason}) — theme untouched`)
          await ctx.reply(`❌ Thumbnail tidak diubah.\nAlasan: ${fetched.reason}`)
          return
        }
        themeLog(`Thumbnail fetch: OK — MIME ${fetched.contentType}, ${Math.round(fetched.buffer.length / 1024)} KB`)

        // Store the bytes locally; the menu pipeline reads this file directly
        // and uploads it to WhatsApp itself — no public web server needed.
        const stored = saveThumbnailFile(fetched.buffer)
        if (!stored.ok) {
          themeLog(`Thumbnail storage: FAILED (${stored.reason})`)
          await ctx.reply(`❌ Thumbnail tidak diubah.\nAlasan: ${stored.reason}`)
          return
        }

        try {
          const oldThumb = db ? db.getTheme('thumbnail_url', null) : null
          if (db) db.setTheme('thumbnail_url', stored.publicPath)
          invalidateThemeCache()
          resetThumbnailCaches()
          if (oldThumb && oldThumb !== stored.publicPath) {
            cleanupOldThumbnailFile(oldThumb)
          }
        } catch (error) {
          // The write failed — remove the orphaned file and keep the old theme.
          cleanupOldThumbnailFile(stored.publicPath)
          ctx.logger?.warn?.(`theme thumb update failed: ${error.message}`)
          await ctx.reply('❌ Gagal menyimpan thumbnail ke database. Tema sebelumnya tidak diubah.')
          return
        }
        themeLog('Theme updated: OK — thumbnail cache invalidated')
        await ctx.react('✅').catch(() => {})
        await ctx.reply(
          [
            '✅ *THUMBNAIL DIPERBARUI*',
            '',
            'Theme thumbnail updated.',
            '',
            `› Sumber   : URL`,
            `› Format   : ${fetched.contentType}`,
            `› Disimpan : ${THUMBNAIL_DIR}/`,
            '',
            ...statusLines(db, config)
          ].join('\n')
        )
        return
      }

      // Method 2 — a replied WhatsApp image.
      const quoted = ctx.quoted
      const isImage =
        (ctx.m?.isMedia && String(ctx.m?.mimetype ?? '').startsWith('image/')) ||
        (quoted?.isMedia && String(quoted?.mimetype ?? '').startsWith('image/')) ||
        (quoted?.raw?.imageMessage !== undefined) ||
        (quoted?.raw?.message?.imageMessage !== undefined) ||
        (quoted?.message?.imageMessage !== undefined)

      if (!isImage) {
        await ctx.reply('❌ Balas (reply) sebuah gambar WhatsApp dengan perintah `.theme thumb set`, atau sertakan URL gambar HTTPS.')
        return
      }

      themeLog('Thumbnail source: quoted image')
      themeLog(`Quoted message type: ${quoted?.raw?.imageMessage !== undefined || quoted?.raw?.message?.imageMessage !== undefined ? 'imageMessage' : quoted?.type ?? ctx.m?.type ?? 'unknown'}`)

      let buffer = null
      if (quoted) {
        try {
          buffer = await ctx.download({ quoted: true })
          themeLog(`Media download (quoted): ${buffer ? `OK — ${Math.round(buffer.length / 1024)} KB` : 'EMPTY'}`)
        } catch (error) {
          ctx.logger?.debug?.(`theme thumb download (quoted) failed: ${error.message}`)
        }
      }
      if (!buffer && ctx.m?.isMedia) {
        try {
          buffer = await ctx.download()
          themeLog(`Media download (own media): ${buffer ? `OK — ${Math.round(buffer.length / 1024)} KB` : 'EMPTY'}`)
        } catch (error) {
          ctx.logger?.debug?.(`theme thumb download (own media) failed: ${error.message}`)
        }
      }
      if (!buffer) {
        themeLog('Media download: FAILED — theme untouched')
        await ctx.reply('❌ Gagal mengunduh gambar dari pesan yang dibalas. Coba kirim ulang gambarnya.')
        return
      }

      const verified = verifyImageBuffer(buffer)
      if (!verified.ok) {
        themeLog(`Image validation: FAILED (${verified.reason})`)
        await ctx.reply(`❌ Thumbnail tidak diubah.\nAlasan: ${verified.reason}`)
        return
      }
      themeLog(`Image validation: OK — MIME ${verified.mime}`)

      const stored = saveThumbnailFile(buffer)
      if (!stored.ok) {
        themeLog(`Thumbnail generation/storage: FAILED (${stored.reason})`)
        await ctx.reply(`❌ Thumbnail tidak diubah.\nAlasan: ${stored.reason}`)
        return
      }
      themeLog('Thumbnail generation: OK — stored under media/thumbnails/')

      try {
        const oldThumb = db ? db.getTheme('thumbnail_url', null) : null
        if (db) db.setTheme('thumbnail_url', stored.publicPath)
        invalidateThemeCache()
        resetThumbnailCaches()
        if (oldThumb && oldThumb !== stored.publicPath) {
          cleanupOldThumbnailFile(oldThumb)
        }
      } catch (error) {
        cleanupOldThumbnailFile(stored.publicPath)
        ctx.logger?.warn?.(`theme thumb update failed: ${error.message}`)
        await ctx.reply('❌ Gagal menyimpan thumbnail ke database. Tema sebelumnya tidak diubah.')
        return
      }
      themeLog('Theme updated: OK — thumbnail cache invalidated')
      await ctx.react('✅').catch(() => {})
      await ctx.reply(
        [
          '✅ *THUMBNAIL DIPERBARUI*',
          '',
          'Theme thumbnail updated.',
          '',
          '› Sumber   : gambar WhatsApp',
          `› Format   : ${verified.mime}`,
          '',
          ...statusLines(db, config)
        ].join('\n')
      )
      return
    }

    await ctx.reply(`Sub-perintah tidak dikenal. Kirim ${bold('.theme')} untuk panduan.`)
  }
}
