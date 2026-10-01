# Dokumentasi Sistem CartaNVR (Super Simpel NVR)

Dokumen ini memberikan penjelasan mendalam tentang arsitektur, fungsionalitas, konfigurasi, dan panduan pengoperasian aplikasi CartaNVR.

---

## 1. Gambaran Umum

**CartaNVR** adalah Network Video Recorder (NVR) mandiri yang tangguh, efisien, dan fleksibel, dibangun menggunakan ekosistem Node.js:
- **Penemuan Kamera Otomatis**: Mendukung pemindaian IP otomatis via protokol ONVIF serta penambahan stream RTSP manual.
- **Streaming Multi-Protokol (Ultra-Low Latency)**: Mendukung WebRTC dan RTSP via go2rtc proxy terintegrasi, serta JSMpeg via WebSocket relay.
- **Perekaman Berkelanjutan & Handal**: Perekaman otomatis stream CCTV ke berkas MP4 terfragmentasi dengan proses *faststart remux* otomatis agar dapat diputar langsung di web.
- **Manajemen Penyimpanan Otomatis**: Pemantauan kapasitas hard disk secara berkala, penghapusan rekaman tertua otomatis saat kuota tercapai, dan rekonsiliasi data berkas fisik dengan database.
- **Fleksibilitas Database**: Mendukung SQLite (tanpa konfigurasi tambahan) dan MySQL / MariaDB (untuk performa tinggi dan multi-server) lengkap dengan wizard instalasi interaktif.
- **Dukungan Federasi & Penemuan Jaringan**: Mendukung pengumuman mDNS/Bonjour otomatis di jaringan lokal dan sinkronisasi lintas simpul (remote nodes).
- **Proses Supervisor Terintegrasi (PM2)**: Dikelola secara aman dengan PM2 melalui `ecosystem.config.js` dan skrip pembantu `start.js` yang dilengkapi pembersihan port *zombie* otomatis dan *graceful shutdown*.

---

## 2. Arsitektur Sistem

Sistem ini terdiri dari beberapa lapisan komponen yang saling terhubung:

```mermaid
graph TD
    Client[Browser / Klien Web] -->|HTTP / HTTPS: Port 3000| Express[Express Web Server & API]
    Client -->|WebSocket / WebRTC: Port 1985/8556| Go2RTC[go2rtc Streaming Proxy]
    Client -->|WebSocket JSMpeg: Port 3000 / 9999| StreamRelay[JSMpeg Stream Relay]
    
    subgraph Core Server [Node.js Runtime]
        Express --> Auth[Passport Auth & Session]
        Express --> APIRoutes[REST API Routes]
        Express --> Discovery[mDNS Bonjour Discovery]
        APIRoutes --> DB[(Database: SQLite / MySQL)]
        
        Supervisor[PM2 & Port Utils] -.->|Mengelola Siklus Hidup| Express
        Supervisor -.->|Auto Free Port & Shutdown| Go2RTC
    end
    
    subgraph Video Engine
        Go2RTC -->|RTSP Pull| IPCams[IP Camera RTSP Stream]
        FFmpegRec[FFmpeg Recording Processes] -->|RTSP Pull| IPCams
        FFmpegRec -->|Write Segments| Storage[Local Recordings Storage]
        Watcher[Chokidar File Watcher] -->|Deteksi Berkas Baru| PostProc[Post Processor: Faststart Remux]
        PostProc -->|Update Metadata| DB
        StorageService[Storage Cleanup Service] -->|Rotasi File Lama| Storage
    end
```

### Komponen Utama:

1. **Backend Server (`server.js` & `app.js`)**:
   - Menggunakan Express.js, menangani rute halaman web, autentikasi session pengguna, API RESTful untuk kamera, rekaman, konfigurasi sistem, dan integrasi WebSocket.
2. **Streaming Gateway (`go2rtc`)**:
   - Dikelola otomatis oleh `lib/go2rtc-manager.js`. Mengambil stream RTSP kamera dan menyajikannya ke klien dalam format WebRTC ultra-rendah latensi (< 200ms) atau RTSP/MSE.
3. **Stream Relay JSMpeg (`lib/stream-relay.js`)**:
   - Menerima input stream MPEG1 dari FFmpeg via port HTTP `9999` dan menyiarkannya via WebSocket ke browser untuk pemutar JSMpeg.
