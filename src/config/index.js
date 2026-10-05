/**
 * KURO — central configuration.
 *
 * `settings.js` in the project root is the single place you configure the bot.
 * This module loads it, fills anything missing from the built-in defaults,
 * normalises the values (owner numbers to digits, paths to absolute), validates
 * them, and exports one frozen object that the rest of the code imports.
 *
 * Nothing else in the project reads a config file, and nothing reads
 * `process.env` — with the narrow exception of the standard `NO_COLOR` /
 * `FORCE_COLOR` conventions honoured by the logger.
 *
 * An optional `settings.local.js` (gitignored) is merged on top, so secrets can
 * stay out of version control without an `.env`.
 */

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import {
  DEFAULT_SETTINGS,
  KNOWN_CLIENT_BROWSERS,
  KNOWN_CLIENT_LABELS,
  VALID_AUTH_TYPES,
  VALID_MODES,
  PAIRING_CODE_LENGTH
} from './defaults.js'

/** Absolute path of the project root (the folder holding package.json). */
export const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')

/** Resolve a path relative to the project root. */
export const resolveRoot = (...parts) => path.resolve(rootDir, ...parts)

/** Keep digits only — the only shape WhatsApp accepts for a phone number. */
export const digitsOnly = value => String(value ?? '').replace(/\D/g, '')

const isPlainObject = value =>
  value !== null && typeof value === 'object' && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype

/**
 * Recursively merge `override` onto `base`.
 * Arrays replace rather than concatenate, and `undefined` never wins.
 */
const mergeConfig = (base, override) => {
  if (!isPlainObject(override)) return override === undefined ? base : override
  const output = { ...base }
  for (const [key, value] of Object.entries(override)) {
    if (value === undefined) continue
    const current = base?.[key]
    output[key] = isPlainObject(value) && isPlainObject(current) ? mergeConfig(current, value) : value
  }
  return output
}

/** Import a settings module, or `{}` when the file does not exist. */
const loadSettingsFile = async name => {
  const file = resolveRoot(name)
  if (!fs.existsSync(file)) return { data: {}, file, present: false }
  try {
    const module = await import(pathToFileURL(file).href)
    const data = module?.default ?? {}
    if (!isPlainObject(data)) {
      throw new TypeError(`${name} must \`export default\` an object`)
    }
    return { data, file, present: true }
  } catch (error) {
    throw new Error(`Could not read ${name}: ${error.message}`)
  }
}

/** Notes collected while building the config, logged once at boot. */
const warnings = []
const warn = (message, level = 'warn') => warnings.push({ level, message })

const asInt = (value, fallback, { min = 0, max = Number.MAX_SAFE_INTEGER } = {}) => {
  const parsed = Number.parseInt(String(value ?? '').trim(), 10)
  if (!Number.isFinite(parsed)) return fallback
  return Math.min(max, Math.max(min, parsed))
}

/** True for a remote URL, which must never be turned into a local path. */
const isRemote = value => typeof value === 'string' && /^[a-z][a-z0-9+.-]*:\/\//i.test(value)

const asAbsolute = value => {
  const text = String(value ?? '').trim()
  if (!text || isRemote(text)) return ''
  return path.isAbsolute(text) ? text : resolveRoot(text)
}

/** `['.', '!']` → validated, de-duplicated, longest-first. */
const normalizePrefixes = value => {
  const list = Array.isArray(value) ? value : [value]
  const cleaned = []
  for (const entry of list) {
    if (typeof entry !== 'string' || entry.trim() === '') continue
    const prefix = entry.trim()
    if (prefix.length > 3) {
      warn(`prefix "${prefix}" is longer than 3 characters and was ignored.`)
      continue
    }
    if (!cleaned.includes(prefix)) cleaned.push(prefix)
  }
  if (cleaned.length === 0) {
    warn('no usable prefix was configured — falling back to ".".')
    cleaned.push('.')
  }
  return cleaned.sort((a, b) => b.length - a.length)
}

