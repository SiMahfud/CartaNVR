# Dokumentasi Sistem NVR (Network Video Recorder)

Dokumen ini memberikan penjelasan mendalam tentang arsitektur, fungsionalitas, dan cara kerja aplikasi NVR ini.

## 1. Gambaran Umum

Aplikasi ini adalah sebuah **Network Video Recorder (NVR)** sederhana yang dirancang untuk:
- Menemukan dan mengelola kamera IP yang kompatibel dengan protokol ONVIF di jaringan lokal.
- Merekam video dari stream RTSP (Real-Time Streaming Protocol) kamera secara terus-menerus.
- Menyediakan antarmuka web untuk melihat siaran langsung (live view) dari kamera.
- Mengelola penyimpanan rekaman secara otomatis untuk mencegah kehabisan ruang disk.
- Menyediakan fitur pemutaran ulang (playback) untuk rekaman video.

Aplikasi ini cocok untuk penggunaan skala kecil hingga menengah yang membutuhkan solusi perekaman CCTV yang efisien dan dapat diakses melalui web.

## 2. Arsitektur Sistem

Sistem ini dibangun di atas beberapa komponen utama yang bekerja sama untuk menyediakan fungsionalitas NVR yang lengkap.

![Diagram Arsitektur](link-ke-diagram-jika-ada.png) *(Placeholder untuk diagram arsitektur)*

### Komponen Utama:

- **Backend (Aplikasi Server)**:
  - **Framework**: Node.js dengan Express.js.
  - **Fungsi**: Bertindak sebagai otak dari aplikasi, menangani logika bisnis, melayani halaman web, menyediakan API, dan mengelola proses perekaman.
  - **File Utama**: `server.js`

- **Frontend (Antarmuka Pengguna)**:
  - **Teknologi**: HTML, CSS, dan JavaScript vanilla, dengan bantuan Bootstrap untuk styling.
  - **Fungsi**: Menyediakan antarmuka web yang interaktif bagi pengguna untuk login, mengelola kamera, dan melihat video.
  - **File Utama**: `public/dashboard.html`, `public/manage-cameras.html`, dll.

- **Database**:
  - **Sistem**: SQLite 3.
  - **Fungsi**: Menyimpan data persisten seperti daftar pengguna, konfigurasi kamera, dan metadata file rekaman.
  - **File Utama**: `lib/database.js`, `cctv.db` (file database).

- **Modul Perekaman (Recorder)**:
  - **Dependensi Inti**: **FFmpeg**.
  - **Fungsi**: Proses latar belakang yang bertanggung jawab untuk mengambil stream RTSP dari kamera dan menyimpannya ke dalam file video MP4. Modul ini juga membuat segmen HLS (HTTP Live Streaming) untuk keperluan live view.
  - **File Utama**: `recorder.js`.

- **Penyimpanan (Storage)**:
  - **Jenis**: Sistem file lokal.
  - **Fungsi**: Menyimpan file rekaman video dalam format MP4 di dalam direktori `recordings/`.
  - **Manajemen**: Ruang penyimpanan dikelola secara otomatis oleh `recorder.js` untuk menghapus rekaman tertua jika kapasitas maksimum terlampaui.

## 3. Detail Backend

Backend adalah komponen inti yang menjalankan seluruh logika aplikasi.

### `server.js`
Ini adalah titik masuk (entry point) utama dari aplikasi Node.js. Tugas-tugas utamanya meliputi:
- **Inisialisasi Server**: Membuat server Express dan mengaitkannya dengan modul `http`.
- **Middleware**: Menggunakan middleware penting seperti `express.json()` untuk parsing body JSON, `express.static()` untuk menyajikan file frontend, dan `express-session` untuk manajemen sesi.
- **Autentikasi**: Mengintegrasikan `passport.js` dengan strategi `passport-local` untuk menangani login pengguna. Sesi pengguna disimpan dalam database SQLite (`connect-sqlite3`).
- **Routing**: Mendefinisikan semua rute (routes) aplikasi, yang terbagi menjadi dua kategori:
  - **Rute Halaman**: Menyajikan file HTML untuk halaman utama, dashboard, manajemen kamera, dan playback.
  - **Rute API (`/api/`)**: Menyediakan endpoint RESTful untuk operasi CRUD (Create, Read, Update, Delete) pada kamera, memicu pemindaian jaringan, dan mengambil data rekaman. Semua rute API dilindungi dan memerlukan autentikasi.
