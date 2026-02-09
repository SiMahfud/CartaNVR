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

// Konfigurasi CORS Dinamis untuk Federation
const corsOptions = {
  origin: async (origin, callback) => {
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

      // Periksa apakah origin terdaftar di remote_nodes
      await database.init();
      const remoteNodes = await database.getAllRemoteNodes();
      if (remoteNodes.some(node => origin.startsWith(node.url))) {
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

app.use(express.static(path.join(__dirname, 'public')));

// Middleware untuk Cek Autentikasi
const { isAuthenticated } = require('./lib/middleware');

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
