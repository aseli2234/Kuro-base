/**
 * KURO — central logger.
 *
 * One logger for the whole process: levels, colour, timezone-aware timestamps
 * and a pino-compatible adapter so the same output also serves the Elaina
 * Baileys socket (which expects an object exposing `trace`…`fatal`).
 *
 * The logger never writes to a stream that can throw. A broken pipe must not
 * take the bot down.
 */

import config from '../config/index.js'
import { clockTime } from './time.js'

export const LEVELS = Object.freeze({
  DEBUG: 10,
  INFO: 20,
  SUCCESS: 25,
  WARN: 30,
  ERROR: 40,
  SILENT: 100
})

const COLORS = {
  reset: '\u001b[0m',
  dim: '\u001b[2m',
  red: '\u001b[31m',
  green: '\u001b[32m',
  yellow: '\u001b[33m',
  blue: '\u001b[34m',
  magenta: '\u001b[35m',
  cyan: '\u001b[36m',
  gray: '\u001b[90m'
}

const STYLES = {
  DEBUG: { label: 'DEBUG', color: COLORS.gray },
  INFO: { label: 'INFO', color: COLORS.cyan },
  SUCCESS: { label: 'SUCCESS', color: COLORS.green },
  WARN: { label: 'WARN', color: COLORS.yellow },
  ERROR: { label: 'ERROR', color: COLORS.red },
  /** Connection events — a distinct purple so they are easy to scan. */
  CONNECTION: { label: 'CONNECTION', color: COLORS.magenta }
}

const useColor = (() => {
  // Respect NO_COLOR and piped output.
  if (process.env.NO_COLOR) return false
  if (process.env.FORCE_COLOR) return true
  return Boolean(process.stdout?.isTTY)
})()

const paint = (color, text) => (useColor ? `${color}${text}${COLORS.reset}` : text)

const write = line => {
  try {
    process.stdout.write(`${line}\n`)
  } catch {
    /* stdout gone — nothing sensible left to do */
  }
}

/** Render any argument list into a readable suffix. */
const renderDetails = details => {
  const parts = []
  for (const detail of details) {
    if (detail === undefined) continue
    if (detail instanceof Error) {
      parts.push(detail.stack || detail.message)
      continue
    }
    if (typeof detail === 'string') {
      parts.push(detail)
      continue
    }
    try {
      parts.push(JSON.stringify(detail))
    } catch {
      parts.push(String(detail))
    }
  }
  return parts.join(' ')
}

const normalizeScope = scope => {
  if (!scope || typeof scope !== 'object') return ''
  const label = scope.scope || scope.module || scope.class || scope.name
  return label ? ` (${label})` : ''
}

class Logger {
  /**
   * @param {{ level?: number, scope?: object, timezone?: string }} [options]
   */
  constructor(options = {}) {
    this.level = options.level ?? (config.debug ? LEVELS.DEBUG : LEVELS.INFO)
    this.scope = options.scope ?? null
    this.timezone = options.timezone ?? config.timezone
    this.prefix = normalizeScope(this.scope)
  }

  setLevel(level) {
    this.level = typeof level === 'number' ? level : (LEVELS[String(level).toUpperCase()] ?? this.level)
    return this
  }

  /** Create a child logger that tags every line with a scope label. */
  child(scope) {
    return new Logger({
      level: this.level,
      timezone: this.timezone,
      scope: { ...(this.scope ?? {}), ...(scope ?? {}) }
    })
  }

  log(levelName, ...details) {
    const threshold = LEVELS[levelName] ?? LEVELS.INFO
    if (threshold < this.level) return
    const style = STYLES[levelName] ?? STYLES.INFO
    const timestamp = paint(COLORS.dim, `[${clockTime(this.timezone)}]`)
    const label = paint(style.color, `[${style.label}]`)
    const message = renderDetails(details)
    write(`${timestamp} ${label}${this.prefix} ${message}`)
  }

  debug(...details) {
    this.log('DEBUG', ...details)
  }

  info(...details) {
    this.log('INFO', ...details)
  }

  success(...details) {
    this.log('SUCCESS', ...details)
  }

  warn(...details) {
    this.log('WARN', ...details)
  }

  error(...details) {
    this.log('ERROR', ...details)
  }

  /** Connection lifecycle line (purple label). */
  connection(...details) {
    this.log('CONNECTION', ...details)
  }

  /** Print a raw banner line with no level tag. */
  raw(text = '') {
    write(String(text))
  }

  /** Print a separators/title block, used on boot. */
  banner(title, lines = []) {
    const columns = 58
    const inner = columns - 1

    const row = (text, color) => {
      const value = String(text ?? '')
      const shown = value.length > inner ? `${value.slice(0, inner - 3)}...` : value
      write(`${paint(COLORS.magenta, '│')} ${paint(color, shown.padEnd(inner))}${paint(COLORS.magenta, '│')}`)
    }

    write(paint(COLORS.magenta, `┌${'─'.repeat(columns)}┐`))
    row(title, COLORS.cyan)
    for (const line of lines) row(line, COLORS.reset)
    write(paint(COLORS.magenta, `└${'─'.repeat(columns)}┘`))
  }
}

export const logger = new Logger()

/**
 * Pino-compatible facade for Elaina Baileys.
 *
 * The library calls `logger.trace/debug/info/warn/error/fatal` and
 * `logger.child(...)`, sometimes as `(obj, message)` and sometimes as
 * `(message)`. Everything below the INFO threshold is routed to DEBUG so the
 * protocol chatter stays out of the console unless `debug: true` is set in
 * `settings.js`.
 */
const PINO_THRESHOLD = {
  trace: 10,
  debug: 20,
  info: 30,
  warn: 40,
  error: 50,
  fatal: 60,
  silent: 100
}

export const createSocketLogger = (level = 'warn') => {
  const threshold = PINO_THRESHOLD[String(level).toLowerCase()] ?? PINO_THRESHOLD.warn

  /**
   * Calls at or above the threshold reach the console at their own level.
   * Everything below is demoted to DEBUG, so the protocol chatter is only
   * visible when `debug: true` is set in settings.js.
   */
  const route = (method, thresholdOf) => (...args) => {
    if (method === 'error' || method === 'fatal') logger.error(...args)
    else if (thresholdOf >= threshold) logger[method](...args)
    else logger.debug(...args)
  }

  return {
    level,
    child: scope => createSocketLogger(scope?.level ?? level),
    trace: route('debug', PINO_THRESHOLD.trace),
    debug: route('debug', PINO_THRESHOLD.debug),
    info: route('info', PINO_THRESHOLD.info),
    warn: route('warn', PINO_THRESHOLD.warn),
    error: route('error', PINO_THRESHOLD.error),
    fatal: route('error', PINO_THRESHOLD.fatal)
  }
}

export default logger
