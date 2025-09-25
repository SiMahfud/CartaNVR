const express = require('express');
const http = require('http');
const path = require('path');
const fs = require('fs');
const fsp = fs.promises;
const { spawn, exec } = require('child_process');
const database = require('./lib/database');
const onvifScanner = require('./lib/onvif-scanner');
const { sanitizeCamId } = require('./lib/utils');
const config = require('./lib/config'); // Load config

// Modul untuk Autentikasi
const session = require('express-session');
const SQLiteStore = require('connect-sqlite3')(session);
const passport = require('passport');
const LocalStrategy = require('passport-local').Strategy;
const bcrypt = require('bcryptjs');

const app = express();
const server = http.createServer(app);

const PORT = process.env.PORT || 3000;

// Middleware dasar
app.use(express.json());
app.use(express.urlencoded({ extended: false })); // Penting untuk form login

// Konfigurasi Session
app.use(session({
  store: new SQLiteStore({ db: 'nvr.db', table: 'sessions', dir: __dirname }),
  secret: 'your-very-secret-key', // Ganti dengan secret yang lebih aman
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 7 * 24 * 60 * 60 * 1000 } // Cookie berlaku 7 hari
}));

// Inisialisasi Passport
app.use(passport.initialize());
app.use(passport.session());

// Rute untuk Halaman Login (harus sebelum express.static)
app.get('/', (req, res) => {
  if (req.isAuthenticated()) {
    return res.redirect('/dashboard');
  }
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.use(express.static(path.join(__dirname, 'public')));

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

app.get('/settings', isAuthenticated, (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'settings.html'));
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

// === Rute untuk Kamera ===
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

// === Rute untuk Storage ===

app.get('/api/storages', isAuthenticated, async (req, res) => {
  try {
    const storages = await database.getAllStorages();
    res.json(storages);
  } catch (error) {
    res.status(500).json({ error: 'Failed to retrieve storages' });
  }
});

app.post('/api/storages', isAuthenticated, async (req, res) => {
  try {
    const newStorage = await database.addStorage(req.body);
    res.status(201).json(newStorage);
  } catch (error) {
    res.status(500).json({ error: 'Failed to add storage' });
  }
});

app.put('/api/storages/:id', isAuthenticated, async (req, res) => {
  try {
    const updatedStorage = await database.updateStorage(req.params.id, req.body);
    res.json(updatedStorage);
  } catch (error) {
    console.error('Update failed:', error);
    res.status(500).json({ error: 'Failed to update storage' });
  }
});

app.delete('/api/storages/:id', isAuthenticated, async (req, res) => {
  try {
    await database.deleteStorage(req.params.id);
    res.status(204).send();
  } catch (error) {
    console.error('Delete failed:', error);
    res.status(500).json({ error: 'Failed to delete storage' });
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

app.get('/api/config', isAuthenticated, (req, res) => {
  delete require.cache[require.resolve('./lib/config')];
  const config = require('./lib/config');
  res.json(config);
});

app.post('/api/config', isAuthenticated, async (req, res) => {
  const configPath = path.join(__dirname, 'lib', 'config.json');
  
  // 1. Get old config by requiring it (it will be cached)
  const oldConfig = require('./lib/config');
  const oldServiceName = oldConfig.pm2_service_name;

  try {
    const newConfig = req.body;
    const newServiceName = newConfig.pm2_service_name;

    // Read existing user config from file to merge
    let existingConfig = {};
    if (fs.existsSync(configPath)) {
      const rawData = fs.readFileSync(configPath);
      existingConfig = JSON.parse(rawData);
    }

    // 2. Save the new config to file
    const updatedConfig = { ...existingConfig, ...newConfig };
    fs.writeFileSync(configPath, JSON.stringify(updatedConfig, null, 2));
    
    // Clear require cache to ensure next require gets the new version
    delete require.cache[require.resolve('./lib/config')];
    
    // 3. Check if service name has changed and handle PM2 restart
    if (newServiceName && oldServiceName && newServiceName !== oldServiceName) {
      console.log(`PM2 service name changed from "${oldServiceName}" to "${newServiceName}". Restarting service...`);
      
      // Use `pm2 delete` which stops and removes. Add `|| true` so the command doesn't fail if the old service doesn't exist.
      const restartCommand = `(pm2 delete "${oldServiceName}" || true) && pm2 start server.js --name "${newServiceName}"`;
      
      console.log(`Executing: ${restartCommand}`);

      exec(restartCommand, { windowsHide: true }, (error, stdout, stderr) => {
        if (error) {
          console.error(`Failed to restart PM2 service: ${error.message}`);
        }
        if (stdout) console.log('PM2 restart command stdout:', stdout);
        if (stderr) console.warn('PM2 restart command stderr:', stderr);
      });

      // Respond immediately, the restart happens in the background
      return res.status(200).json({ message: 'Config updated. Application is restarting with the new PM2 service name.' });

    } else {
      return res.status(200).json({ message: 'Config updated successfully.' });
    }

  } catch (error) {
    console.error('Failed to save config:', error);
    // Important: clear cache again in case of error so we don't have a corrupted config state
    delete require.cache[require.resolve('./lib/config')];
    return res.status(500).json({ error: 'Failed to save config' });
  }
});

app.get('/api/browse', isAuthenticated, (req, res) => {
    const isWindows = process.platform === 'win32';
    let currentPath = req.query.path;
    console.log(`Browsing path: ${currentPath}`);

    if (!currentPath) {
        if (isWindows) {
            console.log('No path, listing drives (Windows)');
            exec('wmic logicaldisk get name', { windowsHide: true }, (err, stdout) => {
                if (err) {
                    console.error('Error getting drives:', err);
                    return res.status(500).json({ error: 'Failed to get drives' });
                }
                const drives = stdout.split('\r\n').slice(1).map(line => line.trim()).filter(line => line.length > 0).map(drive => ({
                    name: drive,
                    path: drive + '\\'
                }));
                res.json({
                    currentPath: 'Computer',
                    parentDir: null,
                    isRoot: true,
                    directories: drives
                });
            });
            return;
        } else {
            console.log('No path, starting at / (Linux/macOS)');
            currentPath = '/';
        }
    }

    try {
        console.log(`Reading directory: ${currentPath}`);
        const files = fs.readdirSync(currentPath, { withFileTypes: true });
        const directories = files
            .filter(dirent => dirent.isDirectory())
            .map(dirent => ({
                name: dirent.name,
                path: path.join(currentPath, dirent.name)
            }));

        const parent = path.resolve(currentPath, '..');
        const isDriveRoot = isWindows && /^[A-Z]:\\?$/.test(currentPath);

        res.json({
            currentPath,
            parentDir: isDriveRoot ? '' : parent,
            isRoot: false,
            directories
        });
    } catch (error) {
        console.error('Error browsing path:', error);
        if (error.code === 'ENOENT') {
            console.log('Path not found, redirecting to root');
            res.redirect(`/api/browse`);
        } else {
            res.status(500).json({ error: 'Failed to browse path' });
        }
    }
});

// === Rute untuk Maintenance ===
app.post('/api/maintenance/reboot', isAuthenticated, (req, res) => {
    const serviceName = config.pm2_service_name || 'nvr';
    const command = `pm2 restart "${serviceName}"`;

    // Respond to the client immediately
    res.status(200).json({ message: 'Application reboot initiated.' });

    // Execute the restart command in the background
    exec(command, { windowsHide: true }, (error, stdout, stderr) => {
        if (error) {
            console.error(`Error rebooting application: ${error.message}`);
            // This happens in the background, so we just log it.
        }
        if (stderr) {
            console.warn(`Reboot command stderr: ${stderr}`);
        }
        console.log(`Reboot command stdout: ${stdout}`);
    });
});

app.post('/api/maintenance/flush-logs', isAuthenticated, (req, res) => {
    const command = `pm2 flush "${config.pm2_service_name}"`;

    exec(command, { windowsHide: true }, (error, stdout, stderr) => {
        if (error) {
            console.error(`Error flushing logs: ${error.message}`);
            return res.status(500).json({ message: `Failed to flush logs: ${error.message}` });
        }
        if (stderr) {
            console.warn(`Flush logs command stderr: ${stderr}`);
        }
        console.log(`Flush logs command stdout: ${stdout}`);
        res.status(200).json({ message: 'PM2 logs flushed successfully.' });
    });
});

app.get('/api/maintenance/logs', isAuthenticated, (req, res) => {
    const lines = req.query.lines || 200;
    // --nostream is crucial to prevent the command from hanging
    const command = `pm2 logs "${config.pm2_service_name}" --lines ${lines} --nostream`;

    exec(command, { windowsHide: true }, (error, stdout, stderr) => {
        if (error) {
            console.error(`Error fetching logs: ${error.message}`);
            // Even if the command fails, stderr might have useful info (e.g., "process not found")
            return res.status(500).json({ logs: stderr || '' });
        }
        // PM2 logs command often outputs to both stdout and stderr, so we combine them.
        res.status(200).json({ logs: stdout + stderr });
    });
});

app.post('/api/maintenance/update', isAuthenticated, (req, res) => {
    // Menjalankan git pull
    const command = `git pull`;

    console.log(`Executing update command: ${command}`);

    exec(command, { windowsHide: true }, (error, stdout, stderr) => {
        const output = stdout + stderr;
        if (error) {
            console.error(`Update command failed: ${error.message}`);
            return res.status(500).json({ message: `Update failed: ${error.message}`, output });
        }
        console.log(`Update command output: ${output}`);
        res.status(200).json({ message: 'Application update initiated successfully. The service need to restart restart.', output });
    });
});

app.post('/api/maintenance/run-script', isAuthenticated, (req, res) => {
    // PERINGATAN: Endpoint ini menjalankan perintah dengan sudo.
    // Pastikan Anda telah mengkonfigurasi /etc/sudoers dengan benar di server Anda
    // agar pengguna yang menjalankan Node.js dapat menjalankan skrip ini tanpa password.
    const scriptPath = '/opt/nvr/maintenance.sh'; // Ganti dengan path skrip Anda yang sebenarnya
    const command = `sudo ${scriptPath}`;

    console.log(`Executing maintenance script: ${command}`);

    exec(command, { windowsHide: true }, (error, stdout, stderr) => {
        const output = stdout + stderr;
        if (error) {
            console.error(`Maintenance script failed: ${error.message}`);
            return res.status(500).json({ message: `Maintenance script failed: ${error.message}`, output });
        }
        console.log(`Maintenance script output: ${output}`);
        res.status(200).json({ message: 'Maintenance script executed successfully.', output });
    });
});

app.post('/api/maintenance/delete-all-recordings', isAuthenticated, async (req, res) => {
    console.log('Received request to delete all recordings.');
    try {
        let deletedFiles = 0;
        const storages = await database.getAllStorages();

        for (const storage of storages) {
            if (!fs.existsSync(storage.path)) {
                console.warn(`Storage path not found, skipping: ${storage.path}`);
                continue;
            }

            const cameraDirs = await fsp.readdir(storage.path);
            for (const camDirName of cameraDirs) {
                if (!camDirName.startsWith('cam_')) continue;
                
                const camDirPath = path.join(storage.path, camDirName);
                try {
                    const stats = await fsp.stat(camDirPath);
                    if (!stats.isDirectory()) continue;

                    const files = await fsp.readdir(camDirPath);
                    for (const file of files) {
                        if (file.endsWith('.mp4')) {
                            const filePath = path.join(camDirPath, file);
                            try {
                                await fsp.unlink(filePath);
                                deletedFiles++;
                            } catch (fileErr) {
                                console.error(`Failed to delete file: ${filePath}`, fileErr);
                            }
                        }
                    }
                } catch (dirErr) {
                     console.error(`Failed to process directory: ${camDirPath}`, dirErr);
                }
            }
        }

        const dbResult = await database.deleteAllRecordingsFromDB();
        console.log(`Deleted ${deletedFiles} file(s) and ${dbResult.deleted} DB entries.`);
        res.status(200).json({ message: `Successfully deleted ${deletedFiles} recording(s) and cleared the database.` });

    } catch (error) {
        console.error('Error deleting all recordings:', error);
        res.status(500).json({ message: `Failed to delete all recordings: ${error.message}` });
    }
});

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

app.get('/recordings/:cameraId/:filename', isAuthenticated, async (req, res) => {
    try {
        const { cameraId, filename } = req.params;
        const camId = sanitizeCamId(cameraId.replace('cam_', ''));
        const camera = await database.getCameraById(camId);
        if (!camera || !camera.storage_path) {
            return res.status(404).send('Camera or storage not found');
        }
        const filePath = path.join(camera.storage_path, `cam_${camId}`, filename);
        if (fs.existsSync(filePath)) {
            res.sendFile(filePath);
        } else {
            res.status(404).send('File not found');
        }
    } catch (error) {
        console.error('Error serving recording:', error);
        res.status(500).send('Server error');
    }
});

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
