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
// StreamRelay initialization moved to server.js


// Parse CORS whitelist dari .env (comma-separated, support wildcard *.domain.com)
const corsWhitelist = (process.env.CORS_WHITELIST || '')
  .split(',')
  .map(s => s.trim())
  .filter(Boolean);

function isOriginWhitelisted(origin) {
  try {
    const hostname = new URL(origin).hostname;
    return corsWhitelist.some(pattern => {
      if (pattern.startsWith('*.')) {
        // Wildcard: cocokkan domain utama dan semua subdomain
        const baseDomain = pattern.slice(2); // hapus "*."
        return hostname === baseDomain || hostname.endsWith('.' + baseDomain);
      }
      return hostname === pattern;
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

// Konfigurasi CORS Dinamis untuk Federation
const corsOptions = {
  origin: (origin, callback) => {
    // Izinkan jika tidak ada origin (seperti permintaan server-to-server atau lokal)
    if (!origin) return callback(null, true);

    try {
      // Izinkan origin sendiri (local loopback dan hostname saat ini)
      if (origin.includes('localhost') || origin.includes('127.0.0.1')) {
        return callback(null, true);
      }

      // Izinkan IP lokal/private network (192.168.x.x, 10.x.x.x, 172.16-31.x.x)
      const privateIpPattern = /^https?:\/\/(192\.168\.\d{1,3}\.\d{1,3}|10\.\d{1,3}\.\d{1,3}\.\d{1,3}|172\.(1[6-9]|2\d|3[0-1])\.\d{1,3}\.\d{1,3})(:\d+)?/;
      if (privateIpPattern.test(origin)) {
        return callback(null, true);
      }

      // Periksa whitelist dari .env (CORS_WHITELIST)
      if (isOriginWhitelisted(origin)) {
        return callback(null, true);
      }

      // Periksa apakah origin terdaftar di cached remote_nodes
      if (cachedNodeUrls.some(url => origin.startsWith(url))) {
        return callback(null, true);
      }

      // Jika tidak cocok, tolak
      callback(new Error('Not allowed by CORS'));
    } catch (err) {
      callback(err);
    }
  },
  credentials: true
};

app.use(cors(corsOptions));

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
  // Only serve JS, CSS, and asset files without auth
  // HTML files are served via explicit authenticated routes
  setHeaders: (res, filePath) => {
    // Allow caching of static assets
    if (filePath.endsWith('.js') || filePath.endsWith('.css')) {
      res.setHeader('Cache-Control', 'public, max-age=3600');
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
