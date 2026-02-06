// lib/database.js

const sqlite3 = require('sqlite3').verbose();
const mysql = require('mysql2/promise');
const bcrypt = require('bcryptjs');
const config = require('./config');

let db;
let isMysql = config.DB_TYPE === 'mysql';

async function init() {
  if (isMysql) {
    db = await mysql.createPool(config.MYSQL_CONFIG);
    
    // MySQL Initial Schema
    await db.execute(`CREATE TABLE IF NOT EXISTS users (
      id INT AUTO_INCREMENT PRIMARY KEY,
      username VARCHAR(255) NOT NULL UNIQUE,
      password VARCHAR(255) NOT NULL
    )`);

    await db.execute(`CREATE TABLE IF NOT EXISTS storages (
      id INT AUTO_INCREMENT PRIMARY KEY,
      name VARCHAR(255) NOT NULL,
      path VARCHAR(255) NOT NULL UNIQUE,
      max_gb INT NOT NULL
    )`);

    await db.execute(`CREATE TABLE IF NOT EXISTS cameras (
      id INT AUTO_INCREMENT PRIMARY KEY,
      name VARCHAR(255) NOT NULL,
      ip_address VARCHAR(255) NOT NULL,
      rtsp_url VARCHAR(255) NOT NULL,
      storage_id INT,
      is_hevc TINYINT(1) DEFAULT 0,
      enabled TINYINT(1) DEFAULT 1
    )`);

    // MySQL Migration
    const [columns] = await db.execute("SHOW COLUMNS FROM cameras LIKE 'enabled'");
    if (columns.length === 0) {
      await db.execute("ALTER TABLE cameras ADD COLUMN enabled TINYINT(1) DEFAULT 1");
    }

    await db.execute(`CREATE TABLE IF NOT EXISTS recordings (
      id INT AUTO_INCREMENT PRIMARY KEY,
      camera_id INT NOT NULL,
      file_path VARCHAR(255) NOT NULL UNIQUE,
      timestamp BIGINT NOT NULL,
      duration FLOAT NOT NULL,
      INDEX idx_recordings_timestamp (timestamp),
      INDEX idx_recordings_camera_id (camera_id)
    )`);

    await db.execute(`CREATE TABLE IF NOT EXISTS settings (
      setting_key VARCHAR(255) PRIMARY KEY,
      setting_value TEXT
    )`);
  } else {
    const dbFile = process.env.DB_FILE || (process.env.NODE_ENV === 'test' ? './nvr_test.db' : './nvr.db');
    db = new sqlite3.Database(dbFile);
    db.serialize(() => {
      db.run(`CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT NOT NULL UNIQUE,
        password TEXT NOT NULL
      )`);
      db.run(`CREATE TABLE IF NOT EXISTS storages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        path TEXT NOT NULL UNIQUE,
        max_gb INTEGER NOT NULL
      )`);
      db.run(`CREATE TABLE IF NOT EXISTS cameras (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        ip_address TEXT NOT NULL,
        rtsp_url TEXT NOT NULL,
        storage_id INTEGER,
        is_hevc BOOLEAN DEFAULT 0,
        enabled BOOLEAN DEFAULT 1,
        FOREIGN KEY(storage_id) REFERENCES storages(id) ON DELETE SET NULL
      )`);
      db.run(`CREATE TABLE IF NOT EXISTS recordings (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        camera_id INTEGER NOT NULL,
        file_path TEXT NOT NULL UNIQUE,
        timestamp INTEGER NOT NULL,
        duration REAL NOT NULL,
        FOREIGN KEY(camera_id) REFERENCES cameras(id) ON DELETE CASCADE
      )`);
      db.run(`CREATE INDEX IF NOT EXISTS idx_recordings_timestamp ON recordings(timestamp)`);
      db.run(`CREATE INDEX IF NOT EXISTS idx_recordings_camera_id ON recordings(camera_id)`);

      db.run(`CREATE TABLE IF NOT EXISTS settings (
        setting_key TEXT PRIMARY KEY,
        setting_value TEXT
      )`);

      // Migrations for SQLite
      db.all("PRAGMA table_info(cameras)", (err, columns) => {
        if (!err && columns) {
          if (!columns.some(col => col.name === 'storage_id')) {
            db.run('ALTER TABLE cameras ADD COLUMN storage_id INTEGER REFERENCES storages(id) ON DELETE SET NULL');
          }
          if (!columns.some(col => col.name === 'is_hevc')) {
            db.run('ALTER TABLE cameras ADD COLUMN is_hevc BOOLEAN DEFAULT 0');
          }
          if (!columns.some(col => col.name === 'enabled')) {
            db.run('ALTER TABLE cameras ADD COLUMN enabled BOOLEAN DEFAULT 1');
          }
        }
      });
    });
  }
}