- **Inisialisasi Aplikasi**: Memastikan pengguna admin default ada di database saat pertama kali dijalankan dan memanggil `recorder.js` untuk memulai semua proses perekaman.

### `lib/database.js`
Modul ini bertanggung jawab atas semua interaksi dengan database SQLite (`cctv.db`).
- **Skema Database**: Saat pertama kali dijalankan, modul ini membuat tiga tabel utama jika belum ada:
  - `users`: Menyimpan informasi login pengguna (username, password yang di-hash dengan bcrypt).
  - `cameras`: Menyimpan konfigurasi setiap kamera (nama, alamat IP, URL RTSP).
  - `recordings`: Menyimpan metadata untuk setiap segmen video yang direkam (path file, timestamp, durasi), dengan relasi ke tabel `cameras`.
- **Fungsi Helper**: Mengekspor serangkaian fungsi berbasis Promise untuk melakukan operasi database secara aman dan terstruktur, seperti `findUserByUsername`, `getAllCameras`, `addRecording`, dll.

### `lib/onvif-scanner.js`
Modul ini menyediakan fungsionalitas untuk menemukan kamera IP di jaringan.
- **Parsing IP Range**: Mampu mengurai input dalam berbagai format (IP tunggal, rentang IP seperti `192.168.1.10-20`, atau notasi CIDR seperti `192.168.1.0/24`).
- **Penemuan ONVIF**: Menggunakan library `node-onvif` untuk mencoba terhubung ke setiap alamat IP dalam jangkauan. Jika perangkat merespons dan berhasil diinisialisasi sebagai perangkat ONVIF, perangkat tersebut akan ditambahkan ke daftar hasil.

### `recorder.js`
Ini adalah modul yang paling kompleks dan krusial untuk fungsionalitas NVR. Modul ini berjalan sebagai layanan latar belakang yang dikelola oleh `server.js`.
- **Proses Perekaman**:
  - Untuk setiap kamera yang ada di database, `recorder.js` akan membuat (spawn) proses **FFmpeg** baru.
  - Proses FFmpeg ini dikonfigurasi untuk melakukan dua hal secara bersamaan:
    1.  **Merekam ke File**: Mengambil stream RTSP dari kamera dan menyimpannya sebagai segmen file `.mp4` (misalnya, setiap 3 menit). File-file ini disimpan di direktori `recordings/cam_{id}/`.
    2.  **Membuat Stream HLS**: Menghasilkan stream HLS (file `.m3u8` dan segmen `.ts`) secara real-time. Stream ini disimpan di `public/hls/cam_{id}/` dan digunakan oleh frontend untuk menyajikan siaran langsung.
- **Manajemen Proses FFmpeg**:
  - Memantau setiap proses FFmpeg. Jika sebuah proses gagal (misalnya, koneksi ke kamera terputus), `recorder.js` akan secara otomatis mencoba me-restart proses tersebut dengan strategi *exponential backoff* untuk menghindari penumpukan error.
- **Post-Processing**:
  - Menggunakan `chokidar` untuk memantau direktori rekaman. Ketika file segmen `.mp4` baru selesai ditulis, modul ini akan:
    1.  Menjalankan `ffmpeg` lagi pada file tersebut untuk memindahkan `moov atom` ke awal file (proses `faststart`). Ini penting untuk pemutaran video yang efisien melalui web.
    2.  Setelah `faststart` berhasil, ia akan mengambil durasi video dan menambahkan entri metadata ke tabel `recordings` di database.
- **Manajemen Penyimpanan (Cleanup)**:
  - Secara berkala (misalnya, setiap 5 menit), modul ini akan memeriksa total ukuran direktori `recordings/`.
  - Jika total ukuran melebihi batas yang ditentukan (`MAX_STORAGE`), ia akan menghapus file rekaman tertua (beserta entri databasenya) hingga total ukuran kembali di bawah batas.
- **Sinkronisasi**:
  - Saat startup, melakukan sinkronisasi satu kali untuk memastikan semua file `.mp4` yang ada di disk terdaftar di database.
  - Secara berkala, memeriksa apakah ada entri di database yang file fisiknya sudah tidak ada, lalu membersihkannya.

## 4. Detail Frontend

Antarmuka pengguna (frontend) dibangun dengan HTML, CSS, dan JavaScript sisi klien untuk memberikan pengalaman yang responsif dan efisien.

