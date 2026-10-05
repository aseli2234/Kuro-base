/**
 * KURO — general helpers.
 */

/** Promise-based sleep. */
export const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))

/** Random URL-safe id. */
export const randomId = (length = 8) =>
  Array.from({ length }, () => Math.floor(Math.random() * 36).toString(36)).join('')

/** Deterministic pick from an array using a seed string. */
export const pick = (items, index = 0) => (Array.isArray(items) && items.length ? items[index % items.length] : undefined)

/** Random pick from an array. */
export const pickRandom = items => (Array.isArray(items) && items.length ? items[Math.floor(Math.random() * items.length)] : undefined)

/** Split an array into chunks of `size`. */
export const chunk = (items, size = 10) => {
  const list = Array.isArray(items) ? items : []
  const output = []
  for (let index = 0; index < list.length; index += size) output.push(list.slice(index, index + size))
  return output
}

/** Is this string an http(s) URL? */
export const isUrl = value => {
  if (typeof value !== 'string') return false
  try {
    const parsed = new URL(value)
    return parsed.protocol === 'http:' || parsed.protocol === 'https:'
  } catch {
    return false
  }
}

/**
 * Retry an async function with linear backoff.
 * Returns the last error when every attempt fails.
 */
export const retry = async (fn, { attempts = 3, delayMs = 500, onError = null } = {}) => {
  let lastError
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await fn(attempt)
    } catch (error) {
      lastError = error
      onError?.(error, attempt)
      if (attempt < attempts) await sleep(delayMs * attempt)
    }
  }
  throw lastError
}

/** Remove duplicate values, preserving order. */
export const unique = items => [...new Set(items)]

/** `JSON.parse` that returns a fallback instead of throwing. */
export const safeJson = (value, fallback = null) => {
  try {
    return JSON.parse(value)
  } catch {
    return fallback
  }
}

/** Is the value a plain object (not an array, not null)? */
export const isPlainObject = value =>
  typeof value === 'object' && value !== null && !Array.isArray(value) && Object.getPrototypeOf(value) !== null

/** Shallow-merge objects, skipping undefined values. */
export const mergeDefined = (...sources) => {
  const output = {}
  for (const source of sources) {
    if (!isPlainObject(source)) continue
    for (const [key, value] of Object.entries(source)) {
      if (value !== undefined) output[key] = value
    }
  }
  return output
}

/** Group an array of objects by a key function. */
export const groupBy = (items, keyFn) => {
  const output = {}
  for (const item of items) {
    const key = keyFn(item)
    if (!output[key]) output[key] = []
    output[key].push(item)
  }
  return output
}

export default {
  sleep,
  randomId,
  pick,
  pickRandom,
  chunk,
  isUrl,
  retry,
  unique,
  safeJson,
  isPlainObject,
  mergeDefined,
  groupBy
}