const normalizeOwners = value => {
  const list = Array.isArray(value) ? value : value ? [value] : []
  const owners = []
  for (const entry of list) {
    const raw = String(entry ?? '').trim()
    if (!raw) continue
    if (raw.startsWith('0')) {
      warn(`owner "${raw}" starts with 0 — use the international format instead (e.g. 6281234567890).`)
    }
    if (digitsOnly(raw).length < 6) {
      warn(`owner "${raw}" is too short to be a phone number and was ignored.`)
      continue
    }
    const digits = digitsOnly(raw)
    if (digits !== raw && !raw.startsWith('+')) {
      warn(`owner "${raw}" contained separators; stored as "${digits}".`)
    }
    if (digits.startsWith('0')) continue
    if (!owners.includes(digits)) owners.push(digits)
  }
  return owners
}

/**
 * Validate the client identity reported to WhatsApp: `[label, browser, version]`.
 *
 * WhatsApp only accepts the client labels it knows. An invented one (e.g.
 * `'KURO'`) connects and shows a QR, but every pairing request comes back as
 * `bad-request`, so KURO repairs the label rather than letting the operator hit
 * that wall. The browser name and version are kept as configured.
 */
export const normalizeBrowser = value => {
  const fallback = [...DEFAULT_SETTINGS.connection.browser]

  if (value === undefined) return fallback
  if (!Array.isArray(value) || value.length !== 3) {
    warn('connection.browser must be [label, browser, version] — using the default identity instead.')
    return fallback
  }

  const [label, browserName, version] = value.map(part => String(part ?? '').trim())
  if (!label || !browserName || !version) {
    warn('connection.browser has an empty entry — using the default identity instead.')
    return fallback
  }

  if (!KNOWN_CLIENT_LABELS.includes(label)) {
    warn(
      `connection.browser label "${label}" is not a client WhatsApp recognises (${KNOWN_CLIENT_LABELS.join(', ')}) — ` +
        `using "${fallback[0]}". Pairing codes are rejected with bad-request under an unknown label.`
    )
    return [fallback[0], browserName, version]
  }

  if (!KNOWN_CLIENT_BROWSERS.includes(browserName)) {
    warn(
      `connection.browser name "${browserName}" has no WhatsApp companion id (${KNOWN_CLIENT_BROWSERS.join(', ')}) — ` +
        `using "${fallback[1]}". Pairing codes are rejected for an unknown browser.`
    )
    return [label, fallback[1], version]
  }

  return [label, browserName, version]
}

