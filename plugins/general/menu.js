/**
 * `.menu` — the dynamic command list, following the original KURO reference:
 *
 *   header (Japanese greeting + SYSTEM INFO)
 *   → styledAllMenu (all categories, commands only)
 *   → random command pick from menuManager.categoryMap
 *   → displayPrefix resolved through `bypassPrefix`
 *   → buatKataKata() merges prefix + command + header
 *   → ctx.sendCard() → sendPreviewCard() in src/lib/preview.js
 *
 * Why the send goes through the shared card pipeline: the LARGE full-width
 * card (the Angelina-style `thumbnail-link` flow) needs the cover uploaded as
 * a WhatsApp blob — `prepareWAMessageMedia(…, { mediaTypeOverride:
 * 'thumbnail-link' })` — whose `directPath`/`mediaKey`/`fileSha256` fields are
 * copied onto a manually built `extendedTextMessage` and relayed through
 * `sock.relayMessage()`, with the URL LEADING the body so the client folds it
 * into the card. `sendPreviewCard` picks that path first and degrades
 * thumbnail-link → externalAdReply → manual extendedTextMessage → richLink →
 * plain text, so the menu still sends without a thumbnail or an upload-capable
 * socket. No path sends the message twice.
 *
 * Setting `menu.thumbnailHeightRatioOverride > 0` in settings.js is the
 * operator's explicit opt-in to the classic manual (small-card) flow.
 */

import { uptimeSince } from '../../src/utils/time.js'
import { getJapaneseGreeting } from '../../src/utils/greeting.js'
import { runtime } from '../../src/runtime.js'
import { MenuManager, buatKataKata, getOneRandomElemenFrom } from '../../src/lib/menu-manager.js'
import { getThemeConfig } from '../../src/lib/theme.js'

export default {
  name: 'menu',
  command: ['menu', 'help'],
  category: 'general',
  description: 'Show every available command',

  async execute(ctx) {
    const config = ctx.config
    const menu = config.menu ?? {}

    // ── dynamic menu data ──────────────────────────────────────
    const menuManager = new MenuManager({ registry: ctx.plugins, ctx, config })
    const japaneseGreeting = getJapaneseGreeting(config.timezone)
    const userName = ctx.pushName || ctx.senderNumber || 'Friend'
    const prefix = config.prefix?.[0] ?? '.'
    const botName = config.botName
    const ownerName = config.ownerName
    const botVersion = config.version
    const runtimeStr = uptimeSince(runtime.startedAt)

    // ── theme (SQLite first, settings.js as default) ──────────
    const theme = getThemeConfig(ctx.db, config)

    const header =
      `⛩️ *${japaneseGreeting}*\n` +
      `Hai, *${userName}-san*! Berikut daftar seluruh perintah bot.\n` +
      '\n' +
      `┌─── ❖ *SYSTEM INFO*\n` +
      `│ 🤖 *Bot Name:* ${theme.botName}\n` +
      `│ 👑 *Owner:* ${ownerName}\n` +
      `│ 🏷️ *Version:* ${botVersion}\n` +
      `│ ⏱️ *Uptime:* ${runtimeStr}\n` +
      `│ 📌 *Prefix:* [ ${config.prefix?.join(' ') || 'Multi'} ]\n` +
      `└───────────────┈\n` +
      '\n' +
      `${menuManager.allMenuText}\n\n`

    // ── random command (safe on empty registries) ──────────────
    const randomCategory = getOneRandomElemenFrom(menuManager.categoryArray)
    const commandsInRandomCategory = randomCategory ? menuManager.commandsOf(randomCategory) : []
    const randomCommand = getOneRandomElemenFrom(commandsInRandomCategory)

    // `bypassPrefix` plugins are invoked without the prefix character.
    const pluginRecord = randomCommand ? menuManager.getPluginRecord(randomCommand) : null
    const displayPrefix = pluginRecord?.bypassPrefix ? '' : prefix

    const fullContent = buatKataKata(displayPrefix, randomCommand, header)

    // ── optional category filter (kept from the previous UX) ───
    let text = fullContent
    const filter = (ctx.args[0] ?? '').toLowerCase()
    if (filter) {
      const entry = menuManager.categoryMap.get(filter)
      if (!entry) {
        await ctx.reply(`No plugin category named *${filter}*.\nAvailable: ${menuManager.categoryArray.map(category => menuManager.categoryMap.get(category)?.name ?? category).join(', ')}`)
        return
      }
      const lines = entry.commandArray.map(command => `│ • ${command}`)
      text =
        header.split('\n\n')[0] +
        '\n' +
        [`┌─── ❖ *${entry.name}*`, ...lines, '└───────────────┈'].join('\n') +
        '\n'
    }

    const title = theme.title || botName
    const description = theme.description || `Version ${botVersion}`

    // ── send: the shared large-card pipeline ───────────────────
    // richLink uploads the cover as a `thumbnail-link` blob → WhatsApp
    // renders the full-width card. Everything (measuring, uploading,
    // relaying, fallbacks) lives in src/lib/preview.js.
    try {
      const { mode } = await ctx.sendCard({
        text,
        url: menu.url,
        title,
        description,
        thumbnail: theme.thumbnail,
        thumbnailWidth: menu.thumbnailWidth,
        thumbnailHeightRatioOverride: menu.thumbnailHeightRatioOverride
      })
      if (mode === 'text') {
        ctx.logger?.debug?.('Menu sent as plain text — set menu.url + menu.thumbnail in settings.js for the large card.')
      }
    } catch (error) {
      ctx.logger?.error(`menu delivery failed: ${error?.stack ?? error?.message}`)
      // Never leave the user without the list.
      await ctx.reply(text.replace(/\u001b\[\d+m/g, '')).catch(() => {})
    }
  }
}