// Initialize immediately
init().catch(err => console.error('Database initialization failed:', err));

// --- Helper for queries ---
async function runQuery(sql, params = []) {
  if (isMysql) {
    const [rows] = await db.execute(sql, params);
    return rows;
  } else {
    return new Promise((resolve, reject) => {
      db.all(sql, params, (err, rows) => {
        if (err) reject(err);
        else resolve(rows);
      });
    });
  }
}

async function runGet(sql, params = []) {
  if (isMysql) {
    const [rows] = await db.execute(sql, params);
    return rows[0] || null;
  } else {
    return new Promise((resolve, reject) => {
      db.get(sql, params, (err, row) => {
        if (err) reject(err);
        else resolve(row);
      });
    });
  }
}

async function runInsert(sql, params = []) {
  if (isMysql) {
    const [result] = await db.execute(sql, params);
    return result.insertId;
  } else {
    return new Promise((resolve, reject) => {
      db.run(sql, params, function(err) {
        if (err) reject(err);
        else resolve(this.lastID);
      });
    });
  }
}

async function runUpdate(sql, params = []) {
    if (isMysql) {
        const [result] = await db.execute(sql, params);
        return result.affectedRows;
    } else {
        return new Promise((resolve, reject) => {
            db.run(sql, params, function(err) {
                if (err) reject(err);
                else resolve(this.changes);
            });
        });
    }
}

// --- Fungsi untuk User ---

async function findUserByUsername(username) {
  return runGet('SELECT * FROM users WHERE username = ?', [username]);
}

async function findUserById(id) {
  return runGet('SELECT * FROM users WHERE id = ?', [id]);
}

async function createUser(user) {
  const hashedPassword = await bcrypt.hash(user.password, 10);
  const id = await runInsert('INSERT INTO users (username, password) VALUES (?, ?)', [user.username, hashedPassword]);
  return { id, username: user.username };
}

// --- Fungsi untuk Storage ---

async function getAllStorages() {
  return runQuery('SELECT * FROM storages ORDER BY name ASC');
}

async function addStorage(storage) {
  const { name, path, max_gb } = storage;
  const id = await runInsert('INSERT INTO storages (name, path, max_gb) VALUES (?, ?, ?)', [name, path, max_gb]);
  return { id, ...storage };
}

async function updateStorage(id, storage) {
  const { name, path, max_gb } = storage;
  await runUpdate('UPDATE storages SET name = ?, path = ?, max_gb = ? WHERE id = ?', [name, path, max_gb, id]);
  return { id, ...storage };
}

async function deleteStorage(id) {
  await runUpdate('DELETE FROM storages WHERE id = ?', [id]);
  return { id };
}

// --- Fungsi untuk rekaman ---

async function addRecording(recording) {
  const { camera_id, file_path, timestamp, duration } = recording;
  const sql = isMysql 
    ? 'INSERT IGNORE INTO recordings (camera_id, file_path, timestamp, duration) VALUES (?, ?, ?, ?)'
    : 'INSERT OR IGNORE INTO recordings (camera_id, file_path, timestamp, duration) VALUES (?, ?, ?, ?)';
  
  const id = await runInsert(sql, [camera_id, file_path, timestamp, duration]);
  return { id, ...recording };
}

