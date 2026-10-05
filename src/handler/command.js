/**
 * KURO — command parser and dispatcher.
 *
 * Parsing supports both the classic prefix form and KURO's owner-only special
 * forms, which are routed to ordinary plugins so there is exactly one
 * implementation of eval and shell:
 *
 *   .menu                      → command "menu"
 *   !ping hello world          → command "ping", args ["hello", "world"]
 *   > await db.countUsers()    → command "eval",  mode "statement"
 *   => 1 + 1                   → command "eval",  mode "expression"
 *   $sh npm -v                 → command "shell"
 *
 * Prefixes come from central config (`.`, `!`, `/`, `#` by default).
 */

import { truncate } from '../utils/format.js'
import { runWithSendContext } from '../utils/message-logger.js'

/**
 * Special syntaxes, checked longest-token-first so `!!` wins over `!`, and
 * both win over the ordinary prefix commands:
 *
 *   `!!` → async eval    `!` → eval    `$` → shell    `=>`/`>` → eval aliases
 *
 * `needsSpace` keeps a word like `!ping` from being read as eval — a bare `!`
 * must be followed by whitespace to count.
 */
export const SPECIAL_FORMS = [
  { token: '!!', command: 'eval', evalMode: 'async', needsSpace: false },
  { token: '=>', command: 'eval', evalMode: 'expression', needsSpace: false },
  { token: '>', command: 'eval', evalMode: 'statement', needsSpace: false },
  { token: '!', command: 'eval', evalMode: 'sync', needsSpace: true },
  { token: '$', command: 'shell', evalMode: null, needsSpace: true }
]

export const PREFIX_MESSAGE = 'That prefix is not recognised. See .menu for the available commands.'

/**
 * Parse an incoming body into a command invocation.
 *
 * @param {string} body
 * @param {string[]} prefixes
 * @returns {{
 *   isCommand: boolean, special: boolean, prefix: string|null,
 *   command: string|null, args: string[], argText: string,
 *   evalMode: string|null, rawCommand: string
 * }}
 */
export const parseCommand = (body, prefixes = ['.']) => {
  const empty = {
    isCommand: false,
    special: false,
    prefix: null,
    command: null,
    args: [],
    argText: '',
    evalMode: null,
    rawCommand: ''
  }

  if (typeof body !== 'string' || body.trim() === '') return empty
  const text = body.replace(/^\s+/, '')

  // ── special owner syntaxes (longest token first) ───────────
  for (const form of SPECIAL_FORMS) {
    if (!text.startsWith(form.token)) continue
    const remainder = text.slice(form.token.length)
    // A form either takes bare code (`!! code`) or needs whitespace before
    // its operand (`! code`, `$ cmd`). With nothing after the token, the
    // input is a bare `!`/`!!`/`$` — never a command.
    if (remainder === '' || (form.needsSpace && !/^\s/.test(remainder))) continue

    return {
      isCommand: true,
      special: true,
      prefix: form.token,
      command: form.command,
      args: remainder.trim() ? remainder.trim().split(/\s+/) : [],
      argText: remainder.trim(),
      evalMode: form.evalMode,
      rawCommand: text.trim()
    }
  }

  // ── ordinary prefix commands ───────────────────────────────
  // Longest prefix first, so a multi-character prefix beats a single character.
  const ordered = [...prefixes].sort((a, b) => b.length - a.length)
  const matched = ordered.find(prefix => prefix && text.startsWith(prefix))

  if (!matched) return empty

  // `!` is dual-purpose: an ordinary prefix (`!ping`) and the eval special
  // form (`! code`). When the whole text is only exclamation marks, it fell
  // through the special forms (`!!` alone, or a bare `!`) — treat it like any
  // other bare prefix: recognised, but not a command.
  if (matched === '!' && /^!+$/.test(text)) {
    return { ...empty, isCommand: false, prefix: matched }
  }

  const rest = text.slice(matched.length).trim()
  if (!rest) {
    return { ...empty, isCommand: false, prefix: matched }
  }

  const [rawCommand, ...args] = rest.split(/\s+/)
  const argText = rest.slice(rawCommand.length).trim()

  return {
    isCommand: true,
    special: false,
    prefix: matched,
    command: rawCommand.toLowerCase(),
    args,
    argText,
    evalMode: null,
    rawCommand: rest
  }
}

