/**
 * KURO — settings. The only file you need to edit; no .env, no env vars.
 *
 * Semua key di sini punya default di `src/config/defaults.js` — hapus satu baris
 * dan default-nya dipakai lagi. Path relatif dihitung dari root proyek, dan kamu
 * bisa taruh rahasia di `settings.local.js` (gitignored, di-merge di atas file
 * ini). Nilai dibaca sekali saat boot: restart KURO setelah mengubah apa pun.
 */

export default {
  // ── Identitas ────────────────────────────────────────────────────────────
  botName: 'KURO',
  version: '1.0.0',
  ownerName: 'kuroo',

  /** Nomor owner: format internasional, angka saja. Ini satu-satunya yang
   *  memberi akses owner. */
  owner: ['6281210061590'],

  timezone: 'Asia/Jakarta',
  prefix: ['.', '!', '/', '#'],

  /** 'public' (semua) | 'private' (owner) | 'group' (hanya di grup). */
  mode: 'public',

  /** Cetak baris DEBUG, termasuk obrolan protokol library. */
  debug: false,

  // ── Pairing ──────────────────────────────────────────────────────────────
  pairing: {
    /** true = kode pairing 8 karakter, false = QR di terminal. */
    enabled: true,

    /** Harus tepat 8 karakter, atau dikosongkan untuk kode acak. */
    customCode: 'KURODEV1',

    /** Nomor yang ditautkan. Kosongkan agar ditanya di terminal. */
    number: ''
  },

  // ── Sesi ─────────────────────────────────────────────────────────────────
  auth: {
    /** 'multi-file' (folder) atau 'sqlite' (satu file). */
    type: 'multi-file',
    folder: './session'
  },

  // ── Koneksi ──────────────────────────────────────────────────────────────
  connection: {
    reconnectDelayMs: 3000,
    reconnectMaxDelayMs: 60000,
    /** 0 = coba terus tanpa batas. */
    reconnectMaxAttempts: 0,

    /** false supaya notifikasi WhatsApp tetap masuk ke HP-mu. */
    markOnlineOnConnect: false,

    /** true = minta seluruh riwayat (boot pertama lebih lambat). */
    syncFullHistory: false,

    /** [label, browser, versi] — tampil di WhatsApp → Perangkat tertaut.
     *  Label harus salah satu dari: 'Mac OS', 'Windows', 'Ubuntu', 'Baileys'.
     *  Label lain bikin WhatsApp menolak kode pairing (bad-request). */
    browser: ['Mac OS', 'Chrome', '14.4.1']
  },

  // ── Database ─────────────────────────────────────────────────────────────
  database: {
    type: 'sqlite',
    path: './database/kuro.sqlite'
  },

  // ── Menu (kartu link preview besar) ──────────────────────────────────────
  menu: {
    url: 'https://kurolabss.my.id',
    /** Path lokal atau URL. */
    thumbnail: './media/menu.jpg',
    title: 'Kuro base bot',
    description: 'Modern modular WhatsApp bot',
    thumbnailWidth: 1080,

    /** 0 = tinggi thumbnail mengikuti rasio gambar. Angka lain mengalikan
     *  tinggi terukur (1 = apa adanya, 1.5 = 1.5x lebih tinggi). Dipakai di
     *  jalur preview manual (extendedTextMessage → relayMessage). */
    thumbnailHeightRatioOverride: 0
  },

  // ── Channel / newsletter ─────────────────────────────────────────────────
  channel: {
    enabled: false,
    /** Selalu berakhiran '@newsletter'. */
    jid: '',
    name: ''
  },

  // ── Plugin ───────────────────────────────────────────────────────────────
  plugins: {
    directory: './plugins',
    extensions: ['.js'],
    /** Awalan untuk menonaktifkan: `menu.js` → `_menu.js`. */
    disabledPrefix: '_',
    maxSourceBytes: 524288
  },

  // ── Logger pesan di terminal ────────────────────────────────────────────
  messageLog: {
    /** Cetak setiap pesan masuk/keluar ke terminal. */
    enabled: true,
    /** Sertakan isi pesan teks. */
    showContent: true,
    /** Sertakan tipe pesan (text/image/video/…). */
    showMediaType: true,
    /** Cari dan tampilkan nama grup untuk chat grup. */
    showGroupName: true,
    /** Sertakan baris timestamp sesuai `timezone`. */
    showTimestamp: true,
    /** Sertakan baris nama & nomor pengirim. */
    showSender: true,
    /** Sertakan klasifikasi konten (TEXT/IMAGE/…). */
    showMessageType: true,
    /** Cetak juga pesan keluar dari bot. */
    showOutgoing: true,
    /** Gunakan warna ANSI (otomatis mati di terminal tanpa warna). */
    useColors: true,
    /** Pertahankan struktur baris baru pada isi pesan. */
    multiline: true,
    /** Lipat teks panjang ke lebar terminal. */
    wrapText: true
  },

  // ── Shell owner ($ …) — allowlist perintah administratif ───────────────
  /** Perintah diizinkan bila argv[0] salah satu dari daftar ini. */
  shellAllowlist: [
    'node', 'npm', 'npx', 'git',
    'ls', 'dir', 'cat', 'head', 'tail', 'wc',
    'uptime', 'free', 'df', 'du', 'ps', 'whoami', 'uname', 'date', 'env'
  ],

  // ── Batas ────────────────────────────────────────────────────────────────
  limits: {
    evalOutputLimit: 4000,
    shellOutputLimit: 4000,
    shellTimeoutMs: 30000
  },

  // ── API pihak ketiga ─────────────────────────────────────────────────────
  api: {
    /** Dipakai plugin yang memanggil layanan luar. Tidak pernah dicetak. */
    key: ''
  }
}