4. **Modul Perekaman (`recorder.js` & `lib/ffmpeg-manager.js`)**:
   - Menjalankan dan memantau proses *spawn* FFmpeg untuk setiap kamera aktif, memecah rekaman ke dalam segmen MP4 berkala, dengan mekanisme *watchdog* dan *exponential backoff* jika kamera offline.
5. **Post-Processing (`lib/post-processor.js`)**:
   - Menggunakan antrean pemrosesan paralel (*concurrency queue*) untuk memindahkan `moov atom` ke awal berkas MP4 (*faststart*), sehingga berkas dapat langsung di-seek di browser tanpa harus mengunduh keseluruhan berkas.
6. **Lapisan Database (`lib/database.js`)**:
   - Menyediakan antarmuka terpadu (abstraction layer) yang mendukung SQLite3 dan MySQL/MariaDB.
7. **Proses Supervisor & Port Management (`ecosystem.config.js` & `lib/port-utils.js`)**:
   - Mengatur lifecycle aplikasi di bawah PM2, mengeliminasi risiko *crash loop* akibat *port conflict* (EADDRINUSE) di sistem Windows.

---

## 3. Alokasi Port dan Jaringan

Secara default, CartaNVR menggunakan alokasi port berikut:

| Port | Protokol | Deskripsi | Konfigurasi |
| :--- | :--- | :--- | :--- |
| **3000** | HTTP / WS | Web UI, REST API, WebSocket Client | `PORT` di `.env` (default: 3000) |
| **9999** | HTTP (Local) | JSMpeg Relay Server (Input FFmpeg) | Internal `lib/stream-relay.js` |
| **1985** / 1984 | HTTP | go2rtc REST API & Web Dashboard | `GO2RTC_API_PORT` di `.env` |
| **8556** / 8555 | UDP/TCP | go2rtc WebRTC Signaling & Media | `GO2RTC_WEBRTC_PORT` di `.env` |
| **8564** / 8554 | TCP | go2rtc RTSP Re-streaming Server | `GO2RTC_RTSP_PORT` di `.env` |

