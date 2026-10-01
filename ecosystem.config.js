/**
 * PM2 Ecosystem Configuration for CartaNVR
 * 
 * Usage:
 *   pm2 start ecosystem.config.js        # Start NVR
 *   pm2 stop nvr                          # Stop NVR
 *   pm2 restart nvr                       # Restart NVR
 *   pm2 delete nvr                        # Remove from PM2
 *   pm2 logs nvr                          # View logs
 * 
 * Atau gunakan helper script:
 *   node start.js                         # Start / restart otomatis
 *   node start.js stop                    # Stop NVR
 *   node start.js logs                    # Lihat logs
 */

const path = require('path');

module.exports = {
  apps: [
    {
      name: 'nvr',
      script: 'server.js',
      cwd: __dirname,

      // === Restart Strategy ===
      // Gunakan exponential backoff agar tidak crash loop
      restart_delay: 5000,           // Tunggu 5 detik sebelum restart
      max_restarts: 10,              // Maks 10 restart dalam window
      min_uptime: '10s',             // Harus jalan minimal 10 detik agar dianggap "stabil"
      exp_backoff_restart_delay: 100, // Exponential backoff mulai dari 100ms

      // === Graceful Shutdown ===
      // PM2 di Windows kirim 'shutdown' message, bukan SIGINT/SIGTERM
      // Beri waktu cukup untuk stop FFmpeg, go2rtc, dan close ports
      kill_timeout: 15000,           // Tunggu 15 detik sebelum force kill
      listen_timeout: 30000,         // Tunggu 30 detik untuk proses start
      shutdown_with_message: true,   // Kirim message 'shutdown' (penting untuk Windows!)

      // === Logging ===
      error_file: path.join(__dirname, 'logs', 'nvr-error.log'),
      out_file: path.join(__dirname, 'logs', 'nvr-out.log'),
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      merge_logs: true,              // Gabung log dari semua instance

      // === Environment ===
      node_args: '--max-old-space-size=512',
      autorestart: true,
      watch: false,                  // Jangan watch, NVR punya file watcher sendiri

      // === Environment Variables ===
      env: {
        NODE_ENV: 'production',
      },
    },
  ],
};
