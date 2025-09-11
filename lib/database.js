// lib/database.js

const sqlite3 = require('sqlite3').verbose();
const bcrypt = require('bcryptjs');
const db = new sqlite3.Database('./cctv.db');

db.serialize(() => {
  // Tabel untuk user
  db.run(`CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT NOT NULL UNIQUE,
    password TEXT NOT NULL
  )`);

  // Tabel untuk lokasi penyimpanan
  db.run(`CREATE TABLE IF NOT EXISTS storages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    path TEXT NOT NULL UNIQUE,
    max_gb INTEGER NOT NULL
  )`);

  // Tabel untuk kamera
  db.run(`CREATE TABLE IF NOT EXISTS cameras (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    ip_address TEXT NOT NULL,
    rtsp_url TEXT NOT NULL,
    recording_path TEXT, -- Deprecated, will be replaced by storage_id
    storage_id INTEGER,
    FOREIGN KEY(storage_id) REFERENCES storages(id) ON DELETE SET NULL
  )`);

  // Tabel untuk menyimpan metadata rekaman
  db.run(`CREATE TABLE IF NOT EXISTS recordings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    camera_id INTEGER NOT NULL,
    file_path TEXT NOT NULL UNIQUE,
    timestamp INTEGER NOT NULL,
    duration REAL NOT NULL,
    FOREIGN KEY(camera_id) REFERENCES cameras(id) ON DELETE CASCADE
  )`);

  // Index untuk mempercepat query
  db.run(`CREATE INDEX IF NOT EXISTS idx_recordings_timestamp ON recordings(timestamp)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_recordings_camera_id ON recordings(camera_id)`);

  // Add storage_id column to cameras table if it doesn't exist (for migration)
  db.all("PRAGMA table_info(cameras)", (err, columns) => {
    if (err) {
      console.error("Error checking cameras table columns:", err);
      return;
    }
    const hasStorageId = columns.some(col => col.name === 'storage_id');
    if (!hasStorageId) {
      db.run('ALTER TABLE cameras ADD COLUMN storage_id INTEGER REFERENCES storages(id) ON DELETE SET NULL', (err) => {
        if(err) console.error("Error adding storage_id column to cameras:", err);
      });
    }
  });
});

// --- Fungsi untuk User ---

function findUserByUsername(username) {
  return new Promise((resolve, reject) => {
    db.get('SELECT * FROM users WHERE username = ?', [username], (err, row) => {
      if (err) return reject(err);
      resolve(row);
    });
  });
}

function findUserById(id) {
  return new Promise((resolve, reject) => {
    db.get('SELECT * FROM users WHERE id = ?', [id], (err, row) => {
      if (err) return reject(err);
      resolve(row);
    });
  });
}

function createUser(user) {
  return new Promise((resolve, reject) => {
    bcrypt.hash(user.password, 10, (err, hashedPassword) => {
      if (err) return reject(err);
      const stmt = db.prepare('INSERT INTO users (username, password) VALUES (?, ?)');
      stmt.run(user.username, hashedPassword, function(err) {
        if (err) return reject(err);
        resolve({ id: this.lastID, username: user.username });
      });
      stmt.finalize();
    });
  });
}

// --- Fungsi untuk Storage ---

function getAllStorages() {
  return new Promise((resolve, reject) => {
    db.all('SELECT * FROM storages ORDER BY name ASC', [], (err, rows) => {
      if (err) return reject(err);
      resolve(rows);
    });
  });
}

function addStorage(storage) {
  return new Promise((resolve, reject) => {
    const { name, path, max_gb } = storage;
    db.run('INSERT INTO storages (name, path, max_gb) VALUES (?, ?, ?)', [name, path, max_gb], function(err) {
      if (err) return reject(err);
      resolve({ id: this.lastID, ...storage });
    });
  });
}

function updateStorage(id, storage) {
  return new Promise((resolve, reject) => {
    const { name, path, max_gb } = storage;
    db.run('UPDATE storages SET name = ?, path = ?, max_gb = ? WHERE id = ?', [name, path, max_gb, id], function(err) {
      if (err) return reject(err);
      resolve({ id, ...storage });
    });
  });
}

function deleteStorage(id) {
  return new Promise((resolve, reject) => {
    db.run('DELETE FROM storages WHERE id = ?', [id], function(err) {
      if (err) return reject(err);
      resolve({ id });
    });
  });
}


