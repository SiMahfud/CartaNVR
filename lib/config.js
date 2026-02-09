'use strict';

require('dotenv').config();
const path = require('path');
const os = require('os');
const fs = require('fs');

const configPath = path.join(__dirname, 'config.json');

const defaultConfig = {
  // Paths
  BASE_DIR: path.join(__dirname, '..'),
  recordingsDir: path.join(__dirname, '..', 'recordings'), // New property
  get RECORDINGS_DIR() { return this.recordingsDir; }, // Modified getter
  get DASH_ROOT_DIR() { return path.join(this.BASE_DIR, 'public', 'dash'); },

  // Storage
  MAX_STORAGE: 600 * 1024 * 1024 * 1024, // 600 GB

  // Intervals
  CLEANUP_INTERVAL_MS: 5 * 60 * 1000,      // 5 minutes
  PERIODIC_SYNC_MS: 30 * 60 * 1000,       // 30 minutes

  // Post-processing (Faststart Remux)
  FASTSTART_POSTPROC: true,
  POSTPROC_DELAY_MS: 1500,
  POSTPROC_STABLE_MS: 1200,
  POSTPROC_MAX_RETRY: 5,
  POSTPROC_RETRY_BACKOFF: 1000,
  QUEUE_CONCURRENCY: Math.min(4, Math.max(2, (os.cpus()?.length || 2) - 1)),

  // FFmpeg Recording
  FFMPEG_MAX_RETRY: 10,
  FFMPEG_BASE_BACKOFF_MS: 2000,
  FFMPEG_MAX_BACKOFF_MS: 60 * 1000,
  FFMPEG_COOL_OFF_MS: 5 * 60 * 1000,
  FFMPEG_WATCHDOG_TIMEOUT_MS: 30 * 1000,

  // PM2
  pm2_service_name: 'nvr',

  // Database
  DB_TYPE: process.env.DB_TYPE || 'sqlite', // 'sqlite' or 'mysql'
  MYSQL_CONFIG: {
    host: process.env.MYSQL_HOST || 'localhost',
    user: process.env.MYSQL_USER || 'nvr',
    password: process.env.MYSQL_PASSWORD || '',
    database: process.env.MYSQL_DATABASE || 'nvr'
  },

  // Security
  sessionSecret: 'your-very-secret-key-change-me',
  defaultAdminUser: 'admin',
  defaultAdminPassword: 'smacampurdarat',
};

let userConfig = {};
try {
  if (fs.existsSync(configPath)) {
    const rawData = fs.readFileSync(configPath);
    userConfig = JSON.parse(rawData);
  }
} catch (error) {
  console.error('Error reading config.json:', error);
}

const config = { ...defaultConfig, ...userConfig };

// Ensure recordingsDir is an absolute path
if (!path.isAbsolute(config.recordingsDir)) {
  config.recordingsDir = path.join(config.BASE_DIR, config.recordingsDir);
}

// Listen for database setting changes to override config
const dbEvents = require('./db-events');
dbEvents.on('settingChanged', (key, value) => {
    if (key in config || key.toUpperCase() in config) {
        const targetKey = key in config ? key : key.toUpperCase();
        
        // Convert types if necessary
        if (typeof config[targetKey] === 'number') {
            config[targetKey] = Number(value);
        } else if (typeof config[targetKey] === 'boolean') {
            config[targetKey] = (value === '1' || value === 'true');
        } else {
            config[targetKey] = value;
        }
    }
});

// Initial load of settings from database if initialized
async function syncWithDatabase() {
    const database = require('./database');
    try {
        const settings = await database.getAllSettings();
        for (const [key, value] of Object.entries(settings)) {
            if (key in config || key.toUpperCase() in config) {
                const targetKey = key in config ? key : key.toUpperCase();
                if (typeof config[targetKey] === 'number') {
                    config[targetKey] = Number(value);
                } else if (typeof config[targetKey] === 'boolean') {
                    config[targetKey] = (value === '1' || value === 'true');
                } else {
                    config[targetKey] = value;
                }
            }
        }
    } catch (e) {
        // Database might not be initialized yet, that's fine
    }
}

module.exports = config;
module.exports.syncWithDatabase = syncWithDatabase;