async function getRecordings(cameraId, startTime, endTime) {
  const query = `
      SELECT file_path as file, timestamp, duration 
      FROM recordings 
      WHERE camera_id = ? AND timestamp >= ? AND timestamp <= ?
      ORDER BY timestamp ASC
  `;
  const rows = await runQuery(query, [cameraId, startTime, endTime]);
  return rows.map(row => {
      const pathParts = row.file.replace(/\\/g, '/').split('/');
      const camFolderIndex = pathParts.findIndex(part => part.startsWith('cam_'));
      if (camFolderIndex === -1) {
          return { ...row, file: '' }; 
      }
      const relativePath = pathParts.slice(camFolderIndex).join('/');
      return {
          ...row,
          file: `/api/recordings/${relativePath}`
      };
  });
}

async function getRecordingsByCameraId(cameraId) {
  return runQuery('SELECT file_path FROM recordings WHERE camera_id = ?', [cameraId]);
}

async function deleteRecordingByPath(filePath) {
    const changes = await runUpdate('DELETE FROM recordings WHERE file_path = ?', [filePath]);
    return { deleted: changes };
}

async function deleteAllRecordingsFromDB() {
    const changes = await runUpdate('DELETE FROM recordings');
    return { deleted: changes };
}

// --- Fungsi untuk kamera ---

async function getAllCameras() {
  const rows = await runQuery('SELECT c.*, s.name as storage_name, s.path as storage_path FROM cameras c LEFT JOIN storages s ON c.storage_id = s.id ORDER BY c.name ASC');
  return rows.map(c => ({...c, is_hevc: !!c.is_hevc, enabled: !!c.enabled}));
}

async function addCamera(camera) {
  const { name, ip_address, rtsp_url, storage_id, is_hevc, enabled } = camera;
  const id = await runInsert('INSERT INTO cameras (name, ip_address, rtsp_url, storage_id, is_hevc, enabled) VALUES (?, ?, ?, ?, ?, ?)', [name, ip_address, rtsp_url, storage_id, is_hevc ? 1 : 0, enabled !== false ? 1 : 0]);
  return { id, ...camera };
}

async function getCameraById(id) {
    const row = await runGet('SELECT c.*, s.name as storage_name, s.path as storage_path FROM cameras c LEFT JOIN storages s ON c.storage_id = s.id WHERE c.id = ?', [id]);
    if (row) {
      return {...row, is_hevc: !!row.is_hevc, enabled: !!row.enabled};
    }
    return null;
}

async function updateCamera(id, camera) {
  const { name, rtsp_url, storage_id, is_hevc, enabled } = camera;
  await runUpdate('UPDATE cameras SET name = ?, rtsp_url = ?, storage_id = ?, is_hevc = ?, enabled = ? WHERE id = ?', [name, rtsp_url, storage_id, is_hevc ? 1 : 0, enabled ? 1 : 0, id]);
  return { id, ...camera };
}

async function deleteCamera(id) {
  await runUpdate('DELETE FROM cameras WHERE id = ?', [id]);
  return { id };
}

// --- Fungsi untuk Settings ---

async function getSetting(key) {
  const row = await runGet('SELECT setting_value FROM settings WHERE setting_key = ?', [key]);
  return row ? row.setting_value : null;
}

async function setSetting(key, value) {
  if (isMysql) {
    await db.execute('INSERT INTO settings (setting_key, setting_value) VALUES (?, ?) ON DUPLICATE KEY UPDATE setting_value = ?', [key, value, value]);
  } else {
    await runUpdate('INSERT OR REPLACE INTO settings (setting_key, setting_value) VALUES (?, ?)', [key, value]);
  }
}

module.exports = {
    // DB Type export for testing
    DB_TYPE: config.DB_TYPE,
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
    deleteAllRecordingsFromDB,
    // Settings functions
    getSetting,
    setSetting,
};
