// lib/database.js

const sqlite3 = require('sqlite3').verbose();
const bcrypt = require('bcryptjs');
const db = new sqlite3.Database('./cctv.db');

db.serialize(() => {
  // Tabel untuk kamera
  db.run(`CREATE TABLE IF NOT EXISTS cameras (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    ip_address TEXT NOT NULL,
    rtsp_url TEXT NOT NULL
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
  
  // Tabel untuk user
  db.run(`CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT NOT NULL UNIQUE,
    password TEXT NOT NULL
  )`);

  // Index untuk mempercepat query
  db.run(`CREATE INDEX IF NOT EXISTS idx_recordings_timestamp ON recordings(timestamp)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_recordings_camera_id ON recordings(camera_id)`);
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

/**
 * [FUNGSI BARU DITAMBAHKAN DI SINI]
 * Fungsi ini dibutuhkan oleh recorder.js untuk melakukan sinkronisasi satu kali saat startup.
 */
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
    db.all('SELECT * FROM cameras ORDER BY name ASC', [], (err, rows) => {
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
    const { name, ip_address, rtsp_url } = camera;
    db.run('INSERT INTO cameras (name, ip_address, rtsp_url) VALUES (?, ?, ?)', [name, ip_address, rtsp_url], function(err) {
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
        db.get('SELECT * FROM cameras WHERE id = ?', [id], (err, row) => {
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
    const { name, rtsp_url } = camera;
    db.run('UPDATE cameras SET name = ?, rtsp_url = ? WHERE id = ?', [name, rtsp_url, id], function(err) {
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
    getRecordingsByCameraId, // <-- PASTIKAN FUNGSI BARU DI-EXPORT
};