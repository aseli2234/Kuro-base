/**
 * KURO — process runtime.
 *
 * A tiny mutable holder for the process-level actions that plugins such as
 * `.restart` and `.shutdown` need. `src/index.js` binds the actions at boot;
 * plugins import this module instead of reaching back into the entrypoint,
 * which keeps the dependency direction one-way and prevents import cycles.
 */

export const runtime = {
  /** `Date.now()` when the process started. */
  startedAt: Date.now(),

  /** Bound by the entrypoint. */
  shutdown: null,
  restart: null,
  reloadPlugins: null,
  reloadPlugin: null,
  logout: null,

  /** Live references, refreshed on every (re)connect. */
  socket: null,
  database: null,
  registry: null,
  config: null,
  logger: null,
  channel: null,
  manager: null,

  /** Set once the shutdown path has begun so nothing schedules new work. */
  shuttingDown: false
}

/** Merge actions/references into the runtime holder. */
export const bindRuntime = patch => {
  Object.assign(runtime, patch)
  return runtime
}

export default runtime
