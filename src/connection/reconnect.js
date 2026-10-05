/**
 * KURO — reconnect strategy.
 *
 * A bounded exponential backoff with jitter. The point is to survive a flaky
 * uplink without hammering WhatsApp: attempts get further apart, and after
 * `maxAttempts` consecutive failures the manager stops and says so instead of
 * looping forever.
 */

export class ReconnectStrategy {
  /**
   * @param {{ baseDelayMs?: number, maxDelayMs?: number, maxAttempts?: number }} [options]
   *   `maxAttempts: 0` means "retry forever".
   */
  constructor({ baseDelayMs = 3000, maxDelayMs = 60000, maxAttempts = 0 } = {}) {
    this.baseDelayMs = Math.max(250, baseDelayMs)
    this.maxDelayMs = Math.max(this.baseDelayMs, maxDelayMs)
    this.maxAttempts = Math.max(0, maxAttempts)
    this.attempts = 0
    this.scheduled = false
    this.timer = null
  }

  /** Forget previous failures — call this after a successful open. */
  reset() {
    this.attempts = 0
    this.cancel()
    return this
  }

  /** Cancel a queued attempt. */
  cancel() {
    if (this.timer) {
      clearTimeout(this.timer)
      this.timer = null
    }
    this.scheduled = false
    return this
  }

  /** Have we exhausted the configured budget? */
  get exhausted() {
    return this.maxAttempts > 0 && this.attempts >= this.maxAttempts
  }

  /** Delay for the next attempt, in milliseconds, including jitter. */
  nextDelay() {
    const exponential = this.baseDelayMs * 2 ** this.attempts
    const capped = Math.min(exponential, this.maxDelayMs)
    // ±20% jitter keeps a fleet of bots from reconnecting in lockstep.
    const jitter = capped * 0.2 * (Math.random() * 2 - 1)
    return Math.max(250, Math.round(capped + jitter))
  }

  /**
   * Queue one reconnect attempt.
   *
   * @param {(attempt: number) => void} task
   * @param {(delayMs: number, attempt: number) => void} [onSchedule]
   * @returns {boolean} `false` when the budget is exhausted
   */
  schedule(task, onSchedule = null) {
    if (this.exhausted) return false
    this.cancel()
    this.attempts += 1
    const delay = this.nextDelay()
    this.scheduled = true
    onSchedule?.(delay, this.attempts)
    this.timer = setTimeout(() => {
      this.scheduled = false
      this.timer = null
      task(this.attempts)
    }, delay)
    this.timer.unref?.()
    return true
  }
}

export default ReconnectStrategy
