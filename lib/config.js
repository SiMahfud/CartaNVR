'use strict';

const path = require('path');
const os = require('os');
const fs = require('fs');

const configPath = path.join(__dirname, 'config.json');

const defaultConfig = {
  // Paths
  BASE_DIR: path.join(__dirname, '..'),
  get RECORDINGS_DIR() { return path.join(this.BASE_DIR, 'recordings'); },
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

module.exports = config;
