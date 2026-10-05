/**
 * `.sysinfo` — Comprehensive system, memory, CPU, and performance metrics.
 */

import os from 'node:os'
import process from 'node:process'
import { runtime } from '../../src/runtime.js'
import { formatBytes } from '../../src/utils/format.js'
import { formatUptime } from '../../src/utils/time.js'
import { getThemeConfig } from '../../src/lib/theme.js'

export default {
  name: 'sysinfo',
  command: ['sysinfo', 'systeminfo', 'neofetch', 'specs'],
  category: 'tools',
  description: 'Show detailed system info: RSS memory, RAM specs, CPU, uptime, ping & OS',

  async execute(ctx) {
    const startedAt = Date.now()
    const memory = process.memoryUsage()
    const totalMem = os.totalmem()
    const freeMem = os.freemem()
    const usedMem = totalMem - freeMem
    const memPercent = totalMem > 0 ? ((usedMem / totalMem) * 100).toFixed(1) : '0'
    const heapPercent = memory.heapTotal > 0 ? ((memory.heapUsed / memory.heapTotal) * 100).toFixed(1) : '0'

    const cpus = os.cpus() || []
    const cpuModel = cpus[0]?.model?.trim() || 'Unknown CPU'
    const cpuSpeed = cpus[0]?.speed ? `${cpus[0].speed} MHz` : '-'
    const cpuCount = cpus.length
    const load = os.loadavg?.() ?? [0, 0, 0]

    const botUptime = formatUptime(Date.now() - runtime.startedAt)
    const osUptime = formatUptime(os.uptime() * 1000)
    const db = ctx.db?.status?.() ?? { connected: false }
    const theme = getThemeConfig(ctx.db, ctx.config)

    const latency = Date.now() - (ctx.m?.timestamp ? ctx.m.timestamp * 1000 : startedAt)
    const pingMs = Math.max(1, latency > 0 && latency < 60000 ? latency : Date.now() - startedAt)

    const lines = [
      '💻 *SYSTEM INFORMATION*',
      '────────────────────────',
      `› OS / Platform : ${os.type()} ${os.release()} (${os.arch()})`,
      `› Platform Type : ${os.platform()}`,
      `› Hostname      : ${os.hostname?.() || '-'}`,
      '────────────────────────',
      '⚡ *PROCESSOR & HARDWARE*',
      `› CPU Model     : ${cpuModel}`,
      `› Cores & Speed : ${cpuCount} Core(s) @ ${cpuSpeed}`,
      `› Load Average  : ${load.map(v => v.toFixed(2)).join(' / ')} (1m, 5m, 15m)`,
      '────────────────────────',
      '💾 *SYSTEM RAM*',
      `› Total RAM     : ${formatBytes(totalMem)}`,
      `› Used RAM      : ${formatBytes(usedMem)} (${memPercent}%)`,
      `› Free RAM      : ${formatBytes(freeMem)}`,
      '────────────────────────',
      '📊 *NODE.JS PROCESS MEMORY*',
      `› RSS           : ${formatBytes(memory.rss)}`,
      `› Heap Used     : ${formatBytes(memory.heapUsed)} / ${formatBytes(memory.heapTotal)} (${heapPercent}%)`,
      `› External      : ${formatBytes(memory.external)}`,
      `› ArrayBuffers  : ${formatBytes(memory.arrayBuffers || 0)}`,
      '────────────────────────',
      '⏱️ *UPTIME & LATENCY*',
      `› Bot Uptime    : ${botUptime}`,
      `› System Uptime : ${osUptime}`,
      `› Latency / Ping: ${pingMs} ms`,
      '────────────────────────',
      '🤖 *BOT ENVIRONMENT*',
      `› Bot Name      : ${theme.botName}`,
      `› Bot Version   : v${ctx.config?.version || '1.0.0'}`,
      `› Node.js       : ${process.version}`,
      `› Process PID   : ${process.pid}`,
      `› Database      : ${db.connected ? `SQLite (v${db.version ?? '1'})` : 'Disconnected'}`,
      `› DB Size       : ${db.sizeBytes ? formatBytes(db.sizeBytes) : '-'}`,
      `› Total Plugins : ${ctx.plugins?.size ?? 0} (${ctx.plugins?.commandCount ?? 0} commands)`
    ]

    await ctx.reply(lines.join('\n'))
  }
}
