const express = require('express');
const http = require('http');
const path = require('path');
const database = require('./lib/database');
const { sanitizeCamId } = require('./lib/utils');
const config = require('./lib/config'); // Load config

// Modul untuk Autentikasi
const session = require('express-session');
const SQLiteStore = require('connect-sqlite3')(session);
const passport = require('passport');
const initializePassport = require('./lib/passport-config');

const app = express();
const server = http.createServer(app);

const PORT = process.env.PORT || 3000;

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



// === Mulai Server & Buat Admin Default ===
const recorder = require('./recorder');

async function initialize() {
  // Buat user admin default jika belum ada
  try {
    const admin = await database.findUserByUsername(config.defaultAdminUser);
    if (!admin) {
      console.log(`Creating default admin user '${config.defaultAdminUser}'...`);
      await database.createUser({ username: config.defaultAdminUser, password: config.defaultAdminPassword });
      console.log(`Default admin user '${config.defaultAdminUser}' created with the default password.`);
      console.log('Please change this password after your first login!');
    }
  } catch (err) {
    console.error('Error creating default admin:', err);
  }

  server.listen(PORT, () => {
    console.log(`Server is running on http://localhost:${PORT}`);
    // Pindahkan start recording ke sini agar admin user sudah siap
    recorder.startAllRecordings();
  });
}

initialize();
