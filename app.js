const express = require('express');
const path = require('path');
const config = require('./lib/config');

// Modul untuk Autentikasi
const session = require('express-session');
const SQLiteStore = require('connect-sqlite3')(session);
const passport = require('passport');
const initializePassport = require('./lib/passport-config');

const app = express();

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
