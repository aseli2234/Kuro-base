/**
 * KURO — output formatting helpers shared by plugins and the handler.
 */

/** `1536` → `1.5 KB` */
export const formatBytes = bytes => {
  const value = Number(bytes) || 0
  if (value < 1024) return `${value} B`
  const units = ['KB', 'MB', 'GB', 'TB']
  let size = value / 1024
  let index = 0
  while (size >= 1024 && index < units.length - 1) {
    size /= 1024
    index += 1
  }
  return `${size.toFixed(size >= 10 ? 1 : 2)} ${units[index]}`
}

/** `1234567` → `1,234,567` */
export const formatNumber = value => Number(value || 0).toLocaleString('en-US')

/** Wrap text in a WhatsApp monospace block. */
export const codeBlock = (text, language = '') => `\`\`\`${language}\n${String(text ?? '')}\n\`\`\``

/** Wrap text in WhatsApp inline monospace. */
export const inlineCode = text => `\`${String(text ?? '')}\``

/** Wrap text in WhatsApp bold. */
export const bold = text => `*${String(text ?? '')}*`

/** Wrap text in WhatsApp italic. */
export const italic = text => `_${String(text ?? '')}_`

/** Cut a string to `max` characters, appending an ellipsis when trimmed. */
export const truncate = (text, max = 200) => {
  const value = String(text ?? '')
  if (value.length <= max) return value
  return `${value.slice(0, Math.max(0, max - 3))}...`
}

/** Turn a string into a stable, filesystem-safe slug. */
export const slugify = value =>
  String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'plugin'

/** `hello world` → `Hello World` */
export const titleCase = value =>
  String(value ?? '')
    .split(/[\s_-]+/)
    .filter(Boolean)
    .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(' ')

/** Pad a label so tables line up in monospace blocks. */
export const padEnd = (value, width) => String(value ?? '').padEnd(width, ' ')

/** Pad a label on the left so values line up. */
export const padStart = (value, width) => String(value ?? '').padStart(width, ' ')

/** `- item` lines joined by newlines. */
export const bullets = (items, marker = '-') =>
  (Array.isArray(items) ? items : []).map(item => `${marker} ${item}`).join('\n')

/** Clamp a string to `max` characters by cutting the middle out. */
export const clampMiddle = (text, max = 4000) => {
  const value = String(text ?? '')
  if (value.length <= max) return value
  const half = Math.floor(max / 2) - 20
  return `${value.slice(0, half)}\n... [${value.length - half * 2} characters omitted] ...\n${value.slice(-half)}`
}

export default {
  formatBytes,
  formatNumber,
  codeBlock,
  inlineCode,
  bold,
  italic,
  truncate,
  slugify,
  titleCase,
  padEnd,
  padStart,
  bullets,
  clampMiddle
}
