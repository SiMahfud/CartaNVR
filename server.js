const express = require('express');
const http = require('http');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');
const database = require('./lib/database');
const onvifScanner = require('./lib/onvif-scanner');

// Modul untuk Autentikasi
const session = require('express-session');
const passport = require('passport');
const LocalStrategy = require('passport-local').Strategy;
const bcrypt = require('bcryptjs');

const app = express();
const server = http.createServer(app);

const PORT = process.env.PORT || 3000;

// Middleware dasar
app.use(express.json());
app.use(express.urlencoded({ extended: false })); // Penting untuk form login
app.use(express.static(path.join(__dirname, 'public')));

// Konfigurasi Session
app.use(session({
  secret: 'your-very-secret-key', // Ganti dengan secret yang lebih aman
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 7 * 24 * 60 * 60 * 1000 } // Cookie berlaku 7 hari
}));

// Inisialisasi Passport
app.use(passport.initialize());
app.use(passport.session());

// Konfigurasi Strategi Login Passport
passport.use(new LocalStrategy(
  async (username, password, done) => {
    try {
      const user = await database.findUserByUsername(username);
      if (!user) {
        return done(null, false, { message: 'Incorrect username.' });
      }
      const isMatch = await bcrypt.compare(password, user.password);
      if (!isMatch) {
        return done(null, false, { message: 'Incorrect password.' });
      }
      return done(null, user);
    } catch (err) {
      return done(err);
    }
  }
));

// Serialisasi & Deserialisasi User untuk Session
passport.serializeUser((user, done) => {
  done(null, user.id);
});

passport.deserializeUser(async (id, done) => {
  try {
    const user = await database.findUserById(id);
    done(null, user);
  } catch (err) {
    done(err);
  }
});

// Middleware untuk Cek Autentikasi
function isAuthenticated(req, res, next) {
  if (req.isAuthenticated()) {
    return next();
  }
  res.redirect('/'); // Redirect ke halaman login jika belum login
}

// === Rute Autentikasi ===

app.post('/login', passport.authenticate('local', {
  successRedirect: '/dashboard',
  failureRedirect: '/?error=1' // Redirect kembali ke login dengan pesan error
}));

app.get('/logout', (req, res, next) => {
  req.logout(function(err) {
    if (err) { return next(err); }
    res.redirect('/');
  });
});

// === Rute Halaman & API ===

// Halaman Login
app.get('/', (req, res) => {
  if (req.isAuthenticated()) {
    return res.redirect('/dashboard');
  }
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Halaman Dashboard (setelah login)
app.get('/dashboard', isAuthenticated, (req, res) => {
    // Kita perlu membuat halaman dashboard baru, untuk sekarang kita pakai player.html
    res.sendFile(path.join(__dirname, 'public', 'dashboard.html'));
});

app.get('/manage-cameras', isAuthenticated, (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'manage-cameras.html'));
});

app.get('/playback', isAuthenticated, (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'playback.html'));
});

// Lindungi semua API dengan middleware isAuthenticated
app.post('/api/scan', isAuthenticated, async (req, res) => {
  try {
    const { ipRange } = req.body;
    if (!ipRange) {
      return res.status(400).json({ error: 'ipRange is required' });
    }
    const devices = await onvifScanner.scan(ipRange);
    res.json(devices);
  } catch (error) {
    console.error('Scan failed:', error);
    res.status(500).json({ error: 'Failed to scan for devices' });
  }
});

app.get('/api/cameras', isAuthenticated, async (req, res) => {
  try {
    const cameras = await database.getAllCameras();
    res.json(cameras);
  } catch (error) {
    res.status(500).json({ error: 'Failed to retrieve cameras' });
  }
});

app.post('/api/cameras', isAuthenticated, async (req, res) => {
  try {
    const newCamera = await database.addCamera(req.body);
    res.status(201).json(newCamera);
  } catch (error) {
    res.status(500).json({ error: 'Failed to add camera' });
  }
});

app.put('/api/cameras/:id', isAuthenticated, async (req, res) => {
  try {
    const updatedCamera = await database.updateCamera(req.params.id, req.body);
    res.json(updatedCamera);
  } catch (error) {
    console.error('Update failed:', error);
    res.status(500).json({ error: 'Failed to update camera' });
  }
});

app.delete('/api/cameras/:id', isAuthenticated, async (req, res) => {
  try {
    await database.deleteCamera(req.params.id);
    res.status(204).send();
  } catch (error) {
    console.error('Delete failed:', error);
    res.status(500).json({ error: 'Failed to delete camera' });
  }
});

app.get('/api/playback/:cameraId', isAuthenticated, async (req, res) => {
  try {
    const cameraId = req.params.cameraId.replace('cam_', '');
    const now = new Date();
    const defaultStart = new Date(now.getTime() - (24 * 60 * 60 * 1000));
    const startTime = req.query.start ? new Date(req.query.start).getTime() : defaultStart.getTime();
    const endTime = req.query.end ? new Date(req.query.end).getTime() : now.getTime();

    if (isNaN(startTime) || isNaN(endTime)) {
      return res.status(400).json({ error: 'Invalid date format for start or end time.' });
    }

    const segments = await database.getRecordings(cameraId, startTime, endTime);
    res.json(segments);

  } catch (err) {
    console.error("Server error fetching playback from DB:", err);
    res.status(500).json({ error: 'Failed to read recordings from database' });
  }
});

// Akses ke file statis yang membutuhkan autentikasi (jika ada)
app.use('/hls', isAuthenticated, express.static(path.join(__dirname, 'public', 'hls'), {
  setHeaders: (res, filePath) => {
    if (filePath.endsWith('.m3u8')) {
      res.setHeader('Content-Type', 'application/vnd.apple.mpegurl');
    } else if (filePath.endsWith('.ts')) {
      res.setHeader('Content-Type', 'video/mp2t');
    }
  }
}));
app.use('/recordings', isAuthenticated, express.static(path.join(__dirname, 'recordings')));

// === Mulai Server & Buat Admin Default ===
const recorder = require('./recorder');

async function initialize() {
  // Buat user admin default jika belum ada
  try {
    const admin = await database.findUserByUsername('admin');
    if (!admin) {
      console.log('Creating default admin user...');
      await database.createUser({ username: 'admin', password: 'smacampurdarat' });
      console.log('Default admin user created. Username: admin, Password: smacampurdarat');
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
