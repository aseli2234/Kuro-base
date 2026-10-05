/**
 * KURO — time helpers.
 *
 * All formatting is timezone aware so that a bot deployed in UTC still prints
 * timestamps in the configured local timezone.
 */

const formatterCache = new Map()

const getFormatter = timezone => {
  if (!formatterCache.has(timezone)) {
    formatterCache.set(
      timezone,
      new Intl.DateTimeFormat('en-GB', {
        timeZone: timezone,
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false
      })
    )
  }
  return formatterCache.get(timezone)
}

const dateFormatterCache = new Map()

const getDateFormatter = timezone => {
  if (!dateFormatterCache.has(timezone)) {
    dateFormatterCache.set(
      timezone,
      new Intl.DateTimeFormat('en-GB', {
        timeZone: timezone,
        day: '2-digit',
        month: 'short',
        year: 'numeric'
      })
    )
  }
  return dateFormatterCache.get(timezone)
}

/** `HH:MM:SS` in the given timezone. */
export const clockTime = (timezone, date = new Date()) => {
  try {
    return getFormatter(timezone).format(date)
  } catch {
    return date.toISOString().slice(11, 19)
  }
}

/** `01 Jan 2026` in the given timezone. */
export const clockDate = (timezone, date = new Date()) => {
  try {
    return getDateFormatter(timezone).format(date)
  } catch {
    return date.toISOString().slice(0, 10)
  }
}

/** Full `DD Mon YYYY HH:MM:SS` stamp in the given timezone. */
export const stamp = (timezone, date = new Date()) => `${clockDate(timezone, date)} ${clockTime(timezone, date)}`

/**
 * Human readable uptime.
 *
 * @param {number} milliseconds
 * @returns {string} e.g. `2d 4h 12m 3s`
 */
export const formatUptime = milliseconds => {
  const totalSeconds = Math.max(0, Math.floor(Number(milliseconds) / 1000))
  const days = Math.floor(totalSeconds / 86400)
  const hours = Math.floor((totalSeconds % 86400) / 3600)
  const minutes = Math.floor((totalSeconds % 3600) / 60)
  const seconds = totalSeconds % 60

  const chunks = []
  if (days) chunks.push(`${days}d`)
  if (hours) chunks.push(`${hours}h`)
  if (minutes) chunks.push(`${minutes}m`)
  chunks.push(`${seconds}s`)
  return chunks.join(' ')
}

/** `Date.now() - startedAt` as a friendly string. */
export const uptimeSince = startedAt => formatUptime(Date.now() - startedAt)

export default {
  clockTime,
  clockDate,
  stamp,
  formatUptime,
  uptimeSince
}