### `public/dashboard.html`
Ini adalah halaman utama tempat pengguna melihat semua siaran langsung kamera.
- **Grid Kamera Dinamis**: Saat halaman dimuat, ia akan memanggil API `/api/cameras` untuk mendapatkan daftar semua kamera yang terkonfigurasi. Berdasarkan respons ini, ia secara dinamis membuat "kartu" untuk setiap kamera dan menampilkannya dalam sebuah grid.
- **Lazy Loading (Pemuatan Malas)**: Untuk menghemat sumber daya (CPU dan bandwidth), pemutar video tidak langsung dimuat untuk semua kamera. Dashboard menggunakan `IntersectionObserver` API untuk mendeteksi kartu kamera mana yang sedang terlihat di layar pengguna. Pemutar video hanya akan dimulai untuk kamera yang terlihat.
- **Manajemen Player dengan Iframe**: Setiap pemutar video dimuat di dalam sebuah `<iframe>` yang menunjuk ke `hls-player.html`. Ini mengisolasi setiap pemutar dan mencegah masalah pada satu pemutar memengaruhi yang lain.
- **Komunikasi via `postMessage`**: Dashboard berkomunikasi dengan setiap iframe menggunakan `window.postMessage()` untuk mengirim URL HLS yang harus diputar. Ia juga menerima pesan kembali dari iframe, misalnya ketika resolusi video terdeteksi.
- **Optimalisasi Kinerja**:
  - **Page Visibility API**: Dashboard menggunakan API ini untuk mendeteksi jika pengguna beralih ke tab lain atau meminimalkan browser. Jika halaman menjadi tidak terlihat, semua pemutar video akan dihentikan. Mereka akan dimulai kembali secara otomatis ketika halaman kembali terlihat.
  - **Dark Mode**: Menyediakan opsi untuk beralih antara tema terang dan gelap, dengan preferensi disimpan di *cookie*.

### `public/hls-player.html`
File ini adalah pemutar video HLS yang mandiri dan dapat disematkan.
- **Tujuan**: Dirancang khusus untuk dimuat di dalam `<iframe>` oleh dashboard. Tanggung jawab utamanya adalah menerima URL HLS dan memutarnya.
- **Dukungan HLS**: Menggunakan pustaka `hls.js` (dari CDN) untuk pemutaran di browser yang tidak mendukung HLS secara native (seperti Chrome, Firefox). Untuk browser yang mendukungnya (seperti Safari), ia akan menggunakan elemen `<video>` HTML5 standar.
- **Pelaporan Resolusi**: Setelah video mulai diputar dan metadatanya tersedia, skrip di halaman ini akan mendeteksi resolusi asli video (`videoWidth` dan `videoHeight`) dan mengirimkan informasi ini kembali ke `dashboard.html` induknya. Ini memungkinkan dashboard untuk menyesuaikan rasio aspek wadah video agar sesuai dengan sumbernya, menghindari distorsi gambar.

## 5. Panduan Instalasi & Konfigurasi

Berikut adalah langkah-langkah untuk menginstal, mengkonfigurasi, dan menjalankan aplikasi NVR di lingkungan lokal.

### Prasyarat
1.  **Node.js**: Pastikan Node.js (versi 14.x atau lebih tinggi) terinstal di sistem Anda.
2.  **npm**: Manajer paket Node.js, biasanya terinstal bersama Node.js.
3.  **FFmpeg**: Ini adalah dependensi eksternal yang **wajib** ada. Aplikasi memanggil `ffmpeg` dari baris perintah. Pastikan `ffmpeg` telah terinstal di sistem Anda dan path ke executable-nya telah ditambahkan ke variabel lingkungan `PATH` sistem Anda.

### Langkah-langkah Instalasi
1.  **Kloning Repositori**:
    ```bash
    git clone https://github.com/v2l2/cctv.git
    cd cctv
    ```

2.  **Instal Dependensi Node.js**:
    Jalankan perintah berikut di direktori root proyek untuk menginstal semua pustaka yang diperlukan dari `package.json`:
    ```bash
    npm install
    ```

### Menjalankan Aplikasi
1.  **Mulai Server**:
    Gunakan skrip `start` dari `package.json` untuk menjalankan server:
    ```bash
    npm start
    ```

2.  **Akses Aplikasi**:
    Setelah server berjalan, Anda akan melihat output di konsol seperti `Server is running on http://localhost:3000`. Buka browser web Anda dan navigasikan ke alamat tersebut.

