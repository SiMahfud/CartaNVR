const sqlite3 = require('sqlite3').verbose();
const db = new sqlite3.Database('./cctv.db');

db.serialize(() => {
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

  // Index untuk mempercepat query berdasarkan waktu
  db.run(`CREATE INDEX IF NOT EXISTS idx_recordings_timestamp ON recordings(timestamp)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_recordings_camera_id ON recordings(camera_id)`);
});

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
            // Ubah nama kolom agar sesuai dengan format yang diharapkan frontend
            const formattedRows = rows.map(row => ({
                ...row,
                file: row.file // Frontend mengharapkan 'file' bukan 'file_path'
            }));
            resolve(formattedRows);
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


// --- Fungsi untuk kamera (tetap sama) ---

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
    getAllCameras,
    addCamera,
    getCameraById,
    updateCamera,
    deleteCamera,
    addRecording,
    getRecordings,
    deleteRecordingByPath
};