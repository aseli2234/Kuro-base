# KURO

A modular WhatsApp bot base built on **[Elaina Baileys](https://github.com/rexxzyid/elaina-baileys)**.

ESM only · dynamic plugin system · SQLite from day one · custom pairing code · owner system · large link-preview menu · LID support.

```text
KURO/
├── src/
│   ├── index.js              entrypoint: boot, shutdown, restart
│   ├── runtime.js            process-level actions shared with plugins
│   ├── config/
│   │   ├── defaults.js       built-in defaults, the safety net
│   │   └── index.js          loads settings.js, normalises, validates
│   ├── connection/
│   │   ├── index.js          ConnectionManager: open/close/reconnect
│   │   ├── socket.js         makeWASocket with KURO's options
│   │   ├── auth.js           session state (multi-file / sqlite)
│   │   ├── pairing.js        custom pairing code flow
│   │   └── reconnect.js      bounded exponential backoff
│   ├── database/
│   │   ├── index.js          DatabaseManager — the only SQLite caller
│   │   ├── connection.js     single WAL connection
│   │   ├── schema.js         versioned migrations
│   │   ├── migrations.js     migration runner (PRAGMA user_version)
│   │   └── helpers.js        JID normalisation, JSON/bool marshalling
│   ├── handler/
│   │   ├── index.js          messages.upsert → plugin dispatch
│   │   ├── command.js        parser + permission gating + error isolation
│   │   ├── context.js        the `ctx` object every plugin receives
│   │   └── permissions.js    owner / admin / ban checks (server-side)
│   ├── plugins/
│   │   ├── registry.js       name → plugin, trigger → plugin
│   │   ├── loader.js         scan, import, validate, reload
│   │   ├── commands.js       add/get/delete plugin files
│   │   └── utils.js          metadata validation, menu rendering
│   ├── lib/
│   │   ├── serializer.js     WAMessage → flat object
│   │   ├── messages.js       send / reply / react / download
│   │   ├── preview.js        large link preview cards
│   │   ├── contact.js        vCard contact helper (owner card)
│   │   ├── channel.js        newsletter / channel helper
│   │   ├── lid.js            LID ↔ PN resolution
│   │   ├── media.js          buffers, temp files, cleanup
│   │   ├── message-cache.js  resend-request cache
│   │   └── utils.js          general helpers
│   └── utils/
│       ├── logger.js         central logger + pino adapter
│       ├── format.js         output formatting
│       ├── time.js           timezone-aware clock, uptime
│       └── greeting.js       Japanese greeting by settings.timezone
├── plugins/                  ← your plugins live here, by category
│   ├── general/  ping, menu, about
│   ├── tools/    runtime
│   ├── owner/    owner, eval, shell, reload, plugins, addplugin,
│   │             getplugin, delplugin, setprefix, restart, shutdown, channel
│   └── group/    kick
├── test/                     node:test suite
├── database/                 kuro.sqlite (gitignored)
├── session/                  WhatsApp credentials (gitignored)
├── tmp/                      scratch space (gitignored)
├── media/                    menu thumbnail
├── settings.js               ← edit this: all configuration lives here
├── settings.local.js         optional, gitignored, merged on top (secrets)
└── package.json
```

---

## Requirements

| | |
|---|---|
| Node.js | **20 or newer** (24 recommended — what KURO is developed against) |
| npm | 10+ |
| OS | Linux, macOS, Windows, Termux |
| WhatsApp | one account to pair |

`git` is needed on the machine running `npm install`, because Elaina Baileys is
installed straight from GitHub (see
[Updating Elaina Baileys](#updating-elaina-baileys)).

`better-sqlite3` is a native module but **`^12` ships prebuilt binaries**, so no
compiler is required on Linux x64/arm64, macOS and Windows x64. KURO pins `^12`
on purpose: `better-sqlite3@13` declares no `install` script, so npm falls back
to `node-gyp rebuild` and fails with `gyp ERR! find VS` / `node-gyp not ok` on
any machine without a full C++ toolchain. `^12` is inside the range Elaina
accepts (`^11 || ^12 || ^13`). On an unusual platform (Alpine/musl, ARMv7) you
still need `python3` + `make` + `g++` — or `apk add --no-cache build-base python3`.

---

## Installation

```bash
git clone <your-fork> kuro
cd kuro
npm install
nano settings.js          # at minimum: owner, pairing.customCode, pairing.number
npm start
```

`npm start` runs `node src/index.js`. `npm ci` works too and is what the Docker
example uses.

### Updating Elaina Baileys

KURO installs the library **from GitHub master**, not from npm:

```json
"@rexxhayanasi/elaina-baileys": "git+https://github.com/rexxzyid/elaina-baileys.git"
```

Why: the repository moves faster than the registry. `1.4.0` is on GitHub master
while npm's `latest` is still `1.3.10`, so
`npm install @rexxhayanasi/elaina-baileys@^1.4.0` fails with
`No matching version found for @rexxhayanasi/elaina-baileys@^1.4.0`.

Pull the newest master whenever you like:

```bash
npm update @rexxhayanasi/elaina-baileys   # re-resolves the branch and moves the lock
npm test
npm start
```

`package-lock.json` pins the exact commit KURO was verified against, so installs
stay reproducible until you update deliberately:

```bash
npm ls @rexxhayanasi/elaina-baileys      # confirm the installed version
```

Notes:

- Everything KURO uses lives in the library's `src/` (ESM, imported directly —
  there is no build step).
- npm records the lock entry as `git+ssh://git@github.com/...` but still fetches
  over HTTPS, so `npm ci` works on machines **without** GitHub SSH keys. A
  `git` binary is still required.
- No git at all (minimal Docker image, air-gapped box)? Use a GitHub tarball
  instead — same code, no git needed, pinned by `integrity` in the lockfile:

  ```json
  "@rexxhayanasi/elaina-baileys": "https://github.com/rexxzyid/elaina-baileys/archive/refs/heads/master.tar.gz"
  ```

  Refresh it by re-running `npm install <that-url>`.
- Want a frozen commit rather than a moving branch?

  ```json
  "@rexxhayanasi/elaina-baileys": "git+https://github.com/rexxzyid/elaina-baileys.git#d8efd4df09b617caad4b5cfb61eb46e85b9ba5e5"
  ```

---

## Configuration

**One file: `settings.js` in the project root.** No `.env`, no environment
variables — you edit plain JavaScript and restart.

```js
// settings.js
export default {
  botName: 'KURO',
  owner: ['628xxxxxxxxxx'],        // digits only, international format
  prefix: ['.', '!', '/', '#'],
  mode: 'public',                  // public | private | group

  pairing: { enabled: true, customCode: 'KURODEV1', number: '' },
  auth: { type: 'multi-file', folder: './session' },
  connection: { reconnectDelayMs: 3000, reconnectMaxDelayMs: 60000 },
  database: { type: 'sqlite', path: './database/kuro.sqlite' },
  menu: { url: '…', thumbnail: './media/menu.jpg', title: '…', description: '…' },
  channel: { enabled: false, jid: '', name: '' },
  plugins: { directory: './plugins', extensions: ['.js'] },
  limits: { evalOutputLimit: 4000, shellOutputLimit: 4000, shellTimeoutMs: 30000 },
  api: { key: '' }
}
```

The file is heavily commented — every key is explained where you need it.

### How it is resolved

```text
settings.js  →  src/config/defaults.js  →  settings.local.js  →  config
   (yours)          (built-in fallback)        (optional secrets)
```

| | |
|---|---|
| **Missing key** | The default from `src/config/defaults.js` applies, so deleting a line is safe |
| **Relative paths** | Resolved against the project root, so `./session` always means `<project>/session` |
| **`settings.local.js`** | Optional, gitignored, merged on top of `settings.js`. Put API keys and real numbers here to keep them out of git. Nothing changes if the file does not exist |
| **Bad values** | Collected and printed at boot — e.g. a 5-character `pairing.customCode` is dropped with a warning instead of failing later |
| **`src/config/index.js`** | Normalises everything (owner numbers to digits, prefixes sorted, paths to absolute) and exports the one object the codebase reads |

Nothing else in the project reads a config file, and nothing reads
`process.env` — the only exceptions are the standard `NO_COLOR` / `FORCE_COLOR`
conventions honoured by the logger. A test (`test/config.test.js`) enforces both
rules, so the configuration cannot quietly drift back to environment variables.

### Settings reference

| Key | Default | Purpose |
|---|---|---|
| `botName` | `KURO` | Display name in menus and the device list |
| `version` | `1.0.0` | Shown by `.about` and `.menu` |
| `ownerName` | `KURO Developer` | Shown by `.owner` and `.about` |
| `owner` | `[]` | Array of phone numbers, **digits only, international format**. The only thing that grants owner rights |
| `timezone` | `Asia/Jakarta` | Timestamps in the console log |
| `prefix` | `['.','!','/','#']` | Command prefixes |
| `mode` | `public` | `public` (everyone), `private` (owners only), `group` (groups only) |
| `debug` | `false` | Print DEBUG lines, including the library's protocol chatter |
| `pairing.enabled` | `true` | `true` = 8-character pairing code, `false` = terminal QR |
| `pairing.customCode` | `''` | Custom pairing code. **Must be exactly 8 characters** |
| `pairing.number` | `''` | Number to link, used when the terminal is not interactive |
| `auth.type` | `multi-file` | `multi-file` or `sqlite` |
| `auth.folder` | `./session` | Credential folder for the multi-file store |
| `connection.reconnectDelayMs` | `3000` | First backoff delay |
| `connection.reconnectMaxDelayMs` | `60000` | Backoff ceiling |
| `connection.reconnectMaxAttempts` | `0` | `0` = retry forever |
| `connection.markOnlineOnConnect` | `false` | Keep phone notifications alive |
| `connection.syncFullHistory` | `false` | Ask WhatsApp for the full history |
| `connection.browser` | `['Mac OS','Chrome','14.4.1']` | `[label, browser, version]` — what Linked devices shows. The label must be `Mac OS`, `Windows`, `Ubuntu` or `Baileys`; anything else is replaced at boot because WhatsApp rejects pairing requests from an unknown client |
| `database.path` | `./database/kuro.sqlite` | SQLite file |
| `menu.url` | — | Link the menu preview card opens |
| `menu.thumbnail` | `./media/menu.jpg` | Cover for the large preview (path or URL) |
| `menu.title` / `menu.description` | — | Preview card text |
| `menu.thumbnailWidth` | `640` | Uploaded cover width |
| `menu.thumbnailHeightRatioOverride` | `0` | `0` = keep the measured aspect ratio. Any positive number switches the menu to the classic manual flow (`extendedTextMessage` → `relayMessage`) and multiplies the measured height (1 = as-is, 1.5 = 1.5× taller) |
| `channel.enabled` | `false` | Enable the channel/newsletter helper |
| `channel.jid` | — | `123456789@newsletter` |
| `channel.name` | — | Display name for the channel |
| `plugins.directory` | `./plugins` | Folder scanned for plugins |
| `plugins.extensions` | `['.js']` | Extensions the loader imports |
| `plugins.disabledPrefix` | `_` | Rename `menu.js` → `_menu.js` to disable it |
| `limits.evalOutputLimit` | `4000` | Truncate `.eval` output |
| `limits.shellOutputLimit` | `4000` | Truncate `.shell` output |
| `limits.shellTimeoutMs` | `30000` | Kill a shell command after this long |
| `messageLog.enabled` | `true` | Print one line per message in/out to the terminal |
| `messageLog.showContent` | `true` | Include a clamped snippet of message text |
| `messageLog.showMediaType` | `true` | Include the type (text/image/video/sticker/…) |
| `messageLog.showGroupName` | `true` | Show the group subject (from cache; JID on a miss) |
| `messageLog.showTimestamp` | `true` | Prefix each line with the `timezone` clock |
| `shellAllowlist` | node, npm, … | First-word allowlist for `$` shell commands |
| `api.key` | `''` | For plugins that call an external service; never printed, redacted by `.eval` |

`.setprefix` writes a runtime override into the `settings` table; it wins over
the `prefix` array on the next start.

---

## Pairing

KURO logs in with a **custom pairing code**, so no QR interaction is needed.

```text
Start → check session → session exists?
                          ├── YES → connect
                          └── NO  → ask for the number
                                       → request the custom pairing code
                                       → print it
                                       → wait for the link to complete
```

`settings.js`:

```js
pairing: {
  enabled: true,
  customCode: 'KURODEV1',        // must be exactly 8 characters
  number: '6281234567890'        // leave '' to be asked in the terminal
}
```

The code the bot prints is the code you type into
**WhatsApp → Linked devices → Link with phone number**.

Rules KURO enforces before it ever calls the library:

| Rule | Why |
|---|---|
| The custom code is **exactly 8 characters** | Elaina throws `Custom pairing code must be exactly 8 chars` otherwise |
| The number is international format, digits only, 6–15 digits, no leading `0` | `081234567890` is a local form; `6281234567890` is the international one |
| Only one request is outstanding | Elaina answers a second request with HTTP 409; KURO cancels and retries once |
| The client label is a real one | WhatsApp answers `bad-request` when the companion identifies itself as an unknown client, so KURO only asks once the QR is offered, and replaces an invented `connection.browser[0]` |

Leave `pairing.customCode` empty (or any length other than 8 — KURO then warns
at boot) to let the library generate a random code. Set `pairing.enabled` to
`false` for the classic terminal QR (needs `qrcode-terminal`, which ships as a
dependency).

### Connection management

`src/connection/index.js` owns the lifecycle:

| Disconnect | Behaviour |
|---|---|
| `restartRequired` (515) | Reconnect immediately, no delay |
| `connectionClosed` / `connectionLost` / `timedOut` | Backoff reconnect |
| `loggedOut` (401), `badSession` (500), `multideviceMismatch` (411), `forbidden` (403) | Stop. The session is gone — delete `session/` and pair again |
| `connectionReplaced` (440) | Stop. Another device took the slot; KURO does not fight over it |

Backoff is exponential with ±20% jitter, capped by `RECONNECT_MAX_DELAY_MS`.
A successful `open` resets the counter. `RECONNECT_MAX_ATTEMPTS` sets a hard
ceiling (0 = unlimited).

---

## SQLite

SQLite **is** the database — there is no JSON store to migrate away from later.
One connection, WAL mode, foreign keys on, a busy timeout, and prepared
statements for every query.

```
check database → exists?  ├── YES → run pending migrations
                          └── NO  → create file, migration 001 builds the schema
```

### Schema

| Table | Columns |
|---|---|
| `users` | `id, jid, number, lid, name, push_name, is_owner, is_banned, is_premium, premium_until, created_at, updated_at` |
| `chats` | `id, jid, type, name, settings(JSON), created_at, updated_at` |
| `groups` | `id, jid, name, settings(JSON), created_at, updated_at` |
| `settings` | `key, value(JSON), updated_at` |
| `plugins` | `id, name, enabled, metadata(JSON), created_at, updated_at` |
| `stats` | `id, key, value, updated_at` |
| `lid_mappings` | `lid, pn, created_at, updated_at` |
| `command_usage` | `id, command, uses, last_used_at` |
| `group_metadata_cache` | `jid, metadata(JSON), updated_at` |

### Migrations

`src/database/schema.js` is an ordered list; each entry runs once, inside a
transaction that also bumps `PRAGMA user_version`. A failure rolls back to the
last good version.

```js
{ version: 2, name: '002_add_premium', description: '…', up: db => db.exec(`…`) }
```

Add a new migration by appending — never edit a shipped one.

### Database manager

Plugins never open a connection. They receive `ctx.db`:

```js
// ✗ wrong — a connection per plugin
const db = new Database('./kuro.sqlite')

// ✓ right
const user = ctx.db.getUser(ctx.sender)
```

| Group | Methods |
|---|---|
| Users | `getUser`, `getUserByNumber`, `getUserByLid`, `createUser`, `updateUser`, `ensureUser`, `listUsers`, `countUsers` |
| Chats | `getChat`, `ensureChat`, `updateChat`, `updateChatSettings`, `listChats` |
| Groups | `getGroup`, `ensureGroup`, `updateGroup`, `updateGroupSettings`, `cacheGroupMetadata`, `getGroupMetadataCache` |
| Settings | `getSetting`, `setSetting`, `deleteSetting`, `allSettings` |
| Plugins | `getPlugin`, `setPlugin`, `setPluginEnabled`, `deletePlugin`, `listPlugins`, `pluginEnabledMap` |
| Stats | `getStat`, `setStat`, `incrementStat`, `allStats`, `incrementCommandUsage`, `getCommandUsage`, `topCommands` |
| LID | `setLidMapping`, `getPnForLid`, `getLidForPn` |
| Housekeeping | `transaction(fn)`, `status()`, `healthCheck()`, `close()` |

Credentials are **not** stored here. Signal keys and Noise keys stay in
`session/` (gitignored) and never enter the database or a log line.

---

## Plugin system

A plugin is an ESM module with a default export:

```js
// plugins/general/ping.js
export default {
  name: 'ping',
  command: ['ping'],
  aliases: ['p'],
  category: 'general',
  description: 'Check that the bot is responding',

  async execute(ctx) {
    return ctx.reply('Pong!')
  }
}
```

### Metadata

| Field | Type | Effect |
|---|---|---|
| `name` | string | Unique registry key; used by `.reload`, `.getplugin`, `.delplugin` |
| `command` | string \| string[] | Triggers. The first one is advertised in `.menu` |
| `aliases` | string \| string[] | Extra triggers |
| `category` | string | Menu group. Defaults to the folder name |
| `description` | string | Shown in `.menu` and `.plugins` |
| `usage` / `example` | string | Shown by `.getplugin` |
| `ownerOnly` | boolean | Owner only |
| `adminOnly` | boolean | Group admin (owners bypass) |
| `groupOnly` | boolean | Groups only |
| `privateOnly` | boolean | Private chats only |
| `botAdmin` | boolean | The bot must be a group admin |
| `hidden` | boolean | Hide from `.menu` |
| `enabled` | boolean | Load disabled |
| `execute` | function | `async (ctx) => …`; required |

Validation runs before registration. A malformed plugin produces one clear log
line and is skipped — it cannot break the boot.

### Loading and reloading

```
scan plugins/**/*.js → dynamic import → validate → register → persist metadata
```

- Files or folders starting with `_` are skipped (disabled).
- Duplicate triggers never overwrite: the first plugin keeps the command, the
  clash is reported by `.plugins` and in the log.
- `.reload <name>` re-imports a single file with a cache-busting URL, so only
  that plugin is refreshed.
- `.reload all` clears the registry and re-scans.

### The context object

```js
ctx.sock      // the Elaina socket
ctx.m         // serialized message
ctx.message   // the raw WAMessage
ctx.db        // database manager
ctx.config    // central config
ctx.plugins   // the registry
ctx.channel   // channel helper
ctx.logger

ctx.chat, ctx.sender, ctx.senderNumber, ctx.senderPn, ctx.senderLid
ctx.text, ctx.body, ctx.command, ctx.args, ctx.argText, ctx.prefix
ctx.quoted, ctx.mentionedJid, ctx.mentions
ctx.type, ctx.mtype, ctx.isMedia, ctx.isViewOnce, ctx.mimetype

ctx.isGroup, ctx.isPrivate, ctx.isOwner, ctx.isAdmin, ctx.isBotAdmin
ctx.isBanned, ctx.isPremium

await ctx.reply('text')                 // quotes the message
await ctx.send('text')                  // no quote
await ctx.sendMessage(jid, 'text')      // anywhere
await ctx.react('✅')
const buffer = await ctx.download()
await ctx.sendCard({ text, url, title, description, thumbnail })
await ctx.sendChannel('posted to the channel')
```

### Managing plugins from chat

```text
.addplugin tools hello      attach or reply to a .js file, or paste the source
.getplugin hello            sends the source back as a .js document
.delplugin hello            unloads it and deletes the file
.reload hello               re-imports just that file
.reload all                 re-scans the whole folder
.plugins                    what is loaded, by category
```

`addplugin` writes to `plugins/<category>/<name>.js`, then loads it through the
normal loader — so validation and error isolation are identical to a plugin
added by hand. Every path is resolved and re-checked inside the plugin
directory; `../../settings.js` can never be written.

---

## Commands

| Command | What it does |
|---|---|
| `.menu` | Every command, grouped by category, sent as a large preview card |
| `.menu owner` | Just one category |
| `.ping` | Latency |
| `.about` | Version, owner, runtime, Node, platform, database, library |
| `.runtime` | Uptime, memory, PID, load, database status, counters |
| `.owner` | Owner contact |
| `.plugins` | Loaded plugins by category |
| `.kick @user` | Remove a group member (group + admin + bot-admin) |

Owner syntaxes work outside the prefix system too — checked longest-token-first,
so `!!` always wins over `!`, and neither collides with the ordinary `!` prefix:

```text
!  1 + 1                     sync eval — result shown directly
!! await db.countUsers()     async eval — top-level `await` allowed
=> 1 + 1                     async expression alias
> await db.countUsers()      async statement alias
$  node -v                   shell, allowlist-gated
```

Eval and shell are owner-only, hard-timeboxed (15 s / `limits.shellTimeoutMs`),
bounded in output, and redact the configured API key plus PEM blocks. Eval
errors (syntax, runtime, promise rejections) are reported to the chat and logged;
they never stop the bot. Shell runs **only** commands whose first word is on
`settings.shellAllowlist` — anything else is refused with a WARN in the log,
and every invocation is audited with timestamp, sender, command and exit status.
Secret-bearing output (the API key, PEM blocks, `creds.json`, `AUTH=`/
`TOKEN=`-style assignments) is redacted before it reaches the chat.

## Owner commands

| Command | Notes |
|---|---|
| `.owner` | Who runs the bot (public), sends the vCard |
| `!` / `!!` / `=>` / `>` | Owner eval (sync / async) |
| `$ <command>` | Owner shell, allowlist-gated |
| `.eval` | JavaScript in the bot process. `>`, `=>` also route here |
| `.shell` | Shell command. `$sh` also routes here |
| `.reload <name\|all>` | Refresh plugins without restarting |
| `.plugins` | Inventory, conflicts, failures |
| `.addplugin` / `.getplugin` / `.delplugin` | Plugin lifecycle |
| `.setprefix` | Change prefixes, persisted |
| `.channel post <text>` | Post to the configured channel |
| `.restart confirm` | Restart the process |
| `.shutdown confirm` | Graceful shutdown |

### eval scope

`sock`, `ctx`, `m`, `msg`, `config`, `db`, `plugins`, `registry`, `logger`,
`channel`, `runtime`, `print`, plus safe primitives (`process`, `Buffer`,
`URL`, `Map`, `Set`, …). `require()` is deliberately absent because KURO is
ESM — use `await import('node:module')`. Results time out after 15s, and the
configured API key plus any PEM block are redacted from the output.

### Safety

- Permission checks run **before** `execute()` and are computed from the JIDs
  WhatsApp delivered plus configuration — never from message text.
- A LID is resolved through the mapping store; if no mapping is known the
  answer is "not the owner". A LID is never turned into a phone number by
  string arithmetic.
- A plugin that throws is caught, logged, reacted to with ❌, reported to the
  owners, and counted in `plugin_errors`. The bot keeps running.

---

## Menu, link preview and channel

### Large link preview

Elaina Baileys draws big cards natively. KURO uses the modern, non-ad path:

```js
await sock.sendMessage(jid, {
  richLink: {
    text: menuText,
    url: 'https://example.com',
    title: 'KURO WhatsApp Bot',
    description: 'Modern modular WhatsApp bot',
    image: { url: './media/menu.jpg' }
  }
})
```

`image` is uploaded as a `thumbnail-link` blob, and WhatsApp downloads the full
cover on the recipient's device — that is what makes it large. The library
measures the encoded bytes and sends `thumbnailWidth` / `thumbnailHeight`; if
either is missing, the client silently falls back to a small card, which is why
an image library matters.

### How the menu is sent

`plugins/general/menu.js` follows the original KURO reference flow:

1. `MenuManager` (src/lib/menu-manager.js) builds `categoryArray`, a
   `categoryMap` of `category → commandArray` (commands only, no descriptions)
   and the styled `allMenuText` blocks from the live registry — filtered by the
   sender's permissions, so owner commands never leak to guests.
2. The header greets in Japanese by `settings.timezone` and shows SYSTEM INFO
   (bot name, owner, version, uptime, prefixes) — all from settings.js.
3. One random category/command is picked via `getOneRandomElemenFrom()` — safe
   on empty registries (`null`, never a crash) — and `buatKataKata()` renders
   the example line, honouring a plugin's `bypassPrefix` flag.
4. With `menu.url` + a cover, the menu is delivered through `ctx.sendCard()` →
   `sendPreviewCard()`: the cover is uploaded as a `thumbnail-link` blob
   (`prepareWAMessageMedia` with `mediaTypeOverride: 'thumbnail-link'`) and the
   uploaded fields (`thumbnailDirectPath`, `mediaKey`, `fileSha256`, …) are
   copied onto a manually built `extendedTextMessage` relayed through
   `sock.relayMessage()` — the **large full-width card**, with the URL LEADING
   the body (`url + '\n' + text`) so the client folds it into the card and the
   text below stays clean. Delivery degrades thumbnail-link →
   `externalAdReply` → manual `extendedTextMessage` → `richLink` → plain text,
   so the menu always arrives.

Every step is try/caught: a failed relay logs the cause and the menu still
arrives as text. The default cover is generated by `npm run generate:menu`
into `media/menu.jpg`.

`src/lib/preview.js` picks the best available option:

1. `thumbnail-link` upload — the **large** full-width card: the cover is uploaded via `prepareWAMessageMedia(…, { mediaTypeOverride: 'thumbnail-link' })` and the returned `imageMessage` fields are copied onto a manual `extendedTextMessage` (`thumbnailDirectPath`, `mediaKey`, `mediaKeyTimestamp`, `thumbnailSha256`, `thumbnailEncSha256`, `thumbnailWidth`/`thumbnailHeight`, `previewType: NONE`), relayed through `sock.relayMessage()`; the URL leads the body so it never shows as a trailing link line. Same mechanism as Angelina Bot's `createThumbnailLink`
2. `externalAdReply` — large card from an inline JPEG cover in `contextInfo` (`renderLargerThumbnail`); fallback when the socket cannot upload
3. **manual `extendedTextMessage`** — used when `menu.thumbnailHeightRatioOverride > 0` (explicit opt-in to the classic flow) or when both paths above are unavailable: the cover is measured locally, attached as `jpegThumbnail` with `thumbnailWidth` / `thumbnailHeight`, and relayed via `generateWAMessageFromContent()` + `sock.relayMessage()` — quoting is written by the generator, not the relay options. The URL leads the body here too
4. `richLink` — only when the body already contains the URL; fills `thumbnailDirectPath`, `mediaKey`, `thumbnailSha256`, `thumbnailWidth`/`thumbnailHeight` via the library's own upload
5. plain text with the URL appended, letting WhatsApp build its own preview

### Menu format

The menu greets in Japanese by `settings.timezone` and lists **commands only**
— descriptions stay in the metadata for `.getplugin`, never in the menu:

```text
⛩️ *こんにちは*
Hai, *Rey*-san! Berikut daftar seluruh perintah bot.

┌─── ❖ *SYSTEM INFO*
│ 🤖 *Bot Name:* KURO
│ 👑 *Owner:* KURO Developer
│ 🏷️ *Version:* 1.0.0
│ ⏱️ *Uptime:* 1h 2m 3s
│ 📌 *Prefix:* [ . ! / # ]
└───────────────┈

┌─── ❖ *GENERAL*
│ • menu
│ • ping
│ • about
└───────────────┈
```

Greeting bands (in the configured timezone, never the server clock):
05:00–10:59 `おはようございます` · 11:00–17:59 `こんにちは` · 18:00–04:59 `こんばんは`.
A category whose commands are all restricted for the sender is skipped entirely.

### Owner contact

`.owner` reads `ownerName` and the `owner` array from settings.js, replies with
`👑 *Owner:* <name>` and then sends one **vCard contact per owner number**
(`contactMessage` via `sock.sendMessage(jid, { contacts: … })`), built by
`src/lib/contact.js` — nothing is hardcoded in the plugin. Plugins can reuse it:

```js
await ctx.sendContact({ name: ctx.config.ownerName, number: ctx.config.owner[0] })
```

### Channel / newsletter

```js
channel: {
  enabled: true,
  jid: '1234567890123456789@newsletter',
  name: 'KURO Updates'
}
```

```js
await ctx.sendChannel('KURO v1.0.0 is live')
await ctx.channel.react(serverId, '🔥')
await ctx.channel.info()
```

Posting reuses the ordinary send path — Elaina routes a `@newsletter` JID to
the newsletter stanza form internally, so no separate API is needed. Metadata,
reactions and follow/unfollow use the dedicated `sock.newsletter*` methods.

`channel.jid` must end with `@newsletter`. If it does not, KURO warns at boot and
keeps the channel helper disabled rather than failing later.

---

## LID support

Modern WhatsApp can address a user by LID (`123456789012345@lid`) instead of a
phone-number JID. KURO keeps both forms:

- `m.sender` — the address WhatsApp actually used
- `m.senderPn` — the phone-number form, when available
- `m.senderLid` — the LID form, when available
- `m.senderNumber` — digits **from the PN**, never from the LID

Resolution goes through the library's mapping store, which is also persisted so
owner checks survive a restart:

```js
import { resolvePN, resolveLID, resolveNumber } from './src/lib/lid.js'

await resolvePN(sock, '555@lid')          // '628555@s.whatsapp.net' or null
await resolveLID(sock, '628555@…')        // '555@lid' or null
await resolveNumber(sock, '555@lid')      // '628555' or null
```

`null` means "no mapping is known". KURO never guesses.

---

## Development

```bash
npm install
npm run check      # node --check on the entrypoint
npm test           # node:test suite (153 tests)
npm run generate:menu   # regenerate media/menu.jpg
npm start
```

The suite covers migrations and CRUD, the command parser, the serializer
(including LID/PN addressing and view-once unwrapping), owner resolution
(including the unmapped-LID rejection), permission flags, plugin loading and
reloading, the preview builders, eval/shell/setprefix, and an end-to-end pass
through `handleMessage` with a fake socket.

### Writing a plugin

```bash
mkdir -p plugins/tools
```

```js
// plugins/tools/hello.js
export default {
  name: 'hello',
  command: ['hello'],
  category: 'tools',
  description: 'Say hello',

  async execute(ctx) {
    const user = ctx.db.ensureUser({ jid: ctx.sender })
    await ctx.reply(`Hello ${ctx.pushName ?? user.number}!`)
  }
}
```

Then `.reload all`, or restart. It appears in `.menu` automatically.

### Adding a migration

Append to `src/database/schema.js` with the next `version`, then start the bot;
the runner applies it inside a transaction.

---

## Deployment

### Bare VPS

```bash
# Node 22+ from NodeSource, then:
git clone <repo> kuro && cd kuro
npm ci --omit=dev
nano settings.js && nano settings.local.js
nohup npm start > kuro.log 2>&1 &
```

`settings.local.js` is optional — see [Configuration](#configuration).

### systemd

```ini
[Unit]
Description=KURO WhatsApp Bot
After=network-online.target

[Service]
Type=simple
User=kuro
WorkingDirectory=/opt/kuro
ExecStart=/usr/bin/node src/index.js
Restart=always
RestartSec=10

[Install]
WantedBy=multi-user.target
```

`Restart=always` makes `.restart` seamless even though KURO also respawns
itself.

### pm2

```bash
pm2 start src/index.js --name kuro
pm2 save && pm2 startup
```

### Docker

```dockerfile
FROM node:24-slim
WORKDIR /app
RUN apt-get update && apt-get install -y python3 make g++ && rm -rf /var/lib/apt/lists/*
COPY package*.json ./
RUN npm ci --omit=dev
COPY . .
VOLUME ["/app/session", "/app/database", "/app/tmp"]
CMD ["node", "src/index.js"]
```

Mount `session/` and `database/` as volumes, otherwise every redeploy needs a
fresh pairing.

### What to back up

| Path | Why |
|---|---|
| `session/` | Losing it means pairing again |
| `database/kuro.sqlite` (+ `-wal`, `-shm`) | Users, groups, settings, stats |
| `settings.js` + `settings.local.js` | Configuration |
| `plugins/` | Hand-written plugins |

---

## Troubleshooting

| Symptom | Fix |
|---|---|
| `Custom pairing code must be exactly 8 chars` | `pairing.customCode` must be exactly 8 characters, e.g. `KURODEV1` |
| Pairing rejected with `bad-request` | `connection.browser[0]` is a client WhatsApp does not know. Use `Mac OS`, `Windows`, `Ubuntu` or `Baileys` — KURO now repairs this at boot with a warning |
| Pairing rejected with `rate-overlimit` | Too many attempts. KURO waits 5 minutes and retries by itself; restarting sooner does not help |
| Pairing rejected with a not-allowed variant | Link-with-phone-number is disabled for that account; set `pairing.enabled: false` and use the QR |
| Pairing rejected with 409 | A request is still pending; KURO cancels and retries once automatically |
| Pairing number rejected | International format only: no `+`, no leading `0`, 6–15 digits |
| `No pairing number available` | Set `pairing.number` in settings.js, or run KURO in an interactive terminal |
| QR never appears | `qrcode-terminal` must be installed (`npm install`) |
| Reconnects forever | Check the log line's status code. `401`/`500` mean the session is dead — delete `session/` and pair again |
| Bot answers nothing | Check `mode`. In `private` only owners get a reply. Also check the prefix, and that the sender is not banned |
| Everything warns about settings at boot | Read those lines — they name the exact key. They are printed once, from `settings.js` |
| An edit to settings.js had no effect | Settings are read once at boot. Restart KURO |
| `.menu` arrives with a small card | Install an image library (`jimp` is included) and make sure `menu.thumbnail` exists |
| `.menu` arrives as plain text | `menu.url` is probably empty |
| A command does nothing | `.plugins` shows what is loaded and why a file failed |
| A plugin vanished after a reload | `.plugins` lists trigger conflicts: the first plugin to claim a trigger keeps it |
| `better-sqlite3` fails to build (`gyp ERR! find VS`) | You are on `better-sqlite3@13`, which npm tries to compile from source. Stay on `^12` (KURO's default), or install a C++ toolchain |
| `getMessage` warnings / "waiting for this message" | KURO keeps a bounded outbound cache; a very busy bot may need a bigger one in `src/lib/message-cache.js` |
| Owner commands rejected on an LID account | The LID has no known PN mapping yet. Message the bot once from the owner number so the mapping is learned, or check `.runtime` |

Set `debug: true` in `settings.js` to see protocol-level and plugin-level debug
output.

---

## Elaina Baileys API notes

Everything KURO calls was verified against the library source in
`node_modules/@rexxhayanasi/elaina-baileys` — currently **`1.4.0`**, installed
from GitHub master (`src/`) — not from memory. The same APIs were re-checked
against the npm release `1.3.10` (`lib/`), so KURO works with either:

| Concern | API actually used |
|---|---|
| Socket | `makeWASocket({ auth, logger, browser, getMessage, generateHighQualityLinkPreview, … })` |
| Session | `useMultiFileAuthState(folder)` → `{ state, saveCreds }` (also available: single-file, SQLite, Postgres, MySQL, Mongo, Redis, NekoDB) |
| Pairing | `sock.requestPairingCode(phoneNumber, customPairingCode)` — custom code **exactly 8 characters**; `sock.cancelPairingCode()` clears a pending request |
| Events | `sock.ev.on('creds.update', saveCreds)`, `sock.ev.on('connection.update', …)`, `sock.ev.on('messages.upsert', …)` |
| Sending | `sock.sendMessage(jid, content, { quoted, mentions })`, `{ edit: key }` to edit, `{ react: { text, key } }` to react, `readMessages` |
| Large preview | `{ richLink: { url, text, title, description, image, large, thumbnailWidth } }` |
| Ad card | `{ text, externalAdReply: { title, body, url, thumbnail: Buffer, largeThumbnail: true } }` |
| Channel | `sock.sendMessage('<id>@newsletter', content)`, `sock.newsletterMetadata`, `sock.newsletterReactMessage`, `sock.newsletterFollow` |
| LID | `sock.signalRepository.lidMapping.getLIDForPN(pn)` / `getPNForLID(lid)` |
| Media | `downloadMediaMessage(message, 'buffer', opts, ctx)`, `getContentType`, `normalizeMessageContent` |
| Helpers | `jidNormalizedUser`, `jidDecode`, `isJidGroup`, `isJidNewsletter`, `isLidUser`, `isPnUser`, `isJidStatusBroadcast`, `DisconnectReason`, `fetchLatestBaileysVersion` |
| Disconnects | `DisconnectReason.{loggedOut:401, badSession:500, restartRequired:515, connectionReplaced:440, …}` |
| Contact | `sock.sendMessage(jid, { contacts: { displayName, contacts: [{ displayName, vcard }] } })` — 1 contact → `contactMessage`, several → `contactsArrayMessage` |
| Manual preview | `generateWAMessageFromContent(jid, { extendedTextMessage }, { quoted, userJid })` + `sock.relayMessage(jid, message, { messageId })`; proto fields `matchedText`, `jpegThumbnail`, `thumbnailWidth`, `thumbnailHeight` |

Where the README and the source disagreed, the source won — for example
`printQRInTerminal` is deprecated and does nothing, so KURO renders QR codes
itself from the `connection.update` payload.

---

## License

MIT. KURO is a bot *base*; link it to your own WhatsApp account and follow
WhatsApp's Terms of Service.
