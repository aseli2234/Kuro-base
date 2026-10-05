/**
 * `.runtime` — process and database diagnostics.
 */

import os from 'node:os'
import process from 'node:process'
import { runtime } from '../../src/runtime.js'
import { formatBytes } from '../../src/utils/format.js'
import { formatUptime, uptimeSince } from '../../src/utils/time.js'

export default {
  name: 'runtime',
  command: ['runtime', 'stats'],
  category: 'tools',
  description: 'Show uptime, memory, process and database status',

  async execute(ctx) {
    const memory = process.memoryUsage()
    const load = os.loadavg?.() ?? [0, 0, 0]
    const db = ctx.db?.status?.() ?? { connected: false }

    const statLines = []
    try {
      const stats = ctx.db?.allStats?.() ?? {}
      for (const [key, value] of Object.entries(stats).sort()) statLines.push(`  ${key}: ${value}`)
    } catch {
      /* stats are informational */
    }

    const lines = [
      '*RUNTIME*',
      '────────────────────────',
      `› Uptime      : ${formatUptime(Date.now() - runtime.startedAt)}`,
      `› Started     : ${new Date(runtime.startedAt).toISOString()}`,
      `› PID         : ${process.pid}`,
      `› Node.js     : ${process.version}`,
      `› Platform    : ${os.platform()} ${os.arch()} (${os.release()})`,
      `› CPU cores   : ${os.cpus()?.length ?? 'unknown'}`,
      `› Load avg    : ${load.map(value => value.toFixed(2)).join(' / ')}`,
      '────────────────────────',
      '*MEMORY*',
      `› RSS         : ${formatBytes(memory.rss)}`,
      `› Heap used   : ${formatBytes(memory.heapUsed)} / ${formatBytes(memory.heapTotal)}`,
      `› External    : ${formatBytes(memory.external)}`,
      '────────────────────────',
      '*DATABASE*',
      `› Engine      : SQLite (better-sqlite3)`,
      `› Status      : ${db.connected ? 'connected' : 'disconnected'}`,
      `› Schema      : v${db.version ?? '?'} ${db.pending ? `(${db.pending} pending)` : '(up to date)'}`,
      `› Tables      : ${db.tables ?? '?'}`,
      `› Size        : ${db.sizeBytes ? formatBytes(db.sizeBytes) : 'unknown'}`,
      `› Users       : ${ctx.db?.countUsers?.() ?? 0}`,
      '────────────────────────',
      '*BOT*',
      `› Plugins     : ${ctx.plugins?.size ?? 0} (${ctx.plugins?.commandCount ?? 0} triggers)`,
      `› Socket      : ${runtime.socket ? 'bound' : 'not bound'}`,
      `› Channel     : ${ctx.channel?.enabled ? 'enabled' : 'disabled'}`,
      `› Session     : ${uptimeSince(runtime.startedAt)} old`
    ]

    if (statLines.length) lines.push('────────────────────────', '*COUNTERS*', ...statLines)

    await ctx.reply(lines.join('\n'))
  }
}