// --- Fungsi untuk rekaman ---

function addRecording(recording) {
  return new Promise((resolve, reject) => {
    const { camera_id, file_path, timestamp, duration } = recording;
    const stmt = db.prepare('INSERT OR IGNORE INTO recordings (camera_id, file_path, timestamp, duration) VALUES (?, ?, ?, ?)');
    stmt.run(camera_id, file_path, timestamp, duration, function(err) {
      if (err) {
        return reject(err);
      }
      resolve({ id: this.lastID, ...recording });
    });
    stmt.finalize();
  });
}

function getRecordings(cameraId, startTime, endTime) {
    return new Promise((resolve, reject) => {
        const query = `
            SELECT file_path as file, timestamp, duration 
            FROM recordings 
            WHERE camera_id = ? AND timestamp >= ? AND timestamp <= ?
            ORDER BY timestamp ASC
        `;
        db.all(query, [cameraId, startTime, endTime], (err, rows) => {
            if (err) {
                return reject(err);
            }
            const formattedRows = rows.map(row => ({
                ...row,
                file: row.file
            }));
            resolve(formattedRows);
        });
    });
}

function getRecordingsByCameraId(cameraId) {
  return new Promise((resolve, reject) => {
    const sql = 'SELECT file_path FROM recordings WHERE camera_id = ?';
    db.all(sql, [cameraId], (err, rows) => {
      if (err) {
        console.error('Error fetching recordings by camera ID', err);
        return reject(err);
      }
      resolve(rows);
    });
  });
}

function deleteRecordingByPath(filePath) {
    return new Promise((resolve, reject) => {
        db.run('DELETE FROM recordings WHERE file_path = ?', [filePath], function(err) {
            if (err) {
                return reject(err);
            }
            resolve({ deleted: this.changes });
        });
    });
}


// --- Fungsi untuk kamera ---

function getAllCameras() {
  return new Promise((resolve, reject) => {
    db.all('SELECT c.*, s.name as storage_name, s.path as storage_path FROM cameras c LEFT JOIN storages s ON c.storage_id = s.id ORDER BY c.name ASC', [], (err, rows) => {
      if (err) {
        reject(err);
        return;
      }
      resolve(rows);
    });
  });
}

function addCamera(camera) {
  return new Promise((resolve, reject) => {
    const { name, ip_address, rtsp_url, storage_id } = camera;
    db.run('INSERT INTO cameras (name, ip_address, rtsp_url, storage_id) VALUES (?, ?, ?, ?)', [name, ip_address, rtsp_url, storage_id], function(err) {
      if (err) {
        reject(err);
        return;
      }
      resolve({ id: this.lastID, ...camera });
    });
  });
}

function getCameraById(id) {
    return new Promise((resolve, reject) => {
        db.get('SELECT c.*, s.name as storage_name, s.path as storage_path FROM cameras c LEFT JOIN storages s ON c.storage_id = s.id WHERE c.id = ?', [id], (err, row) => {
            if (err) {
                reject(err);
                return;
            }
            resolve(row);
        });
    });
}

function updateCamera(id, camera) {
  return new Promise((resolve, reject) => {
    const { name, rtsp_url, storage_id } = camera;
    db.run('UPDATE cameras SET name = ?, rtsp_url = ?, storage_id = ? WHERE id = ?', [name, rtsp_url, storage_id, id], function(err) {
      if (err) {
        reject(err);
        return;
      }
      resolve({ id, ...camera });
    });
  });
}

function deleteCamera(id) {
  return new Promise((resolve, reject) => {
    db.run('DELETE FROM cameras WHERE id = ?', [id], function(err) {
      if (err) {
        reject(err);
        return;
      }
      resolve({ id });
    });
  });
}

module.exports = {
    // User functions
    findUserByUsername,
    findUserById,
    createUser,
    // Storage functions
    getAllStorages,
    addStorage,
    updateStorage,
    deleteStorage,
    // Camera functions
    getAllCameras,
    addCamera,
    getCameraById,
    updateCamera,
    deleteCamera,
    // Recording functions
    addRecording,
    getRecordings,
    deleteRecordingByPath,
    getRecordingsByCameraId,
};