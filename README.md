# KURO

Base bot WhatsApp modular modern berperforma tinggi yang dibangun di atas **[@rexxhayanasi/elaina-baileys](https://www.npmjs.com/package/@rexxhayanasi/elaina-baileys)**.

Murni ESM · Sistem Plugin Dinamis · SQLite Bawaan (Mode WAL) · Custom 8-Char Pairing Code · Sistem Owner & Izin Bertingkat · Menu Link-Preview Ukuran Penuh (Full-Width Card) · Dukungan Penuh Akun LID & Nomor Telepon · Theme Manager WhatsApp Dinamis.

---

## Struktur Direktori

```text
KURO/
├── src/
│   ├── index.js                  Titik masuk utama: inisialisasi boot, shutdown aman, auto-restart
│   ├── runtime.js                Aksi tingkat proses runtime (status PID, RAM, load, restart)
│   ├── config/
│   │   ├── defaults.js           Nilai default bawaan seluruh konfigurasi bot (safety net)
│   │   └── index.js              Pemuat, normalisasi nomor/path, dan validasi settings.js
│   ├── connection/
│   │   ├── index.js              ConnectionManager: penanganan open, close, reconnect backoff
│   │   ├── socket.js             Inisialisasi makeWASocket dengan opsi Elaina Baileys
│   │   ├── auth.js               Pengelola state autentikasi (multi-file / sqlite)
│   │   ├── pairing.js            Alur permintaan custom pairing code WhatsApp
│   │   └── reconnect.js          Kalkulasi backoff eksponensial dengan jitter
│   ├── database/
│   │   ├── index.js              DatabaseManager — API terpusat untuk operasi SQLite
│   │   ├── connection.js         Koneksi tunggal SQLite dengan mode WAL & foreign keys ON
│   │   ├── schema.js             Daftar migrasi database berversi (001 s/d 005)
│   │   ├── migrations.js         Runner migrasi otomatis berbasis PRAGMA user_version
│   │   └── helpers.js            Normalisasi JID, konversi JSON/boolean/timestamp
│   ├── handler/
│   │   ├── index.js              Dispatcher event messages.upsert ke sistem plugin
│   │   ├── command.js            Parser command, argumen, seleksi prefix, dan isolasi error
│   │   ├── context.js            Pembuat objek `ctx` lengkap untuk setiap eksekusi plugin
│   │   └── permissions.js        Pemeriksaan otorisasi server-side (Owner, Admin, Self, Mute)
│   ├── lib/
│   │   ├── channel.js            Helper interaksi WhatsApp Newsletter / Channel
│   │   ├── contact.js            Helper pembuatan vCard kontak WhatsApp
│   │   ├── lid.js                Resolusi dua arah LID WhatsApp ↔ Nomor Telepon (PN)
│   │   ├── media.js              Pengelola buffer media, berkas sementara, dan pembersihan
│   │   ├── menu-manager.js       Generator menu dinamis berbasis izin dan kategori
│   │   ├── message-cache.js      Cache pesan keluar terikat batas untuk fitur resend
│   │   ├── messages.js           Helper pengiriman pesan, quote reply, react, download media
│   │   ├── preview.js            Pembuat kartu link preview besar (jalur thumbnail-link)
│   │   ├── serializer.js         Serialisasi WAMessage mentah menjadi objek praktis
│   │   ├── theme.js              Pengelola tema SQLite, validasi SSRF URL, & auto-clean media
│   │   └── utils.js              Helper utilitas umum
│   ├── plugins/
│   │   ├── commands.js           Operasi file plugin (tambah, baca, hapus via chat)
│   │   ├── loader.js             Pemindaian folder, import dinamis ESM, & reload plugin
│   │   ├── registry.js           Penyimpanan registri nama plugin dan mapping trigger
│   │   └── utils.js              Validasi metadata plugin dan format daftar menu
│   └── utils/
│       ├── format.js             Pemformatan output teks, waktu, byte, dan angka
│       ├── greeting.js           Salam bahasa Jepang berdasarkan waktu timezone
│       ├── logger.js             Logger terpusat sistem berbasis Pino
│       ├── message-logger.js     Pencatat pesan masuk & keluar dalam kotak berbingkai ANSI
│       └── time.js               Penghitung waktu uptime dan jam zona waktu
├── plugins/                      Folder tempat meletakkan file plugin (per kategori)
│   ├── general/
│   │   ├── about.js              Informasi spesifikasi bot dan environment
│   │   ├── menu.js               Menu utama berformat link preview besar
│   │   └── ping.js               Pemeriksaan kecepatan respon bot
│   ├── group/
│   │   ├── kick.js               Mengeluarkan anggota dari grup
│   │   └── mute.js               Mengatur mode bisu bot di grup (mute on/off)
│   ├── owner/
│   │   ├── addplugin.js          Menambahkan file plugin baru via chat
│   │   ├── channel.js            Mengirim pesan ke saluran newsletter WhatsApp
│   │   ├── delplugin.js          Menghapus plugin dari sistem dan disk
│   │   ├── eval.js               Eksekutor kode JavaScript (sync / async)
│   │   ├── getplugin.js          Mengunduh source code plugin sebagai file .js
│   │   ├── owner.js              Mengirim kartu kontak vCard owner
│   │   ├── plugins.js            Melihat daftar dan status seluruh plugin
│   │   ├── reload.js             Memuat ulang plugin tanpa restart bot
│   │   ├── restart.js            Me-restart proses bot
│   │   ├── self.js               Mengaktifkan/menonaktifkan mode self (owner only)
│   │   ├── setprefix.js          Mengubah prefix bot permanen di database
│   │   ├── shell.js              Eksekutor terminal / shell berizin
│   │   ├── shutdown.js           Mematikan bot secara aman
│   │   └── theme.js              Theme Manager dinamis WhatsApp
│   └── tools/
│       ├── runtime.js            Informasi waktu aktif bot dan status database
│       └── sysinfo.js            Informasi detail server, memori RSS, CPU, & OS
├── scripts/
│   └── generate-menu.js          Script generator banner gambar default menu.jpg
├── database/                     Tempat file SQLite (kuro.sqlite) & .gitkeep
├── media/                        Aset media statis (menu.jpg) & direktori thumbnails/
├── session/                      Kredensial sesi login WhatsApp (ter-ignore di git)
├── tmp/                          Berkas scratch / sementara (ter-ignore di git)
├── .gitignore                    Konfigurasi ignore Git yang sudah terfilter rapi
├── settings.js                   File konfigurasi utama bot
├── settings.local.js             (Opsional) Override kredensial / rahasia lokal
├── package.json                  Manifest proyek & dependensi
└── README.md                     Dokumentasi proyek
```

---

## Persyaratan Sistem (Requirements)

| Komponen | Persyaratan |
|---|---|
| **Node.js** | **Versi 22.0.0 atau lebih baru** (Direkomendasikan Node.js 22 LTS / Node.js 24) |
| **npm** | Versi 10 ke atas |
| **Sistem Operasi** | Linux (Ubuntu, Debian, CentOS, Alpine), macOS, Windows, Android (Termux) |
| **WhatsApp** | 1 nomor WhatsApp aktif untuk dipasangkan sebagai bot |

> [!NOTE]
> Modul `better-sqlite3` versi `^12` telah menyertakan prebuilt binary bawaan untuk arsitektur Linux x64/arm64, macOS, dan Windows x64. Tidak diperlukan instalasi Visual Studio C++ Compiler tambahan.

---

## Instalasi & Menjalankan

1. **Clone repositori:**
   ```bash
   git clone <URL_REPO_ANDA> kuro
   cd kuro
   ```

2. **Pasang dependensi:**
   ```bash
   npm install
   ```

3. **Konfigurasi bot:**
   Buka file `settings.js` dan sesuaikan nomor owner serta opsi bot:
   ```bash
   nano settings.js
   ```

4. **Jalankan bot:**
   ```bash
   npm start
   ```

---

## Konfigurasi (`settings.js`)

Semua konfigurasi bot berpusat pada satu file JavaScript: `settings.js`.

```js
// settings.js
export default {
  // ── Identitas Bot ──────────────────────────────────────────────────────────
  botName: 'KURO',
  version: '1.0.0',
  ownerName: 'kuroo',
  owner: ['62812xxxxxxxx'],        // Nomor owner: format internasional, angka saja
  timezone: 'Asia/Jakarta',
  prefix: ['.', '!', '/', '#'],
  mode: 'public',                  // 'public' (semua orang) | 'private' (owner) | 'group' (hanya grup)
  debug: false,

  // ── Pairing Code ───────────────────────────────────────────────────────────
  pairing: {
    enabled: true,                 // true = Pairing Code 8 karakter, false = QR terminal
    customCode: 'KURODEV1',        // Wajib 8 karakter alfanumerik (atau kosongkan untuk random)
    number: '62812xxxxxxxx'        // Nomor bot (kosongkan jika ingin input interaktif di terminal)
  },

  // ── Sesi & Database ────────────────────────────────────────────────────────
  auth: {
    type: 'multi-file',
    folder: './session'
  },
  database: {
    type: 'sqlite',
    path: './database/kuro.sqlite'
  },

  // ── Koneksi ────────────────────────────────────────────────────────────────
  connection: {
    reconnectDelayMs: 3000,
    reconnectMaxDelayMs: 60000,
    reconnectMaxAttempts: 0,       // 0 = Coba reconnect tanpa batas
    markOnlineOnConnect: false,    // false agar notifikasi WhatsApp tetap masuk ke HP
    syncFullHistory: false,
    browser: ['Mac OS', 'Chrome', '14.4.1']
  },

  // ── Menu (Large Link Preview Card) ─────────────────────────────────────────
  menu: {
    url: 'https://kurolabss.my.id',
    thumbnail: './media/menu.jpg',
    title: 'Kuro base bot',
    description: 'Modern modular WhatsApp bot',
    thumbnailWidth: 1080,
    thumbnailHeightRatioOverride: 0
  },

  // ── Channel WhatsApp ───────────────────────────────────────────────────────
  channel: {
    enabled: false,
    jid: '',                       // Contoh: '123456789@newsletter'
    name: ''
  },

  // ── Direktori Plugin ───────────────────────────────────────────────────────
  plugins: {
    directory: './plugins',
    extensions: ['.js'],
    disabledPrefix: '_',           // Awalan file untuk menonaktifkan (contoh: _menu.js)
    maxSourceBytes: 524288
  },

  // ── Terminal Message Logger ────────────────────────────────────────────────
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

  // ── Keamanan Shell Owner ($ …) ─────────────────────────────────────────────
  shellAllowlist: [
    'node', 'npm', 'npx', 'git',
    'ls', 'dir', 'cat', 'head', 'tail', 'wc',
    'uptime', 'free', 'df', 'du', 'ps', 'whoami', 'uname', 'date', 'env'
  ],

  // ── Batasan Sistem ─────────────────────────────────────────────────────────
  limits: {
    evalOutputLimit: 4000,
    shellOutputLimit: 4000,
    shellTimeoutMs: 30000
  },

  // ── API Pihak Ketiga ───────────────────────────────────────────────────────
  api: {
    key: ''
  }
}
```

### Opsi Rahasia Lokal (`settings.local.js`)
Jika Anda mem-push bot ke repositori publik, buat file `settings.local.js` (otomatis ter-ignore di Git). File ini akan di-merge di atas `settings.js` sehingga API key dan nomor pribadi Anda tetap aman.

---

## Alur Pairing Code

KURO menggunakan alur pairing code 8 karakter tanpa perlu memindai QR code kamera:

1. Jalankan `npm start`.
2. Jika sesi belum ada, bot akan meminta nomor telepon WhatsApp Anda (atau membaca dari `pairing.number`).
3. Bot akan menampilkan 8 karakter kode (misalnya: `KURODEV1`).
4. Buka **WhatsApp di HP > Perangkat Tertaut > Tautkan dengan nomor telepon**.
5. Masukkan kode tersebut. Bot akan otomatis tersambung dan menyimpan kredensial ke folder `session/`.

---

## Database SQLite & Migrasi

KURO menggunakan SQLite murni dengan performa tinggi:
- **Koneksi Tunggal Mode WAL**: Mencegah race condition dan file lock.
- **Migrasi Terkelola (`src/database/schema.js`)**:
  - `001_initial`: Tabel `users`, `chats`, `groups`, `settings`, `plugins`, `stats`, `lid_mappings`, `command_usage`.
  - `002_add_premium`: Dukungan status premium user.
  - `003_add_group_metadata_cache`: Caching subject grup WhatsApp.
  - `004_add_group_settings`: Kolom `is_muted` untuk mute grup.
  - `005_add_theme_config`: Tabel `theme_config` untuk Theme Manager WhatsApp.

Semua query dieksekusi melalui `ctx.db` menggunakan prepared statement.

---

## Theme Manager

Theme Manager memungkinkan owner mengatur identitas dan tampilan link preview menu KURO langsung dari WhatsApp secara permanen tanpa restart:

```text
🎨 KURO THEME MANAGER

› .theme
  Menampilkan panduan Theme Manager dan status tema saat ini.

› .theme thumb set <url>
  Mengatur gambar thumbnail menu menggunakan URL HTTPS publik (dilengkapi proteksi SSRF).

› .theme thumb set
  Mengatur thumbnail menu dengan membalas (reply) gambar WhatsApp.

› .theme thumb reset
  Mengembalikan thumbnail ke default dan mengosongkan folder thumbnails.

› .theme desc set <teks>
  Mengubah deskripsi link preview di bawah thumbnail menu.

› .theme desc reset
  Mengembalikan deskripsi link preview ke default settings.js.

› .theme name set <nama>
  Mengubah nama bot pada menu.

› .theme name reset
  Mengembalikan nama bot ke default settings.js.

› .theme reset
  Mereset seluruh konfigurasi tema ke default settings.js serta membersihkan
  seluruh file di folder media/thumbnails/ agar hemat penyimpanan server.
```

---

## Daftar Perintah Bot

### 1. Perintah Umum (`plugins/general/`)
- `.menu` — Menampilkan menu bot lengkap dengan kartu link preview besar.
- `.menu <kategori>` — Menampilkan menu khusus kategori tertentu (contoh: `.menu owner`).
- `.ping` — Mengecek latensi respon bot ke server WhatsApp.
- `.about` — Menampilkan ringkasan identitas bot, platform, versi Node, dan database.

### 2. Perintah Alat & Sistem (`plugins/tools/`)
- `.runtime` — Menampilkan waktu aktif bot (uptime), penggunaan memori proses, dan status database.
- `.sysinfo` — Menampilkan spesifikasi detail server (Model CPU, OS, RAM total/free, memori RSS, Node.js).

### 3. Perintah Grup (`plugins/group/`)
- `.kick @user` — Mengeluarkan anggota dari grup (memerlukan hak admin grup & bot admin).
- `.mute on` / `.mute off` — Mengaktifkan/menonaktifkan mode senyap bot di grup tertentu (Owner only).

### 4. Perintah Owner & Pengembang (`plugins/owner/`)
- `.theme` — Mengelola tema, nama, deskripsi, dan cover menu bot.
- `.self on` / `.self off` — Mode self (bot hanya merespon perintah dari owner) atau public.
- `.owner` — Mengirim kartu nama vCard owner resmi bot.
- `.plugins` — Menampilkan inventaris plugin yang dimuat dan status error jika ada.
- `.reload <nama|all>` — Memuat ulang file plugin secara instan tanpa restart bot.
- `.addplugin <kategori> <nama>` — Menambahkan plugin baru dengan mengirim/me-reply kode `.js`.
- `.getplugin <nama>` — Mengunduh kode sumber plugin sebagai dokumen `.js`.
- `.delplugin <nama>` — Menghapus plugin dari direktori dan registri.
- `.setprefix <prefix>` — Mengubah prefix bot secara dinamis.
- `.channel post <teks>` — Mengirim postingan ke saluran WhatsApp (Newsletter).
- `.restart confirm` — Memulai ulang proses bot.
- `.shutdown confirm` — Mematikan proses bot dengan aman.

### Shortcut Khusus Owner:
- `! <kode>` — Eksekusi JavaScript sinkron.
- `!! <kode>` atau `> <kode>` atau `=> <kode>` — Eksekusi JavaScript asinkron (`await` didukung).
- `$ <perintah>` — Eksekusi shell/terminal sesuai daftar `shellAllowlist`.

---

## Panduan Pembuatan Plugin

Setiap plugin berupa modul JavaScript ESM dengan default export:

```js
// plugins/tools/contoh.js
export default {
  name: 'contoh',
  command: ['contoh'],
  aliases: ['cth'],
  category: 'tools',
  description: 'Contoh plugin sederhana KURO',
  ownerOnly: false,
  groupOnly: false,

  async execute(ctx) {
    const user = ctx.db.ensureUser({ jid: ctx.sender })
    await ctx.reply(`Halo ${ctx.pushName ?? user.number}! Bot berjalan normal.`)
  }
}
```

### Properti Context (`ctx`) yang Disediakan:
- **Koneksi & Database:** `ctx.sock`, `ctx.db`, `ctx.config`, `ctx.plugins`, `ctx.logger`, `ctx.channel`.
- **Pengirim & Chat:** `ctx.chat`, `ctx.sender`, `ctx.senderNumber`, `ctx.senderPn`, `ctx.senderLid`, `ctx.pushName`.
- **Status Otorisasi:** `ctx.isOwner`, `ctx.isAdmin`, `ctx.isBotAdmin`, `ctx.isGroup`, `ctx.isPrivate`, `ctx.isPremium`, `ctx.isBanned`.
- **Isi Pesan:** `ctx.text`, `ctx.body`, `ctx.command`, `ctx.args`, `ctx.argText`, `ctx.prefix`, `ctx.quoted`, `ctx.isMedia`, `ctx.mimetype`.
- **Aksi Cepat:**
  - `await ctx.reply('balasan quote')`
  - `await ctx.send('pesan tanpa quote')`
  - `await ctx.react('✅')`
  - `const buffer = await ctx.download()` (Unduh gambar/audio/video dari pesan atau reply)
  - `await ctx.sendCard({ text, url, title, description, thumbnail })`
  - `await ctx.sendContact({ name, number })`

---

## Menjalankan Pengujian (Testing)

Proyek ini dilengkapi dengan suite pengujian unit & integrasi bawaan Node.js:

```bash
npm test
```

Pengujian memverifikasi koneksi database, migrasi skema, parser perintah, otorisasi pengguna, parser tema, integrasi link-preview WhatsApp, dan eksekusi plugin.

---

## Panduan Deployment di Server VPS

### Menjalankan dengan PM2 (Rekomendasi)
```bash
npm install -g pm2
pm2 start src/index.js --name kuro
pm2 save
pm2 startup
```

### Menjalankan dengan Systemd
Buat service di `/etc/systemd/system/kuro.service`:
```ini
[Unit]
Description=KURO WhatsApp Bot
After=network.target

[Service]
Type=simple
User=root
WorkingDirectory=/root/kuro
ExecStart=/usr/bin/node src/index.js
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
```

Jalankan service:
```bash
sudo systemctl daemon-reload
sudo systemctl enable --now kuro
```

---

## Lisensi

Proyek ini didistribusikan di bawah lisensi **MIT**. Anda bebas menggunakan, memodifikasi, dan mengembangkan base bot ini untuk keperluan personal maupun publik sesuai dengan Ketentuan Layanan WhatsApp.
