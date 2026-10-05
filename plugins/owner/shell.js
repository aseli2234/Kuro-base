/**
 * `.shell` / `$ <command>` — owner-only shell access with an allowlist.
 *
 *   $ node -v
 *   $ df -h
 *   .shell <command>
 *
 * Safety envelope:
 *   - **allowlist** — only the administrative commands in
 *     `settings.shellAllowlist` run (matched against argv[0]); everything
 *     else is refused with a short notice and a WARN in the terminal log
 *   - hard timeout (`limits.shellTimeoutMs`), the process is killed on expiry
 *   - bounded stdout/stderr, so `cat /dev/urandom` cannot fill memory
 *   - every invocation is logged with timestamp, command and outcome
 *   - the environment is passed through untouched by the process itself, but
 *     nothing is printed from it; `env` output lands in the chat redacted
 *
 * Owner check happens in the dispatcher before `execute()` runs.
 */

import { exec } from 'node:child_process'
import { runtime } from '../../src/runtime.js'
import { clampMiddle } from '../../src/utils/format.js'

/** Values that must never appear in output sent to a chat. */
const SENSITIVE_PATTERNS = [
  [/-----BEGIN [A-Z ]+-----[\s\S]*?-----END [A-Z ]*-----/g, '[REDACTED_PRIVATE_KEY]'],
  [/(?:^|\s)(?:AUTH|SESSION|TOKEN|API_?KEY|PASSWORD|PASS)\s*=\s*\S+/gi, '$1[REDACTED]'],
  [/creds\.json/gi, '[REDACTED_SESSION_FILE]']
]

const redactOutput = text => {
  let output = String(text ?? '')
  const apiKey = runtime.config?.api?.key
  if (apiKey) output = output.split(apiKey).join('[REDACTED_API_KEY]')
  for (const [pattern, replacement] of SENSITIVE_PATTERNS) {
    output = output.replace(pattern, replacement)
  }
  return output
}

const run = (command, { cwd, timeout, maxBuffer }) =>
  new Promise(resolve => {
    exec(
      command,
      {
        cwd,
        timeout,
        maxBuffer,
        encoding: 'utf8',
        windowsHide: true,
        shell: true,
        killSignal: 'SIGKILL'
      },
      (error, stdout, stderr) => {
        resolve({
          code: error?.code ?? 0,
          killed: Boolean(error?.killed || error?.signal),
          timedOut: Boolean(error?.killed && error?.signal),
          signal: error?.signal ?? null,
          stdout: stdout ?? '',
          stderr: stderr ?? error?.message ?? ''
        })
      }
    )
  })

/** First token of a command string, quotes and separators stripped. */
const firstToken = command => String(command ?? '').trim().split(/\s+/)[0]?.replace(/^["']|["',;|&]+$/g, '') ?? ''

/** Is the command's argv[0] on the allowlist? */
export const isAllowedCommand = (command, allowlist = []) => {
  const token = firstToken(command).toLowerCase()
  if (!token) return false
  return allowlist.some(entry => String(entry).toLowerCase() === token)
}

export default {
  name: 'shell',
  command: ['shell', 'sh'],
  category: 'owner',
  description: 'Run an allowlisted shell command on the host',
  usage: '.shell <command>   |   $ <command>',
  example: '$ df -h',
  ownerOnly: true,

  async execute(ctx) {
    const command = (ctx.argText ?? '').trim()

    if (!command) {
      const allowlist = ctx.config.shellAllowlist?.length
        ? ctx.config.shellAllowlist.map(entry => `\`${entry}\``).join(', ')
        : '_(empty — add entries to settings.js)_'
      await ctx.reply(['*SHELL*', '────────────────────────', '`$ <command>`', '`' + `${ctx.prefix}shell <command>` + '`', '', `Allowed commands: ${allowlist}`].join('\n'))
      return
    }

    // ── allowlist gate ─────────────────────────────────────────
    const allowlist = ctx.config.shellAllowlist ?? []
    if (!isAllowedCommand(command, allowlist)) {
      ctx.logger?.warn?.(`shell REFUSED for ${ctx.sender}: ${command}`)
      await ctx.reply(`🚫 Command not allowed. Permitted: ${allowlist.map(entry => `\`${entry}\``).join(', ')}`)
      return
    }

    const timeout = ctx.config.limits.shellTimeoutMs
    const limit = ctx.config.limits.shellOutputLimit

    await ctx.react('⏳').catch(() => {})
    const startedAt = Date.now()
    const outcome = await run(command, {
      cwd: ctx.config.paths.root,
      timeout,
      maxBuffer: 512 * 1024
    })
    const elapsed = Date.now() - startedAt

    // Audit line in the terminal: who ran what, and how it ended.
    ctx.logger?.[outcome.code === 0 ? 'info' : 'warn']?.(
      `shell by ${ctx.sender}: ${command} → exit ${outcome.code}${outcome.timedOut ? ' (killed)' : ''} in ${elapsed}ms`
    )

    const sections = [
      `*SHELL* · \`${elapsed} ms\` · exit \`${outcome.code}\`${outcome.timedOut ? ` · KILLED after ${timeout} ms` : ''}`,
      '────────────────────────',
      `$ ${command}`
    ]

    const stdout = redactOutput(outcome.stdout.trimEnd())
    const stderr = redactOutput(outcome.stderr.trimEnd())

    if (stdout) sections.push('*STDOUT*', clampMiddle(stdout, limit))
    if (stderr) sections.push('*STDERR*', clampMiddle(stderr, limit))
    if (!stdout && !stderr) sections.push('_(no output)_')

    await ctx.react(outcome.code === 0 && !outcome.timedOut ? '✅' : '❌').catch(() => {})
    await ctx.reply(sections.join('\n'))
  }
}