const buildConfig = async () => {
  const main = await loadSettingsFile('settings.js')
  const local = await loadSettingsFile('settings.local.js')

  if (!main.present) {
    warn('settings.js was not found — KURO is running on built-in defaults. Copy settings.js from the repository to configure it.')
  }
  if (local.present) {
    // Only worth mentioning when it actually changes something.
    if (Object.keys(local.data).length) warn(`settings.local.js found and merged on top of settings.js.`, 'info')
  }

  const merged = mergeConfig(mergeConfig(DEFAULT_SETTINGS, main.data), local.data)

  // ── identity ───────────────────────────────────────────────
  const owner = normalizeOwners(merged.owner)
  if (owner.length === 0) {
    warn('no owner number is configured — every owner-only command will be unusable.')
  }

  const mode = String(merged.mode ?? '').toLowerCase()
  if (!VALID_MODES.includes(mode)) {
    warn(`mode "${merged.mode}" is not one of ${VALID_MODES.join(', ')} — using "public".`)
  }

  // ── auth ───────────────────────────────────────────────────
  const authType = VALID_AUTH_TYPES.includes(merged.auth?.type) ? merged.auth.type : 'multi-file'
  if (!VALID_AUTH_TYPES.includes(merged.auth?.type)) {
    warn(`auth.type "${merged.auth?.type}" is not one of ${VALID_AUTH_TYPES.join(', ')} — using "multi-file".`)
  }

  // ── pairing ────────────────────────────────────────────────
  const customCode = String(merged.pairing?.customCode ?? '').trim()
  let pairingCode = ''
  if (customCode) {
    if (customCode.length === PAIRING_CODE_LENGTH) {
      pairingCode = customCode
    } else {
      warn(
        `pairing.customCode must be exactly ${PAIRING_CODE_LENGTH} characters (got ${customCode.length}) — a random code will be generated instead.`
      )
    }
  }
  const pairingNumber = digitsOnly(merged.pairing?.number)
  if (merged.pairing?.number && pairingNumber !== String(merged.pairing.number).trim()) {
    warn(`pairing.number contained separators; stored as "${pairingNumber}".`)
  }
  if (pairingNumber.startsWith('0')) {
    warn('pairing.number starts with 0 — use the international format (e.g. 6281234567890).')
  }

  // ── paths ──────────────────────────────────────────────────
  const sessionFolder = asAbsolute(merged.auth?.folder) || resolveRoot('session')
  const databasePath = asAbsolute(merged.database?.path) || resolveRoot('database', 'kuro.sqlite')
  const pluginsDirectory = asAbsolute(merged.plugins?.directory) || resolveRoot('plugins')

  if (!fs.existsSync(pluginsDirectory)) {
    warn(`plugins.directory "${pluginsDirectory}" does not exist — no plugins will be loaded.`)
  }

  // ── menu card ──────────────────────────────────────────────
  const menuThumbnail = isRemote(merged.menu?.thumbnail)
    ? String(merged.menu.thumbnail).trim()
    : asAbsolute(merged.menu?.thumbnail)
  if (menuThumbnail && !isRemote(menuThumbnail) && !fs.existsSync(menuThumbnail)) {
    // Informational: the menu still works, it just cannot draw the large card.
    warn(
      `menu.thumbnail "${merged.menu.thumbnail}" does not exist yet — the menu card falls back to plain text until you add that file.`,
      'info'
    )
  }

  // ── channel ────────────────────────────────────────────────
  const channelJid = String(merged.channel?.jid ?? '').trim()
  const channelEnabled = Boolean(merged.channel?.enabled)
  if (channelEnabled && !channelJid.endsWith('@newsletter')) {
    warn('channel.enabled is true but channel.jid does not end with @newsletter — the channel helper stays disabled.')
  }

  const extensions = (Array.isArray(merged.plugins?.extensions) ? merged.plugins.extensions : ['.js'])
    .map(value => String(value ?? '').trim())
    .filter(Boolean)
    .map(value => (value.startsWith('.') ? value : `.${value}`))

  const config = {
    botName: String(merged.botName || DEFAULT_SETTINGS.botName),
    version: String(merged.version || DEFAULT_SETTINGS.version),
    ownerName: String(merged.ownerName || DEFAULT_SETTINGS.ownerName),

    /** Owner phone numbers, digits only, de-duplicated. */
    owner,

    timezone: String(merged.timezone || DEFAULT_SETTINGS.timezone),
    prefix: normalizePrefixes(merged.prefix),
    mode: VALID_MODES.includes(mode) ? mode : 'public',
    debug: Boolean(merged.debug),

    pairing: {
      enabled: merged.pairing?.enabled !== false,
      /** Empty when unusable, so the library generates a random code. */
      customCode: pairingCode,
      number: pairingNumber
    },

    auth: {
      type: authType,
      folder: sessionFolder
    },

    connection: {
      reconnectDelayMs: asInt(merged.connection?.reconnectDelayMs, 3000, { min: 250, max: 600000 }),
      reconnectMaxDelayMs: asInt(merged.connection?.reconnectMaxDelayMs, 60000, { min: 250, max: 3600000 }),
      reconnectMaxAttempts: asInt(merged.connection?.reconnectMaxAttempts, 0, { min: 0, max: 100 }),
      markOnlineOnConnect: Boolean(merged.connection?.markOnlineOnConnect),
      syncFullHistory: Boolean(merged.connection?.syncFullHistory),
      /** `[label, browser, version]`, repaired when WhatsApp would reject it. */
      browser: normalizeBrowser(merged.connection?.browser)
    },

    database: {
      type: 'sqlite',
      path: databasePath
    },

    menu: {
      url: String(merged.menu?.url ?? '').trim(),
      thumbnail: menuThumbnail,
      title: String(merged.menu?.title ?? '').trim() || `${merged.botName || 'KURO'} WhatsApp Bot`,
      description: String(merged.menu?.description ?? '').trim() || 'Modern modular WhatsApp bot',
      thumbnailWidth: asInt(merged.menu?.thumbnailWidth, 640, { min: 32, max: 4096 }),
      /** 0 keeps the measured aspect ratio; any positive number scales the height. */
      thumbnailHeightRatioOverride: (() => {
        const ratio = Number(merged.menu?.thumbnailHeightRatioOverride ?? 0)
        return Number.isFinite(ratio) && ratio > 0 ? ratio : 0
      })()
    },

    channel: {
      enabled: channelEnabled && channelJid.endsWith('@newsletter'),
      jid: channelJid,
      name: String(merged.channel?.name ?? '').trim()
    },

    plugins: {
      directory: pluginsDirectory,
      extensions: extensions.length ? extensions : ['.js'],
      disabledPrefix: String(merged.plugins?.disabledPrefix ?? '_').slice(0, 1) || '_',
      maxSourceBytes: asInt(merged.plugins?.maxSourceBytes, 512 * 1024, { min: 1024, max: 16 * 1024 * 1024 })
    },

    /** Terminal message logger switches (all default true). */
    messageLog: {
      enabled: merged.messageLog?.enabled !== false,
      showContent: merged.messageLog?.showContent !== false,
      showMediaType: merged.messageLog?.showMediaType !== false,
      showGroupName: merged.messageLog?.showGroupName !== false,
      showTimestamp: merged.messageLog?.showTimestamp !== false,
      showSender: merged.messageLog?.showSender !== false,
      showMessageType: merged.messageLog?.showMessageType !== false,
      showOutgoing: merged.messageLog?.showOutgoing !== false,
      useColors: merged.messageLog?.useColors !== false,
      multiline: merged.messageLog?.multiline !== false,
      wrapText: merged.messageLog?.wrapText !== false
    },

    /** Prefix allowlist for the owner shell (`$ …`). */
    shellAllowlist: (Array.isArray(merged.shellAllowlist) ? merged.shellAllowlist : [])
      .map(value => String(value ?? '').trim())
      .filter(Boolean),

    paths: {
      root: rootDir,
      session: sessionFolder,
      database: databasePath,
      tmp: resolveRoot('tmp'),
      media: resolveRoot('media')
    },

    limits: {
      evalOutputLimit: asInt(merged.limits?.evalOutputLimit, 4000, { min: 200, max: 100000 }),
      shellOutputLimit: asInt(merged.limits?.shellOutputLimit, 4000, { min: 200, max: 100000 }),
      shellTimeoutMs: asInt(merged.limits?.shellTimeoutMs, 30000, { min: 1000, max: 600000 })
    },

    api: {
      key: String(merged.api?.key ?? '')
    },

    /** Which settings files were actually read — shown at boot. */
    sources: {
      settings: main.present ? path.relative(rootDir, main.file) || 'settings.js' : null,
      local: local.present ? path.relative(rootDir, local.file) || 'settings.local.js' : null
    }
  }

  // The database folder is created on demand, so this is informational only.
  if (config.database.path && !fs.existsSync(path.dirname(config.database.path))) {
    warn(`database folder "${path.dirname(config.database.path)}" does not exist yet — it will be created.`, 'info')
  }

  return config
}

export const config = await buildConfig()

/** Validation notes collected while building the config, logged at boot. */
export const configWarnings = Object.freeze([...warnings])

/** Paths of the settings files that were read. */
export const configSources = config.sources

/** Where the operator should look when something is misconfigured. */
export const SETTINGS_HINT = config.sources.settings ?? 'settings.js'

export default config
