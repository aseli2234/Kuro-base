/**
 * KURO — built-in configuration defaults.
 *
 * Every key that `settings.js` may omit, in the same shape. The merged result
 * is what `src/config/index.js` validates and exports as `config`.
 *
 * Keeping this file separate from `settings.js` means you can delete a line
 * from your settings to fall back to the default instead of guessing what the
 * value should have been.
 */

export const DEFAULT_SETTINGS = {
  botName: 'KURO',
  version: '1.0.0',
  ownerName: 'KURO Developer',
  owner: [],
  timezone: 'Asia/Jakarta',
  prefix: ['.', '!', '/', '#'],
  mode: 'public',
  debug: false,

  pairing: {
    enabled: true,
    customCode: '',
    number: ''
  },

  auth: {
    type: 'multi-file',
    folder: './session'
  },

  connection: {
    reconnectDelayMs: 3000,
    reconnectMaxDelayMs: 60000,
    reconnectMaxAttempts: 0,
    markOnlineOnConnect: false,
    syncFullHistory: false,
    browser: ['Mac OS', 'Chrome', '14.4.1']
  },

  database: {
    type: 'sqlite',
    path: './database/kuro.sqlite'
  },

  menu: {
    url: '',
    thumbnail: '',
    title: '',
    description: '',
    thumbnailWidth: 640,
    thumbnailHeightRatioOverride: 0
  },

  channel: {
    enabled: false,
    jid: '',
    name: ''
  },

  plugins: {
    directory: './plugins',
    extensions: ['.js'],
    disabledPrefix: '_',
    maxSourceBytes: 512 * 1024
  },

  /** Terminal message logger (`src/utils/message-logger.js`). */
  messageLog: {
    enabled: true,
    showContent: true,
    showMediaType: true,
    showGroupName: true,
    showTimestamp: true,
    showSender: true,
    showMessageType: true,
    showOutgoing: true,
    useColors: true,
    multiline: true,
    wrapText: true
  },

  /** Owner shell (`$ …`) — commands are matched as a prefix against argv[0]. */
  shellAllowlist: [
    'node', 'npm', 'npx', 'git',
    'ls', 'dir', 'cat', 'head', 'tail', 'wc',
    'uptime', 'free', 'df', 'du', 'ps', 'whoami', 'uname', 'date', 'env'
  ],

  limits: {
    evalOutputLimit: 4000,
    shellOutputLimit: 4000,
    shellTimeoutMs: 30000
  },

  api: {
    key: ''
  }
}

/** Values accepted by the `mode` setting. */
export const VALID_MODES = ['public', 'private', 'group']

/** Values accepted by the `auth.type` setting. */
export const VALID_AUTH_TYPES = ['multi-file', 'sqlite']

/** Keys of `settings.js` that map to a path relative to the project root. */
export const PATH_KEYS = ['auth.folder', 'database.path', 'plugins.directory', 'menu.thumbnail']

/** The custom pairing code length Elaina Baileys enforces. */
export const PAIRING_CODE_LENGTH = 8

/**
 * `browser[0]` — the label WhatsApp shows under "Linked devices" and the value
 * it stores as the companion's `os`.
 *
 * WhatsApp validates it against the clients it knows. An invented label (say
 * `'KURO'`) still connects and still shows a QR code, but the link-with-phone-
 * number query is then refused with `bad-request`, so pairing becomes
 * impossible. These are the labels the library's own `Browsers` helper emits.
 */
export const KNOWN_CLIENT_LABELS = ['Mac OS', 'Windows', 'Ubuntu', 'Baileys']

/**
 * `browser[1]` — the browser name WhatsApp maps to a companion web-client id
 * (Chrome 1, Edge 2, Firefox 3, IE 4, Opera 5, Safari 6). Anything else is
 * reported as `OTHER_WEB_CLIENT` (9), which is not a pairing client.
 */
export const KNOWN_CLIENT_BROWSERS = ['Chrome', 'Edge', 'Firefox', 'IE', 'Opera', 'Safari', 'Desktop']

export default DEFAULT_SETTINGS