3.  **Login Awal**:
    - **Username**: `admin`
    - **Password**: `smacampurdarat`

    Saat pertama kali dijalankan, aplikasi akan secara otomatis membuat akun administrator default ini.

### Konfigurasi Penting
Sebagian besar konfigurasi kritis berada di dalam file `recorder.js`. Anda dapat mengubah nilai-nilai ini sesuai kebutuhan:
- `MAX_STORAGE`: Total kapasitas penyimpanan maksimum untuk semua rekaman dalam byte. Contoh: `600 * 1024 * 1024 * 1024` untuk 600 GB.
- `CLEANUP_INTERVAL_MS`: Seberapa sering (dalam milidetik) proses pembersihan penyimpanan dijalankan.
- `HLS_TIME_SECONDS`: Durasi setiap segmen video HLS (untuk live view). Nilai yang lebih kecil memberikan latensi yang lebih rendah tetapi menghasilkan lebih banyak file.
- `FFMPEG_MAX_RETRY`: Berapa kali sistem akan mencoba me-restart proses `ffmpeg` yang gagal sebelum masuk ke periode "cool-off".

## 6. Panduan Penggunaan

Berikut adalah alur kerja umum bagi pengguna aplikasi.

1.  **Login**:
    - Akses aplikasi melalui browser di `http://localhost:3000`.
    - Masukkan kredensial Anda. Untuk pengguna pertama kali, gunakan `admin` / `smacampurdarat`.

2.  **Mengelola Kamera (`Camera Manager`)**:
    - Setelah login, navigasikan ke halaman "Camera Manager" melalui menu navigasi.
    - **Menemukan Kamera Secara Otomatis**:
      - Masukkan rentang IP jaringan Anda (misalnya, `192.168.1.1-254`) ke dalam kolom "Scan IP Range".
      - Klik tombol "Scan". Sistem akan mencari perangkat yang kompatibel dengan ONVIF. Hasilnya akan muncul di daftar.
    - **Menambah Kamera Secara Manual**:
      - Jika kamera Anda tidak ditemukan atau tidak mendukung ONVIF, Anda dapat menambahkannya secara manual.
      - Isi nama kamera, alamat IP, dan URL RTSP lengkap di formulir yang tersedia.
      - Klik "Add Camera".
    - Kamera yang ditambahkan akan langsung memulai proses perekaman di latar belakang.

3.  **Melihat Siaran Langsung (`Dashboard`)**:
    - Navigasikan ke halaman "Dashboard".
    - Anda akan melihat grid yang menampilkan siaran langsung dari semua kamera yang telah Anda tambahkan.
    - Player video hanya akan aktif ketika kartu kamera terlihat di layar untuk menghemat sumber daya.

4.  **Memutar Ulang Rekaman (`Playback`)**:
    - Navigasikan ke halaman "Playback".
    - Pilih kamera yang ingin Anda lihat rekamannya dari daftar dropdown.
    - Pilih rentang tanggal dan waktu untuk rekaman yang ingin Anda lihat.
    - Klik "Load Recordings".
    - Daftar segmen video yang tersedia akan ditampilkan. Klik pada salah satu segmen untuk memutarnya.

## 7. Struktur Proyek

Berikut adalah ringkasan struktur direktori dan file utama dalam proyek ini.

```
.
├── lib/
│   ├── database.js         # Modul untuk interaksi database SQLite.
│   └── onvif-scanner.js    # Logika untuk penemuan kamera ONVIF.
├── node_modules/           # Dependensi Node.js (dihasilkan oleh npm install).
├── public/
│   ├── dashboard.html      # Halaman utama untuk live view.
│   ├── hls-player.html     # Pemutar HLS yang disematkan.
│   ├── index.html          # Halaman login.
│   ├── manage-cameras.html # Halaman untuk mengelola kamera.
│   ├── playback.html       # Halaman untuk melihat rekaman.
│   └── hls/                # Direktori untuk file stream HLS (dihasilkan oleh ffmpeg).
├── recordings/             # Direktori untuk menyimpan file rekaman MP4 (dihasilkan oleh ffmpeg).
├── cctv.db                 # File database SQLite (dihasilkan saat pertama kali dijalankan).
├── DOCUMENTATION.md        # File dokumentasi ini.
├── package.json            # Mendefinisikan metadata proyek dan dependensi.
├── package-lock.json       # Mengunci versi dependensi.
├── recorder.js             # Skrip utama untuk mengelola perekaman FFmpeg.
└── server.js               # Titik masuk utama aplikasi Express.js.
```
