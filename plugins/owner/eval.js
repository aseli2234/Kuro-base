/**
 * `.eval` — owner-only JavaScript evaluation, three syntaxes:
 *
 *   !  1 + 1            sync eval, shows the value
 *   !! await db.x()     async eval, `await` allowed
 *   => 1 + 1            expression alias (async engine)
 *   > code              statement alias (async engine)
 *   .eval <code>        engine chosen automatically
 *
 * All modes share the same guard rails: a hard timeout, a bounded output and
 * redaction of the configured API key. Errors — syntax and runtime, promise
 * rejections included — are caught and shown; they never stop the bot.
 *
 * Owner check happens in the dispatcher before `execute()` runs, resolved from
 * `settings.owner` and the LID mapping — never from message text.
 */

import util from 'node:util'
import process from 'node:process'
import { runtime } from '../../src/runtime.js'
import { clampMiddle } from '../../src/utils/format.js'

const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor
const SyncFunction = Object.getPrototypeOf(function () {}).constructor

/** Nothing may hang the bot's event loop forever. */
const EVAL_TIMEOUT_MS = 15000

/** Shown to other users instead of internal details. */
const GENERIC_ERROR = '❌ Evaluation failed — check the terminal log for details.'

/**
 * Remove values that must never leave the process, even for the owner, in case
 * the output is screenshotted or forwarded.
 */
const redact = text => {
  let output = String(text ?? '')
  const apiKey = runtime.config?.api?.key
  if (apiKey) output = output.split(apiKey).join('[REDACTED_API_KEY]')
  output = output.replace(/-----BEGIN [A-Z ]+-----[\s\S]*?-----END [A-Z ]*-----/g, '[REDACTED_PRIVATE_KEY]')
  return output
}

const inspect = value => {
  try {
    return util.inspect(value, { depth: 3, colors: false, breakLength: 100, maxArrayLength: 50 })
  } catch {
    return String(value)
  }
}

const buildScope = (ctx, print) => ({
  // KURO plumbing
  sock: ctx.sock,
  ctx,
  m: ctx.m,
  msg: ctx.message,
  config: ctx.config,
  db: ctx.db,
  plugins: ctx.plugins,
  registry: ctx.plugins,
  logger: ctx.logger,
  channel: ctx.channel,
  runtime,

  // capture output instead of dumping it into the bot's console
  print,
  console: { log: print, info: print, warn: print, error: print, debug: print, trace: print },

  // process primitives that are useful and harmless
  process,
  Buffer,
  setTimeout,
  clearTimeout,
  setInterval,
  clearInterval,
  Promise,
  JSON,
  Math,
  Date,
  Object,
  Array,
  String,
  Number,
  Boolean,
  RegExp,
  Map,
  Set,
  URL,

  // ESM has no require(); say so clearly rather than throwing ReferenceError
  require: () => {
    throw new Error("require() is not available — KURO is ESM. Use `await import('node:fs')` instead.")
  }
})

/** Race any work against the hard timeout. */
const withTimeout = async work => {
  let timer = null
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`Evaluation timed out after ${EVAL_TIMEOUT_MS} ms`)), EVAL_TIMEOUT_MS)
    timer.unref?.()
  })
  try {
    return await Promise.race([work(), timeout])
  } finally {
    clearTimeout(timer)
  }
}

/**
 * Sync engine (`!`) — plain `new Function`, so top-level `await` is a syntax
 * error by design; the async engine is the one for that.
 */
const evaluateSync = (code, scope) => {
  const body = /^[\s]*(return\b|const\b|let\b|var\b|function\b|class\b|if\b|for\b|while\b|throw\b|print\()/.test(code)
    ? code
    : `return (${code})`
  const fn = new SyncFunction(...Object.keys(scope), body)
  return { result: fn(...Object.values(scope)), logs: scope.__logs }
}

/**
 * Async engine (`!!`, `=>`, `>`) — top-level `await` allowed; a rejected
 * promise surfaces as a normal throw here, so it lands in the same
 * error handling as everything else.
 */
const evaluateAsync = async (code, scope, mode) => {
  const body = mode === 'expression' ? `return (${code})` : code
  const fn = new AsyncFunction(...Object.keys(scope), body)
  return { result: await fn(...Object.values(scope)), logs: scope.__logs }
}

export default {
  name: 'eval',
  command: ['eval', 'ev'],
  category: 'owner',
  description: 'Evaluate JavaScript in the bot process',
  usage: '.eval <code>   |   ! <code>   |   !! <async code>   |   => <expression>',
  example: '!! await db.countUsers()',
  ownerOnly: true,

  async execute(ctx) {
    const requested = ctx.evalMode ?? 'async'
    const code = (ctx.argText ?? '').trim()

    if (!code) {
      await ctx.reply(
        [
          '*EVAL*',
          '────────────────────────',
          '`!  <code>`        sync — one expression or statements',
          '`!! <code>`        async — top-level `await` allowed',
          '`=> <expression>`  async expression',
          '`>  <statements>`  async statements',
          '`' + `${ctx.prefix}eval <code>` + '`      engine picked automatically',
          '',
          'Available: sock, ctx, m, msg, config, db, plugins, channel, logger, runtime, print'
        ].join('\n')
      )
      return
    }

    // Choose the engine: `!` is sync, everything else is async. Auto mode
    // (`!eval …`) uses async so `await` keeps working either way.
    const mode = requested === 'sync' ? 'sync' : 'async'

    const startedAt = Date.now()
    const logs = []
    const print = (...args) => {
      const line = args.map(value => (typeof value === 'string' ? value : inspect(value))).join(' ')
      logs.push(line)
      return args[0]
    }

    const scope = { ...buildScope(ctx, print), __logs: logs }

    try {
      const { result, logs: printed } = await withTimeout(async () =>
        mode === 'sync' ? evaluateSync(code, scope) : evaluateAsync(code, scope, requested)
      )
      const elapsed = Date.now() - startedAt

      const sections = [`*EVAL* \`${mode}\` · \`${elapsed} ms\``, '────────────────────────']
      if (printed.length) sections.push('*LOGS*', ...printed.map(line => clampMiddle(redact(line), ctx.config.limits.evalOutputLimit)))
      sections.push('*RESULT*', clampMiddle(redact(inspect(result)), ctx.config.limits.evalOutputLimit))

      await ctx.reply(sections.join('\n'))
    } catch (error) {
      const isSyntax = error instanceof SyntaxError
      const title = isSyntax ? '*SYNTAX ERROR*' : '*EVAL ERROR*'
      ctx.logger?.warn?.(`eval ${mode} failed: ${error?.stack ?? error?.message}`)

      await ctx.reply(
        [
          title,
          '────────────────────────',
          oneLine(redact(error?.message ?? String(error)))
        ].join('\n')
      )
    }

    function oneLine(text) {
      return String(text ?? '').split('\n').slice(0, 6).join('\n')
    }
  }
}
