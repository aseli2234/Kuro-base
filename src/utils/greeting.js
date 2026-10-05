/**
 * KURO — Japanese greeting, timezone aware.
 *
 * The greeting follows `settings.timezone` — never the server clock:
 *
 *   05:00 – 10:59   おはようございます   (morning)
 *   11:00 – 17:59   こんにちは           (afternoon)
 *   18:00 – 04:59   こんばんは           (evening/night)
 *
 * An unknown timezone degrades to the ISO-UTC fallback inside `clockTime`,
 * so a typo in settings can never crash the bot.
 */

import { clockTime } from './time.js'

export const JAPANESE_GREETINGS = Object.freeze({
  morning: 'おはようございます',
  afternoon: 'こんにちは',
  evening: 'こんばんは'
})

/** Current wall-clock time, `HH:MM:SS`, in the given IANA timezone. */
export const getCurrentTime = (timezone, date = new Date()) => clockTime(timezone, date)

/** Current hour (0–23) in the given timezone. */
export const getCurrentHour = (timezone, date = new Date()) => {
  const value = getCurrentTime(timezone, date)
  const hour = Number.parseInt(value.slice(0, 2), 10)
  return Number.isInteger(hour) && hour >= 0 && hour <= 23 ? hour : 0
}

/** The greeting for the current moment in the given timezone. */
export const getJapaneseGreeting = (timezone, date = new Date()) => {
  const hour = getCurrentHour(timezone, date)
  if (hour >= 5 && hour <= 10) return JAPANESE_GREETINGS.morning
  if (hour >= 11 && hour <= 17) return JAPANESE_GREETINGS.afternoon
  return JAPANESE_GREETINGS.evening
}

export default { getJapaneseGreeting, getCurrentTime, getCurrentHour, JAPANESE_GREETINGS }
