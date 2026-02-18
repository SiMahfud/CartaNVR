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
        database: process.env.MYSQL_DATABASE || 'nvr',
        connectTimeout: parseInt(process.env.MYSQL_CONNECT_TIMEOUT, 10) || 3000
    },

    // Security
    sessionSecret: process.env.SESSION_SECRET || 'your-very-secret-key-change-me',
    defaultAdminUser: 'admin',
    defaultAdminPassword: process.env.DEFAULT_ADMIN_PASSWORD || 'smacampurdarat',
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

const config = Object.assign(Object.create(defaultConfig), userConfig);

// Ensure recordingsDir is an absolute path
if (!path.isAbsolute(config.recordingsDir)) {
    config.recordingsDir = path.join(config.BASE_DIR, config.recordingsDir);
}

// Security warnings for default credentials
if (!process.env.SESSION_SECRET) {
    console.warn('[SECURITY WARNING] SESSION_SECRET not set in .env — using insecure default. Please set a strong secret!');
}
if (!process.env.DEFAULT_ADMIN_PASSWORD) {
    console.warn('[SECURITY WARNING] DEFAULT_ADMIN_PASSWORD not set in .env — using insecure default.');
}

// Listen for database setting changes to override config
const dbEvents = require('./db-events');
dbEvents.on('settingChanged', (key, value) => {
    const targetKey = key in config ? key : (key.toUpperCase() in config ? key.toUpperCase() : key);

    // Convert types if the key already exists in config
    if (targetKey in config && typeof config[targetKey] === 'number') {
        config[targetKey] = Number(value);
    } else if (targetKey in config && typeof config[targetKey] === 'boolean') {
        config[targetKey] = (value === '1' || value === 'true');
    } else {
        // Accept new keys too (e.g., log_terminal_*, federation_key)
        config[targetKey] = value;
    }
});

// Initial load of settings from database if initialized
async function syncWithDatabase() {
    const database = require('./database');
    try {
        const settings = await database.getAllSettings();
        for (const [key, value] of Object.entries(settings)) {
            const targetKey = key in config ? key : (key.toUpperCase() in config ? key.toUpperCase() : key);

            if (targetKey in config && typeof config[targetKey] === 'number') {
                config[targetKey] = Number(value);
            } else if (targetKey in config && typeof config[targetKey] === 'boolean') {
                config[targetKey] = (value === '1' || value === 'true');
            } else {
                // Accept new keys too
                config[targetKey] = value;
            }
        }
    } catch (e) {
        // Database might not be initialized yet, that's fine
    }
}

// Attach syncWithDatabase as a non-enumerable property to avoid pollution
Object.defineProperty(config, 'syncWithDatabase', {
    value: syncWithDatabase,
    enumerable: false,
    writable: false,
    configurable: false
});

module.exports = config;