const PERMISSION_MESSAGES = {
  ownerOnly: 'This command is restricted to the bot owner.',
  adminOnly: 'This command is restricted to group admins.',
  groupOnly: 'This command can only be used in a group.',
  privateOnly: 'This command can only be used in a private chat.',
  botAdmin: 'The bot must be an admin in this group to do that.'
}

/**
 * Check a plugin's declared requirements against the resolved context.
 *
 * @returns {string|null} The reason it may not run, or `null` when allowed.
 */
export const checkPluginPermission = (record, ctx) => {
  if (record.ownerOnly && !ctx.isOwner) return PERMISSION_MESSAGES.ownerOnly
  if (record.groupOnly && !ctx.isGroup) return PERMISSION_MESSAGES.groupOnly
  if (record.privateOnly && ctx.isGroup) return PERMISSION_MESSAGES.privateOnly
  if (record.adminOnly && !ctx.isAdmin && !ctx.isOwner) return PERMISSION_MESSAGES.adminOnly
  if (record.botAdmin && !ctx.isBotAdmin) return PERMISSION_MESSAGES.botAdmin
  return null
}

/** Best-effort notification to the owners when a plugin throws. */
const notifyOwners = async ({ ctx, record, error }) => {
  const owners = ctx.config?.owner ?? []
  if (!owners.length) return
  const summary = `⚠️ Plugin "${record.name}" failed.\nUser: ${ctx.sender}\nChat: ${ctx.chat}\nError: ${truncate(error?.message ?? String(error), 300)}`
  for (const number of owners) {
    try {
      await ctx.sock.sendMessage(`${number}@s.whatsapp.net`, { text: summary })
    } catch {
      /* the owner may not be reachable; never let this break the handler */
    }
  }
}

/**
 * Run a plugin, isolating every failure.
 *
 * Nothing thrown by a plugin may escape this function — one broken command must
 * never take the bot down.
 *
 * @param {object} options
 * @param {object} options.record   Registry record
 * @param {object} options.ctx
 * @param {object} [options.logger]
 * @returns {Promise<{ ok: boolean, reason?: string }>}
 */
export const runPlugin = async ({ record, ctx, logger = null }) => {
  if (!record) return { ok: false, reason: 'unknown command' }

  if (!record.enabled) {
    await ctx.reply('That command is currently disabled.').catch(() => {})
    return { ok: false, reason: 'disabled' }
  }

  const denial = checkPluginPermission(record, ctx)
  if (denial) {
    await ctx.reply(denial).catch(() => {})
    return { ok: false, reason: denial }
  }

  const startedAt = Date.now()
  try {
    logger?.debug?.(`Running plugin "${record.name}" for ${ctx.sender}`)
    // Tag every send made inside the plugin with its name for the outgoing log.
    await runWithSendContext({ plugin: record.name }, () => record.execute(ctx))
    logger?.debug?.(`Plugin "${record.name}" finished in ${Date.now() - startedAt}ms`)

    try {
      ctx.db?.incrementCommandUsage(record.commands[0])
      ctx.db?.incrementStat('commands_run')
    } catch {
      /* bookkeeping must never fail a command */
    }

    return { ok: true }
  } catch (error) {
    logger?.error(`Plugin "${record.name}" threw: ${error.stack ?? error.message}`)
    try {
      ctx.db?.incrementStat('plugin_errors')
    } catch {
      /* ignore */
    }

    // Show the detail to the owner, stay quiet with everyone else.
    const detail = ctx.isOwner
      ? `❌ *${record.name}* failed:\n${truncate(error?.stack ?? error?.message ?? String(error), 700)}`
      : '❌ Something went wrong while running that command.'

    await ctx.reply(detail).catch(() => {})
    await ctx.react('❌').catch(() => {})
    await notifyOwners({ ctx, record, error })

    return { ok: false, reason: error?.message ?? String(error) }
  }
}

export default { parseCommand, checkPluginPermission, runPlugin, SPECIAL_FORMS, PREFIX_MESSAGE }