> [!NOTE]
> Pada sistem operasi Windows di mana port sering tertahan oleh proses *zombie* setelah restart mendadak, pustaka [port-utils.js](file:///f:/nvr/lib/port-utils.js) dan skrip [start.js](file:///f:/nvr/start.js) akan otomatis mendeteksi dan membebaskan port-port tersebut sebelum server melakukan `listen`.

---

## 4. Panduan Menjalankan dengan PM2

Aplikasi ini telah dioptimalkan agar berjalan stabil di latar belakang menggunakan **PM2**. Tersedia skrip pembantu [start.js](file:///f:/nvr/start.js) dan berkas konfigurasi [ecosystem.config.js](file:///f:/nvr/ecosystem.config.js).

### Perintah Cepat via npm

Gunakan perintah npm berikut dari direktori root proyek:

```bash
# Menjalankan atau restart NVR dengan PM2 (disertai pembersihan port otomatis)
npm run pm2:start

# Melihat status NVR, penggunaan memori, restart count, dan status port
npm run pm2:status

# Melihat log streaming dan perekaman secara real-time
npm run pm2:logs

# Me-restart NVR dengan aman
npm run pm2:restart

# Menghentikan NVR
npm run pm2:stop

# Menghapus NVR dari daftar proses PM2
npm run pm2:delete
```

---

### Menggunakan Skrip Pembantu `start.js`

Skrip `start.js` menyediakan CLI interaktif yang lebih fleksibel:

```bash
# 1. Menjalankan NVR
node start.js
# atau: node start.js start

# 2. Memeriksa status lengkap (dilengkapi pengecekan status port)
node start.js status

# 3. Menampilkan log langsung
node start.js logs

# 4. Melakukan restart aman
node start.js restart

# 5. Menghentikan proses
node start.js stop
```

#### Keunggulan `start.js` dibanding `pm2 start` biasa:
1. **Otomatis Membersihkan Zombie Ports**: Sebelum menjalankan server, skrip memeriksa port `3000`, `9999`, `1985`, `8556`, dan `8564`. Jika ada proses sisa/macet yang menahan port tersebut, proses akan dihentikan secara paksa (`taskkill /F`).
2. **Mencegah Crash Loop**: Mencegah insiden restart berulang-ulang akibat bentrok socket (EADDRINUSE).
3. **Auto PM2 Save**: Otomatis menjalankan `pm2 save` sehingga NVR akan kembali berjalan otomatis saat komputer/server di-reboot.

---

### Konfigurasi `ecosystem.config.js`

Berkas [ecosystem.config.js](file:///f:/nvr/ecosystem.config.js) dirancang khusus untuk stabilitas di lingkungan Windows:

```javascript
module.exports = {
  apps: [
    {
      name: 'nvr',
      script: 'server.js',
      cwd: __dirname,

      // Penanganan restart cerdas
      restart_delay: 5000,            // Jeda 5 detik antar restart jika terjadi error tak terduga
      max_restarts: 10,               // Maksimal 10 restart berturut-turut
      min_uptime: '10s',              // Batas waktu proses dinyatakan stabil
      exp_backoff_restart_delay: 100, // Exponential backoff

      // Penanganan Graceful Shutdown
      kill_timeout: 15000,            // Waktu 15 detik bagi FFmpeg & go2rtc untuk keluar dengan rapi
      listen_timeout: 30000,
      shutdown_with_message: true,    // Mengirim event 'shutdown' yang kompatibel dengan Windows

      // Penyimpanan Log
      error_file: path.join(__dirname, 'logs', 'nvr-error.log'),
      out_file: path.join(__dirname, 'logs', 'nvr-out.log'),
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      merge_logs: true,

      // Batasan memori
      node_args: '--max-old-space-size=512',
      autorestart: true,
      watch: false,
    },
  ],
};
```

---

## 5. Konfigurasi Variabel Lingkungan (`.env`)

Konfigurasi aplikasi disimpan dalam berkas `.env` di direktori utama:

```env
# ===================================================================
# Database Configuration
# ===================================================================
# Pilihan: 'sqlite' atau 'mysql'
DB_TYPE=mysql

# Konfigurasi MySQL (hanya diperlukan jika DB_TYPE=mysql)
MYSQL_HOST=localhost
MYSQL_USER=root
MYSQL_PASSWORD=rahasia_anda
MYSQL_DATABASE=nvr

# ===================================================================
# Keamanan & Autentikasi
# ===================================================================
# Secret key untuk enkripsi session cookie (wajib diganti di produksi)
SESSION_SECRET=kunci-rahasia-yang-sangat-panjang-dan-unik

# Password default akun 'admin' saat inisialisasi awal
DEFAULT_ADMIN_PASSWORD=smacampurdarat

# CORS Whitelist (domain yang diizinkan mengakses API / stream)
# Mendukung tanda bintang wildcard, contoh: *.domainanda.com
CORS_WHITELIST=*.sman1campurdarat.sch.id

# ===================================================================
# Alokasi Port Streaming go2rtc
# ===================================================================
# Ubah jika terdapat bentrok dengan aplikasi lain di server yang sama
GO2RTC_API_PORT=1985
GO2RTC_WEBRTC_PORT=8556
GO2RTC_RTSP_PORT=8564
```

---

## 6. Detail Komponen & Modul Backend

Berikut adalah rincian peran masing-masing berkas di dalam direktori `lib/` dan `routes/`:

### Direktori `lib/`

- **[config.js](file:///f:/nvr/lib/config.js)**: Pusat konfigurasi aplikasi. Memuat `.env`, berkas `config.json`, nilai default sistem, dan mendukung pembaruan dinamis dari pengaturan database (`syncWithDatabase`).
- **[database.js](file:///f:/nvr/lib/database.js)**: Abstraksi layer database. Mendukung SQLite dan MySQL secara transparan untuk entitas kamera, rekaman, pengguna, remote nodes, dan pengaturan sistem.
- **[port-utils.js](file:///f:/nvr/lib/port-utils.js)**: Modul deteksi proses port via `netstat`/`lsof`, pembunuh PID otomatis, dan pembungkus `listenWithRetry` untuk server HTTP dan relay.
- **[go2rtc-manager.js](file:///f:/nvr/lib/go2rtc-manager.js)**: Pengendali siklus hidup *binary* go2rtc. Menghasilkan berkas YAML konfigurasi dinamis, mendaftarkan stream kamera ke API go2rtc, dan melakukan sinkronisasi berkala stream yang hilang.
- **[stream-relay.js](file:///f:/nvr/lib/stream-relay.js)**: Server HTTP dan WebSocket internal untuk menyalurkan stream MPEG1 (JSMpeg) ke antarmuka web.
- **[ffmpeg-manager.js](file:///f:/nvr/lib/ffmpeg-manager.js)**: Pengelola proses perekaman FFmpeg per kamera. Menangani pembuatan berkas segmen MP4 dan playlist HLS/DASH.
- **[post-processor.js](file:///f:/nvr/lib/post-processor.js)**: Pemrosesan lanjutan berkas video MP4 baru untuk memindahkan metadata `moov atom` (*faststart*) dengan sistem antrean berantai (*concurrency queue*).
- **[storage.js](file:///f:/nvr/lib/storage.js)**: Pengatur penyimpanan berkas rekaman, pemantauan batas kapasitas penyimpanan, sinkronisasi berkas fisik dengan database, dan pembersihan berkas usang.
- **[onvif-scanner.js](file:///f:/nvr/lib/onvif-scanner.js)**: Pemindai jaringan lokal untuk menemukan kamera IP yang mendukung protokol ONVIF Profile S/T.
- **[setup-wizard.js](file:///f:/nvr/lib/setup-wizard.js)**: Wizard interaktif konsol CLI yang memandu pengguna mengonfigurasi database saat pertama kali aplikasi dijalankan tanpa `.env`.
- **[discovery.js](file:///f:/nvr/lib/discovery.js)**: Layanan Bonjour/mDNS untuk mengiklankan keberadaan NVR di jaringan lokal agar mudah ditemukan oleh aplikasi klien.
- **[healthcheck.js](file:///f:/nvr/lib/healthcheck.js)**: Endpoint utilitas untuk memeriksa kesehatan proses, penggunaan RAM, konektivitas database, dan status perekam.
- **[logger.js](file:///f:/nvr/lib/logger.js)**: Sistem pencatatan log modular (kategori: recorder, storage, general, api) dengan rotasi berkas otomatis.

### Direktori `routes/`

- **[routes/auth.js](file:///f:/nvr/routes/auth.js)**: Menangani alur login, logout, dan status session pengguna via Passport.js.
- **[routes/pages.js](file:///f:/nvr/routes/pages.js)**: Menyajikan berkas HTML utama (Dashboard, Manajemen Kamera, Playback, Settings, System Logs).
- **[routes/websocket.js](file:///f:/nvr/routes/websocket.js)**: Menangani koneksi WebSocket klien untuk streaming langsung JSMpeg.
- **[routes/api/cameras.js](file:///f:/nvr/routes/api/cameras.js)**: CRUD konfigurasi kamera, status stream, dan kontrol re-koneksi.
- **[routes/api/recordings.js](file:///f:/nvr/routes/api/recordings.js)**: Pengambilan daftar berkas rekaman per kamera berdasarkan rentang tanggal/jam dan streaming berkas MP4.
- **[routes/api/system.js](file:///f:/nvr/routes/api/system.js)**: Informasi statistik CPU, RAM, disk, konfigurasi sistem, dan manajemen remote nodes.
- **[routes/api/go2rtc.js](file:///f:/nvr/routes/api/go2rtc.js)**: Proxy rute untuk WebRTC offer/answer negotiation ke service go2rtc.

---

## 7. Panduan Pengoperasian Antarmuka Web

1. **Login Awal**:
   - Buka browser dan kunjungi `http://localhost:3000` (atau IP server Anda).
   - Masukkan Username `admin` dan Password default `smacampurdarat`.
   - *Catatan: Sangat disarankan untuk segera mengubah password setelah login pertama melalui menu pengaturan.*
2. **Menambahkan Kamera**:
   - Masuk ke menu **Camera Manager**.
   - **Pemindaian Otomatis**: Masukkan subnet IP jaringan (misal: `192.168.1.1-254`), lalu klik **Scan**. Kamera yang mendukung ONVIF akan otomatis terdeteksi.
   - **Penambahan Manual**: Masukkan nama kamera, alamat IP, dan URL RTSP (contoh: `rtsp://user:pass@192.168.1.50:554/live/ch0`).
   - Pilih metode streaming: **go2rtc** (WebRTC performa tinggi) atau **JSMpeg**.
3. **Memantau Live View di Dashboard**:
   - Halaman **Dashboard** menampilkan grid pemantauan seluruh kamera aktif.
   - Pemutar video menggunakan *IntersectionObserver* (lazy-loading): pemutar hanya aktif jika kartu kamera berada di area pandang layar, sehingga hemat CPU dan bandwidth.
4. **Playback Rekaman**:
   - Masuk ke menu **Playback**.
   - Pilih kamera dan tentukan rentang tanggal/waktu yang diinginkan.
   - Klik segmen video untuk langsung memutar rekaman. Bilah navigasi memungkinkan pencarian waktu secara cepat berkat proses *faststart*.

---

## 8. Struktur Direktori Proyek

```
f:\nvr\
├── .env                       # Variabel lingkungan & konfigurasi kredensial
├── .gitignore                 # Konfigurasi pengecualian Git
├── app.js                     # Inisialisasi Express, CORS, middleware, dan session
├── server.js                  # Entry point utama, HTTP server, graceful shutdown
├── start.js                   # CLI launcher PM2 & port cleaner otomatis
├── ecosystem.config.js        # Konfigurasi proses PM2 untuk produksi
├── recorder.js                # Orkestrasi perekaman kamera & background workers
├── package.json               # Dependensi & script perintah npm
├── DOCUMENTATION.md           # Dokumentasi teknis lengkap ini
├── README.md                  # Panduan ringkas proyek
│
├── lib/                       # Modul pustaka inti
│   ├── config.js              # Loader konfigurasi dinamis
│   ├── database.js            # Abstraksi database (SQLite / MySQL)
│   ├── db-events.js           # Event emitter perubahan database
│   ├── discovery.js           # mDNS / Bonjour advertisement
│   ├── ffmpeg-manager.js      # Manajemen subproses FFmpeg
│   ├── go2rtc-manager.js      # Supervisor service go2rtc
│   ├── healthcheck.js         # Status kesehatan sistem
│   ├── logger.js              # Sistem logging aplikasi
│   ├── middleware.js          # Guard autentikasi rute
│   ├── onvif-scanner.js       # Pemindai kamera ONVIF
│   ├── passport-config.js     # Strategi login lokal
│   ├── port-utils.js          # Utilitas port & pembunuh proses zombie
│   ├── post-processor.js      # Faststart remuxer antrean MP4
│   ├── setup-wizard.js        # Wizard instalasi database CLI
│   ├── storage.js             # Manajemen rotasi & pembersihan storage
│   ├── stream-relay.js        # JSMpeg WebSocket relay
│   └── utils.js               # Fungsi utilitas pembantu
│
├── routes/                    # Definisi rute Express
│   ├── auth.js                # Rute autentikasi
│   ├── pages.js               # Rute penyaji halaman HTML
│   ├── websocket.js           # Rute koneksi WebSocket
│   └── api/                   # Endpoint RESTful API
│       ├── cameras.js         # API kamera
│       ├── go2rtc.js          # API signaling go2rtc WebRTC
│       ├── maintenance.js     # API pemeliharaan database & berkas
│       ├── recordings.js      # API berkas rekaman
│       ├── storages.js        # API kuota penyimpanan
│       └── system.js          # API diagnostik sistem
│
├── public/                    # Aset statis & halaman antarmuka web
│   ├── dashboard.html         # Tampilan grid live view
│   ├── manage-cameras.html    # Halaman manajemen kamera
│   ├── playback.html          # Halaman pemutar rekaman
│   ├── index.html             # Halaman login
│   ├── go2rtc-player.html     # Pemutar WebRTC go2rtc mandiri
│   ├── hls-player.html        # Pemutar HLS mandiri
│   └── js/ & css/             # Skrip & stylesheet frontend
│
├── logs/                      # Berkas log output & error PM2 (diabaikan git)
│   ├── nvr-out.log
│   └── nvr-error.log
│
└── recordings/                # Direktori penyimpanan rekaman MP4 (per cam_{id})
```
