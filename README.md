# KURO

Base bot WhatsApp modular modern yang dibangun di atas **[@rexxhayanasi/elaina-baileys](https://github.com/rexxzyid/elaina-baileys)**.

Murni ESM · Sistem Plugin Dinamis · SQLite Bawaan Sejak Awal · Custom Pairing Code · Sistem Owner & Izin Bertingkat · Menu Link-Preview Ukuran Besar · Dukungan LID Penuh · Theme Manager WhatsApp Dinamis.

```text
KURO/
├── src/
│   ├── index.js              Titik masuk utama: boot, shutdown, restart
│   ├── runtime.js            Aksi tingkat proses yang dibagikan ke plugin
│   ├── config/
│   │   ├── defaults.js       Nilai default bawaan (safety net)
│   │   └── index.js          Memuat settings.js, normalisasi, dan validasi
│   ├── connection/
│   │   ├── index.js          ConnectionManager: buka, tutup, dan reconnect
│   │   ├── socket.js         Inisialisasi makeWASocket dengan opsi KURO
│   │   ├── auth.js           State autentikasi (multi-file / sqlite)
│   │   ├── pairing.js        Alur custom pairing code
│   │   └── reconnect.js      Bounded exponential backoff reconnect
│   ├── database/
│   │   ├── index.js          DatabaseManager — satu-satunya pengelola SQLite
│   │   ├── connection.js     Koneksi tunggal dengan mode WAL
│   │   ├── schema.js         Daftar migrasi database berversi
│   │   ├── migrations.js     Runner migrasi otomatis (PRAGMA user_version)
│   │   └── helpers.js        Normalisasi JID, konversi JSON/boolean
│   ├── handler/
│   │   ├── index.js          messages.upsert → dispatch ke plugin
│   │   ├── command.js        Parser perintah + filter izin + isolasi error
│   │   ├── context.js        Objek `ctx` lengkap yang diterima setiap plugin
│   │   └── permissions.js    Pemeriksaan owner, admin, self mode, dan mute
│   ├── plugins/
│   │   ├── registry.js       Pendaftaran nama & trigger plugin
│   │   ├── loader.js         Scan direktori, import dinamis, validasi, reload
│   │   ├── commands.js       Operasi file plugin (add, get, delete)
│   │   └── utils.js          Validasi metadata dan perenderan menu
│   ├── lib/
│   │   ├── serializer.js     Serialisasi WAMessage menjadi objek sederhana
│   │   ├── messages.js       Helper kirim pesan, reply, react, download media
│   │   ├── preview.js        Pembuat kartu link preview besar (thumbnail-link)
│   │   ├── theme.js          Pengelola tema SQLite, validasi SSRF, pembersihan media
│   │   ├── menu-manager.js   Pengelompokan menu dan izin tampilan
│   │   ├── contact.js        Helper vCard kontak WhatsApp
│   │   ├── channel.js        Helper newsletter / channel WhatsApp
│   │   ├── lid.js            Resolusi alamat LID ↔ Nomor Telepon (PN)
│   │   ├── media.js          Buffer media, file sementara, pembersihan berkala
│   │   ├── message-cache.js  Cache pesan keluar untuk penanganan resend
│   │   └── utils.js          Helper utilitas umum
│   └── utils/
│       ├── logger.js         Logger terpusat dengan adapter pino
│       ├── message-logger.js Pencatat pesan masuk & keluar dalam kotak rapi
│       ├── format.js         Pemformatan output teks & angka
│       ├── time.js           Waktu berbasis zona waktu dan kalkulator uptime
│       └── greeting.js       Ucapan salam bahasa Jepang sesuai timezone
├── plugins/                  ← Folder tempat plugin diletakkan (berdasarkan kategori)
│   ├── general/  ping, menu, about
│   ├── tools/    runtime, sysinfo
│   ├── owner/    theme, owner, eval, shell, reload, plugins, addplugin,
│   │             getplugin, delplugin, setprefix, restart, shutdown, channel, self
│   └── group/    kick, mute
├── test/                     Test suite bawaan (node:test)
├── database/                 Folder database SQLite (kuro.sqlite)
├── media/                    Aset media statis (menu.jpg) & folder thumbnails/
├── session/                  Kredensial WhatsApp (ter-ignore di git)
├── tmp/                      Penyimpanan berkas sementara (ter-ignore di git)
├── settings.js               ← Konfigurasi utama bot
├── settings.local.js         (Opsional) Override rahasia/lokal
└── package.json
```

---

## Persyaratan Sistem

| Komponen | Persyaratan |
|---|---|
| **Node.js** | **Versi 20 ke atas** (Direkomendasikan Node.js 22 atau 24) |
| **npm** | Versi 10+ |
| **Sistem Operasi** | Linux, macOS, Windows, Termux |
| **WhatsApp** | 1 akun WhatsApp aktif untuk dihubungkan |
| **Git** | Terpasang di perangkat (diperlukan saat instalasi dependensi) |

> [!NOTE]
> `better-sqlite3` versi `^12` menyediakan *prebuilt binary* resmi, sehingga tidak memerlukan compiler C++ tambahan pada Linux (x64/arm64), macOS, dan Windows. Jika Anda menggunakan sistem operasi berbasis Alpine/musl atau ARMv7, pasang `python3`, `make`, dan `g++` (`apk add --no-cache build-base python3`).

---

## Instalasi & Menjalankan Bot

1. **Clone repositori dan masuk ke direktori proyek:**
   ```bash
   git clone <URL_REPO_ANDA> kuro
   cd kuro
   ```

2. **Pasang dependensi:**
   ```bash
   npm install
   ```

3. **Konfigurasi Bot:**
   Buka dan sesuaikan file `settings.js`:
   ```bash
   nano settings.js
   ```
   *Minimal atur:* nomor `owner`, `pairing.customCode` (8 karakter), dan `pairing.number`.

4. **Jalankan Bot:**
   ```bash
   npm start
   ```

### Memperbarui Library Elaina Baileys

KURO terhubung langsung dengan repositori GitHub master dari library Elaina Baileys untuk mendapatkan fitur dan perbaikan terbaru:

```bash
npm update @rexxhayanasi/elaina-baileys
npm test
npm start
```

---

## Konfigurasi

Semua konfigurasi disimpan dalam file JavaScript murni: **`settings.js`**. Tidak memerlukan file `.env` yang rumit.

```js
// settings.js
export default {
  botName: 'KURO',
  owner: ['628xxxxxxxxxx'],        // Hanya digit angka, format internasional
  ownerName: 'KURO Developer',
  prefix: ['.', '!', '/', '#'],
  mode: 'public',                  // 'public' | 'private' | 'group'
  timezone: 'Asia/Jakarta',

  pairing: {
    enabled: true,
    customCode: 'KURODEV1',        // Wajib tepat 8 karakter alfanumerik
    number: '628xxxxxxxxxx'        // Kosongkan jika ingin input manual di terminal
  },

  theme: {
    name: 'KURO',
    description: 'Modern modular WhatsApp bot',
    thumbnail: './media/menu.jpg'
  },

  auth: { type: 'multi-file', folder: './session' },
  connection: { reconnectDelayMs: 3000, reconnectMaxDelayMs: 60000 },
  database: { type: 'sqlite', path: './database/kuro.sqlite' },
  menu: {
    url: 'https://kurolabss.my.id',
    thumbnail: './media/menu.jpg',
    title: 'Kuro base bot',
    description: 'Modern modular WhatsApp bot',
    thumbnailWidth: 1080,
    thumbnailHeightRatioOverride: 0
  },
  channel: { enabled: false, jid: '', name: '' },
  plugins: { directory: './plugins', extensions: ['.js'], disabledPrefix: '_' },
  limits: { evalOutputLimit: 4000, shellOutputLimit: 4000, shellTimeoutMs: 30000 },
  api: { key: '' }
}
```

### Hierarki Resolusi Konfigurasi

```text
settings.js  →  src/config/defaults.js  →  settings.local.js  →  config akhir
  (utama)         (fallback default)          (opsional rahasia)
```

- **`settings.local.js` (Opsional):** Jika Anda ingin menyimpan nomor telepon pribadi atau API key tanpa khawatir ter-commit ke Git, buat file `settings.local.js`. File ini otomatis di-merge di atas `settings.js` dan sudah diabaikan di `.gitignore`.
- **Validasi Otomatis:** Kesalahan konfigurasi (seperti kode pairing bukan 8 karakter atau format nomor salah) akan dideteksi dan diperingatkan saat boot tanpa merusak sistem.

---

## Sistem Pairing (Menghubungkan Akun)

KURO mendukung **Custom 8-Character Pairing Code** secara bawaan sehingga Anda tidak perlu memindai kode QR.

```text
Bot Dimulai → Cek Folder Sesi → Apakah Sesi Ada?
                                   ├── YA  → Langsung Terhubung
                                   └── TIDAK → Minta Nomor Telepon
                                                → Ajukan Custom Pairing Code (8 Karakter)
                                                → Tampilkan Kode di Terminal
                                                → Masukkan Kode di WhatsApp HP
```

### Cara Menghubungkan:
1. Jalankan bot via `npm start`.
2. Masukkan nomor WhatsApp yang akan digunakan sebagai bot (jika belum diatur di `pairing.number`).
3. Bot akan menampilkan 8 karakter kode (misal: `KURODEV1`).
4. Di WhatsApp ponsel: Buka **Perangkat Tertaut (Linked Devices) > Tautkan dengan nomor telepon**.
5. Masukkan kode tersebut. Bot akan otomatis tersambung dan sesi disimpan di folder `session/`.

> [!TIP]
> Jika ingin menggunakan pemindaian QR di terminal, ubah `pairing.enabled: false` pada `settings.js`.

---

## Database SQLite

KURO menggunakan SQLite murni dengan performa tinggi sejak instalasi awal:
- **Mode WAL (Write-Ahead Logging)**: Pembacaan dan penulisan data berlangsung cepat dan simultan tanpa locking issue.
- **Sistem Migrasi Otomatis**: Skema database diperbarui secara terstruktur menggunakan `PRAGMA user_version`.
- **Tabel Database**: `users`, `chats`, `groups`, `settings`, `theme_config`, `plugins`, `stats`, `lid_mappings`, `command_usage`, `group_metadata_cache`.

Semua plugin mengakses database melalui helper terpusat `ctx.db` (misal: `ctx.db.getUser()`, `ctx.db.setTheme()`, `ctx.db.getGroup()`).

---

## Sistem Plugin

Setiap plugin dibuat sebagai modul JavaScript ESM mandiri:

```js
// plugins/general/ping.js
export default {
  name: 'ping',
  command: ['ping'],
  aliases: ['p', 'speed'],
  category: 'general',
  description: 'Mengecek kecepatan respon bot',

  async execute(ctx) {
    return ctx.reply('Pong! 🏓')
  }
}
```

### Properti Metadata Plugin

| Properti | Tipe | Penjelasan |
|---|---|---|
| `name` | string | Identifier unik plugin. |
| `command` | string \| array | Kata kunci pemanggil perintah (utama muncul di menu). |
| `aliases` | array | Nama alias perintah tambahan. |
| `category` | string | Kategori menu (default mengikuti nama folder). |
| `description` | string | Deskripsi fungsi perintah. |
| `ownerOnly` | boolean | Hanya bisa dieksekusi oleh owner. |
| `adminOnly` | boolean | Hanya untuk admin grup (owner otomatis lolos). |
| `groupOnly` | boolean | Hanya dapat digunakan di dalam grup. |
| `privateOnly` | boolean | Hanya dapat digunakan di chat pribadi. |
| `botAdmin` | boolean | Bot harus berstatus admin di grup. |
| `hidden` | boolean | Sembunyikan dari tampilan daftar `.menu`. |
| `execute` | function | Fungsi utama yang dijalankan: `async (ctx) => {}`. |

### Objek Context (`ctx`) yang Tersedia

Setiap plugin menerima parameter `ctx` yang kaya akan informasi dan fungsi:

```js
// Metadata & Socket
ctx.sock            // Instance socket Elaina Baileys
ctx.m               // Objek pesan yang sudah diserialisasi
ctx.db              // Instance DatabaseManager
ctx.config          // Konfigurasi aktif
ctx.plugins         // Registry plugin

// Informasi Pengirim & Chat
ctx.chat            // JID chat/grup
ctx.sender          // JID pengirim
ctx.senderNumber    // Nomor telepon pengirim (angka murni)
ctx.senderPn        // JID nomor telepon pengirim
ctx.senderLid       // JID LID pengirim
ctx.isOwner         // Status apakah pengirim adalah owner
ctx.isAdmin         // Status apakah pengirim adalah admin grup
ctx.isBotAdmin      // Status apakah bot adalah admin grup
ctx.isGroup         // Boolean pesan berasal dari grup
ctx.isPrivate       // Boolean pesan berasal dari private chat

// Konten Pesan
ctx.text            // Isi teks pesan / caption
ctx.command         // Nama perintah yang dipanggil
ctx.args            // Array argumen setelah command
ctx.argText         // Seluruh teks argumen dalam satu string
ctx.quoted          // Objek pesan yang dibalas (replied message)
ctx.isMedia         // Apakah pesan berupa media (gambar/video/audio/sticker)

// Helper Interaksi
await ctx.reply('Teks balasan')              // Membalas dengan quote
await ctx.send('Teks langsung')              // Mengirim tanpa quote
await ctx.react('👍')                         // Memberikan reaksi emoji
const buffer = await ctx.download()          // Mengunduh media dari pesan / reply
await ctx.sendCard({ text, title, ... })     // Mengirim menu link preview besar
```

---

## Fitur Theme Manager

KURO dilengkapi dengan **Theme Manager** yang memungkinkan owner mengubah identitas bot dan tampilan menu WhatsApp secara dinamis dari chat tanpa restart bot.

### Perintah Theme Manager (Owner Only)

```text
.theme                      Menampilkan panduan Theme Manager dan status saat ini
.theme thumb set <url>      Mengubah thumbnail menu dari URL gambar HTTPS publik
.theme thumb set            Mengubah thumbnail dengan me-reply gambar di WhatsApp
.theme thumb reset          Mengembalikan thumbnail ke default settings.js
.theme desc set <teks>      Mengubah deskripsi preview link menu
.theme desc reset           Mengembalikan deskripsi ke default settings.js
.theme name set <nama>      Mengubah nama bot pada menu
.theme name reset           Mengembalikan nama bot ke default settings.js
.theme reset                Mereset seluruh tema & membersihkan folder thumbnails
```

> [!TIP]
> **Pembersihan Otomatis**: Saat menjalankan `.theme reset` atau `.theme thumb reset`, seluruh file custom thumbnail di dalam folder `media/thumbnails/` akan otomatis dihapus untuk menghemat ruang penyimpanan server VPS Anda.

---

## Daftar Perintah Utama

### 1. Perintah Umum (General)
- `.menu` — Menampilkan menu utama bot dalam format link preview besar.
- `.menu <kategori>` — Menampilkan menu khusus untuk kategori tertentu.
- `.ping` — Mengecek kecepatan respon bot dan waktu respon server.
- `.about` — Informasi seputar versi bot, platform, database, dan engine Baileys.

### 2. Perintah Tools & Sistem
- `.runtime` — Menampilkan uptime bot, penggunaan RAM proses, beban CPU, dan PID.
- `.sysinfo` — Menampilkan spesifikasi lengkap server (Model CPU, OS, RAM total/bebas, RSS Memory, Uptime, Node.js).

### 3. Perintah Grup
- `.kick @user` — Mengeluarkan member dari grup (Admin & Bot Admin).
- `.mute on` / `.mute off` — Mengaktifkan/menonaktifkan mode bisu pada grup tertentu (Owner Only).

### 4. Perintah Owner & Pengembang
- `.self on` / `.self off` — Mengubah mode bot menjadi Self (hanya merespon pesan dari owner) atau Public.
- `.owner` — Mengirim kartu kontak vCard resmi owner bot.
- `.reload <nama|all>` — Mereload plugin tertentu atau memuat ulang semua plugin tanpa restart bot.
- `.plugins` — Menampilkan daftar seluruh plugin yang aktif dan nonaktif.
- `.addplugin <kategori> <nama>` — Menambahkan atau memperbarui plugin langsung melalui chat WhatsApp.
- `.getplugin <nama>` — Mengunduh source code plugin sebagai file `.js`.
- `.delplugin <nama>` — Menghapus plugin dari sistem dan disk.
- `.setprefix <prefix>` — Mengubah prefix bot secara permanen ke database.
- `.restart confirm` — Me-restart proses bot secara mulus.
- `.shutdown confirm` — Mematikan proses bot dengan aman.

### Shortcut Eksekusi Kode (Owner Only):
- `! <kode>` — Menjalankan ekspresi JavaScript sinkron secara instan.
- `!! <kode>` — Menjalankan kode JavaScript asinkron (`await` didukung).
- `$ <perintah>` — Menjalankan perintah terminal/shell (dibatasi oleh `shellAllowlist` untuk keamanan).

---

## Format & Desain Menu

Menu KURO dirancang elegan dan informatif:
1. **Ucapan Salam Berdasarkan Waktu**: Disesuaikan dengan zona waktu di `settings.timezone` (`おはようございます` Pagi, `こんにちは` Siang, `こんばんは` Malam).
2. **Kartu Tautan Lebar (Full-Width Large Card)**: Menggunakan teknologi `thumbnail-link` native WhatsApp sehingga gambar banner tampil penuh di perangkat pengguna.
3. **Filter Izin Otomatis**: Pengguna biasa tidak akan melihat perintah khusus owner, menjaga kerapian dan keamanan bot.

---

## Panduan Deployment (Menjalankan di Server)

### 1. Menggunakan PM2 (Direkomendasikan untuk VPS)
```bash
npm install -g pm2
pm2 start src/index.js --name kuro
pm2 save
pm2 startup
```

### 2. Menggunakan Systemd Service
Buat file `/etc/systemd/system/kuro.service`:
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
RestartSec=10

[Install]
WantedBy=multi-user.target
```
Aktifkan service:
```bash
sudo systemctl daemon-reload
sudo systemctl enable --now kuro
```

### 3. Menggunakan Docker
```dockerfile
FROM node:22-slim
WORKDIR /app
RUN apt-get update && apt-get install -y python3 make g++ git && rm -rf /var/lib/apt/lists/*
COPY package*.json ./
RUN npm ci --omit=dev
COPY . .
VOLUME ["/app/session", "/app/database", "/app/media/thumbnails", "/app/tmp"]
CMD ["node", "src/index.js"]
```

---

## Panduan Pencadangan (Backup)

| Direktori / File | Fungsi |
|---|---|
| `session/` | Kredensial login WhatsApp (Wajib dicadangkan agar tidak perlu pairing ulang). |
| `database/kuro.sqlite` | Seluruh data pengguna, grup, statistik, dan tema. |
| `settings.js` / `settings.local.js` | File konfigurasi bot. |
| `plugins/` | File-file plugin kustom Anda. |

---

## Troubleshooting (Penyelesaian Masalah)

| Masalah | Solusi |
|---|---|
| `Custom pairing code must be exactly 8 chars` | Pastikan `pairing.customCode` di `settings.js` tepat 8 karakter (contoh: `KURODEV1`). |
| Pairing ditolak dengan status `bad-request` | WhatsApp menolak browser kustom yang tidak dikenal. Gunakan `Mac OS`, `Windows`, `Ubuntu`, atau `Baileys` pada `connection.browser`. |
| Pairing ditolak dengan status `rate-overlimit` | Terlalu banyak percobaan pairing dalam waktu singkat. Tunggu 5-10 menit sebelum mencoba kembali. |
| Bot tidak membalas pesan di grup/pribadi | Periksa pengaturan `mode` di `settings.js` atau cek apakah fitur `.self on` / `.mute on` sedang aktif. |
| Perubahan `settings.js` tidak berefek | Konfigurasi dibaca saat bot pertama kali menyala. Lakukan restart bot via terminal atau ketik `.restart confirm`. |
| Error `better-sqlite3` saat instalasi | Gunakan Node.js versi LTS (v20/v22) dan pastikan versi `better-sqlite3` pada `package.json` tetap berada di versi `^12.x`. |

---

## Lisensi

Proyek ini dilisensikan di bawah lisensi **MIT**. Anda bebas mengembangkan, memodifikasi, dan menggunakan base bot KURO untuk kebutuhan pribadi maupun komunitas dengan tetap mematuhi Ketentuan Layanan WhatsApp.
