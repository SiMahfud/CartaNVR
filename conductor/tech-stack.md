# Technology Stack

## Core Backend
- **Language:** Node.js (JavaScript)
- **Framework:** Express.js
- **Real-time:** WebSockets (`ws`, `express-ws`)

## Data Management
- **Databases:**
    - **SQLite:** Digunakan untuk instalasi mandiri (standalone) yang ringan.
    - **MySQL/MariaDB:** Didukung untuk skalabilitas yang lebih besar atau penggunaan infrastruktur database yang sudah ada.
- **ORM/Drivers:** `sqlite3`, `mysql2`, `connect-sqlite3` (untuk session).

### Configuration (Environment Variables)
- `DB_TYPE`: `sqlite` (default) or `mysql`
- `MYSQL_HOST`, `MYSQL_USER`, `MYSQL_PASSWORD`, `MYSQL_DATABASE` for MySQL configuration.

## Video & Camera Processing
- **Engine:** FFmpeg (`ffmpeg-static`, `ffprobe-static`) untuk pemrosesan stream RTSP dan transcoding.
- **Protocol:** ONVIF (`node-onvif`) untuk penemuan dan manajemen kamera IP secara otomatis.

## Security & Auth
- **Middleware:** Passport.js (`passport`, `passport-local`)
- **Encryption:** `bcryptjs` untuk hashing password.

## Utilities
- **CLI Interaction:** `inquirer` untuk wizard setup database interaktif.
- **File Monitoring:** `chokidar` untuk memantau perubahan pada direktori rekaman.
- **Process Management:** Mendukung `pm2` (via `start.js`).
