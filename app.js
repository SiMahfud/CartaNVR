const express = require('express');
const path = require('path');
const cors = require('cors');
const config = require('./lib/config');
const database = require('./lib/database');

// Modul untuk Autentikasi
const session = require('express-session');
const SQLiteStore = require('connect-sqlite3')(session);
const passport = require('passport');
const initializePassport = require('./lib/passport-config');

const app = express();
app.set('trust proxy', 1);
// StreamRelay initialization moved to server.js


// Parse CORS whitelist dari .env (support wildcard *.domain.com & full URL)
function isOriginWhitelisted(origin) {
  try {
    const whitelist = (process.env.CORS_WHITELIST || '')
      .split(',')
      .map(s => s.trim())
      .filter(Boolean);

    const originUrl = new URL(origin);
    const originHostname = originUrl.hostname.toLowerCase();

    return whitelist.some(pattern => {
      let cleanPattern = pattern.toLowerCase();
      try {
        if (cleanPattern.startsWith('http://') || cleanPattern.startsWith('https://')) {
          cleanPattern = new URL(cleanPattern).hostname.toLowerCase();
        }
      } catch {}

      if (cleanPattern.startsWith('*.')) {
        // Wildcard: cocokkan domain utama dan semua subdomain
        const baseDomain = cleanPattern.slice(2); // hapus "*."
        return originHostname === baseDomain || originHostname.endsWith('.' + baseDomain);
      }
      return originHostname === cleanPattern;
    });
  } catch { return false; }
}

// Cache remote node URLs untuk CORS — dihindari query DB per-request
let cachedNodeUrls = [];
const dbEmitter = require('./lib/db-events');

// Refresh cache saat startup dan saat ada perubahan di remote_nodes
async function refreshCorsNodeCache() {
  try {
    await database.init();
    const nodes = await database.getAllRemoteNodes();
    cachedNodeUrls = nodes.map(n => n.url);
  } catch { /* DB belum siap, akan di-refresh nanti */ }
}
refreshCorsNodeCache();

// Invalidate cache when remote nodes are likely to have changed
// (triggered by any setting change or can be extended for node changes)
dbEmitter.on('remoteNodesChanged', () => refreshCorsNodeCache());

// Konfigurasi CORS Dinamis untuk Federation & Web UI
const corsOptionsDelegate = (req, callback) => {
  const origin = req.headers.origin;

  // Izinkan jika tidak ada origin (seperti permintaan server-to-server atau lokal tanpa Origin header)
  if (!origin) {
    return callback(null, { origin: true, credentials: true });
  }

  try {
    const originUrl = new URL(origin);
    const hostHeader = req.get('x-forwarded-host') || req.get('host') || '';
    const currentHost = hostHeader.split(',')[0].trim().toLowerCase();
    const currentHostname = currentHost.split(':')[0];

    // 1. Izinkan jika origin sama dengan Host server saat ini (Same-Origin)
    if (currentHost && (originUrl.host.toLowerCase() === currentHost || originUrl.hostname.toLowerCase() === currentHostname)) {
      return callback(null, { origin: true, credentials: true });
    }

    // 2. Izinkan origin loopback (localhost dan 127.0.0.1)
    if (originUrl.hostname === 'localhost' || originUrl.hostname === '127.0.0.1') {
      return callback(null, { origin: true, credentials: true });
    }

    // 3. Izinkan IP lokal/private network (192.168.x.x, 10.x.x.x, 172.16-31.x.x)
    const privateIpPattern = /^(192\.168\.\d{1,3}\.\d{1,3}|10\.\d{1,3}\.\d{1,3}|172\.(1[6-9]|2\d|3[0-1])\.\d{1,3}\.\d{1,3})$/;
    if (privateIpPattern.test(originUrl.hostname)) {
      return callback(null, { origin: true, credentials: true });
    }

    // 4. Periksa whitelist dari .env (CORS_WHITELIST)
    if (isOriginWhitelisted(origin)) {
      return callback(null, { origin: true, credentials: true });
    }

    // 5. Periksa apakah origin terdaftar di cached remote_nodes
    if (cachedNodeUrls.some(url => {
      if (!url) return false;
      const cleanUrl = url.endsWith('/') ? url.slice(0, -1) : url;
      return origin === cleanUrl || origin.startsWith(cleanUrl + '/');
    })) {
      return callback(null, { origin: true, credentials: true });
    }

    // Jika bukan origin yang diizinkan untuk CORS, cukup tolak CORS tanpa melempar Error 500
    callback(null, { origin: false });
  } catch (err) {
    // Jika format URL origin tidak valid, tolak tanpa melempar Error 500
    callback(null, { origin: false });
  }
};

app.use(cors(corsOptionsDelegate));

// Middleware dasar
app.use(express.json());
app.use(express.urlencoded({ extended: false })); // Penting untuk form login

// Konfigurasi Session
app.use(session({
  store: new SQLiteStore({ db: 'nvr.db', table: 'sessions', dir: __dirname }),
  secret: config.sessionSecret, // Secret diambil dari config.js
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 7 * 24 * 60 * 60 * 1000 } // Cookie berlaku 7 hari
}));

// Inisialisasi Passport
app.use(passport.initialize());
app.use(passport.session());
initializePassport(passport);

// Gunakan rute-rute
const authRoutes = require('./routes/auth');
const pagesRoutes = require('./routes/pages');
const apiRoutes = require('./routes/api'); // Main API router

app.use('/', authRoutes);
app.use('/', pagesRoutes);
app.use('/api', apiRoutes);

// JSMpeg WebSocket Stream
// JSMpeg WebSocket Stream moved to routes/websocket.js


// Middleware untuk Cek Autentikasi
const { isAuthenticated } = require('./lib/middleware');

// Serve static files AFTER auth routes, so HTML pages require login
// Note: login page (index.html) is served via auth route, not static middleware
app.use(express.static(path.join(__dirname, 'public'), {
  setHeaders: (res, filePath) => {
    // Paksa agar HTML pemutar script (seperti go2rtc-player.html) selalu ambil terbaru
    if (filePath.endsWith('.html') || filePath.endsWith('.js') || filePath.endsWith('.css')) {
      res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
      res.setHeader('Pragma', 'no-cache');
      res.setHeader('Expires', '0');
    }
  }
}));

// Akses ke file statis yang membutuhkan autentikasi (jika ada)
app.use('/dash', isAuthenticated, express.static(path.join(__dirname, 'public', 'dash'), {
  setHeaders: (res, filePath) => {
    if (filePath.endsWith('.mpd')) {
      res.setHeader('Content-Type', 'application/dash+xml');
    } else if (filePath.endsWith('.m4s')) {
      res.setHeader('Content-Type', 'video/iso.segment');
    }
  }
}));

module.exports = app;
