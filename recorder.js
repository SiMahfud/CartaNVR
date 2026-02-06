'use strict';

/**
 * recorder.js
 * 
 * Bertindak sebagai orkestrator utama untuk memulai, menghentikan, dan mengelola
 * semua layanan terkait perekaman.
 */

const path = require('path');
const chokidar = require('chokidar');
const database = require('./lib/database');
const logger = require('./lib/logger');
const { enqueueRemuxJob } = require('./lib/post-processor.js');
const { syncExistingFilesOnce, periodicSyncDbToDisk, cleanupStorage } = require('./lib/storage.js');
const { startFFmpegForCamera, stopAllFFmpeg } = require('./lib/ffmpeg-manager.js');

const {
  CLEANUP_INTERVAL_MS,
  PERIODIC_SYNC_MS,
  POSTPROC_STABLE_MS,
} = require('./lib/config');

// State internal modul recorder
const intervals = new Map();
const activeWatchers = new Map();
const lastFilePerDir = new Map();

/**
 * Memulai watcher pada direktori spesifik untuk memantau file video baru.
 * Ketika sebuah file dianggap selesai ditulis, file tersebut akan dimasukkan ke antrian post-processing.
 * @param {string} dirPath Path absolut ke direktori yang akan dipantau.
 */
function startDirWatcher(dirPath) {
  if (activeWatchers.has(dirPath)) return;

  logger.log('recorder', `[WATCHER] Memulai watcher untuk direktori: ${dirPath}`);
  const watcher = chokidar.watch(dirPath, {
    persistent: true,
    depth: 0,
    ignoreInitial: true,
    awaitWriteFinish: {
      stabilityThreshold: POSTPROC_STABLE_MS,
      pollInterval: 200
    }
  });

  // Logika baru: event 'add' menandakan file SEBELUMNYA telah selesai.
  watcher.on('add', (newFile) => {
    const previousFile = lastFilePerDir.get(dirPath);
    if (previousFile && previousFile !== newFile) {
      // console.log(`[WATCHER] File ${path.basename(previousFile)} selesai. Masuk antrian proses.`);
      enqueueRemuxJob(previousFile);
    }
    lastFilePerDir.set(dirPath, newFile);
  });

  watcher.on('error', (e) => console.error('[WATCHER] Error:', dirPath, e.message));
  activeWatchers.set(dirPath, watcher);
}

/**
 * Memulai semua proses perekaman, sinkronisasi, dan cleanup.
 */
async function startAllRecordings() {
  logger.log('recorder', '[RECORDER] Memulai semua layanan...');
  const cameras = await database.getAllCameras();
  if (!cameras || cameras.length === 0) {
    logger.log('recorder', '[RECORDER] Tidak ada kamera ditemukan di database.');
    return;
  }

  // 1. Sinkronisasi file yang mungkin sudah ada sebelumnya.
  await syncExistingFilesOnce();

  // 2. Mulai proses FFmpeg untuk setiap kamera yang enabled.
  cameras.forEach((cam) => {
    if (cam.enabled !== false) {
      startFFmpegForCamera(cam, startDirWatcher);
    } else {
      logger.log('recorder', `[RECORDER] Kamera ${cam.id} (${cam.name}) dinonaktifkan. Mewati...`);
    }
  });

  // 3. Mulai tugas periodik (cleanup dan sync DB).
  if (!intervals.has('cleanup')) {
    cleanupStorage(); // Jalankan sekali saat startup
    const cleanupInterval = setInterval(cleanupStorage, CLEANUP_INTERVAL_MS);
    intervals.set('cleanup', cleanupInterval);
  }

  if (!intervals.has('sync')) {
    const syncInterval = setInterval(periodicSyncDbToDisk, PERIODIC_SYNC_MS);
    intervals.set('sync', syncInterval);
  }
  logger.log('recorder', '[RECORDER] Semua layanan telah dimulai.');
}

/**
 * Menghentikan semua proses yang berjalan dengan aman.
 */
async function stopAllRecordings() {
  logger.log('recorder', '[RECORDER] Menghentikan semua layanan...');
  // 1. Hentikan semua watcher
  for (const [dir, watcher] of activeWatchers.entries()) {
    try {
      await watcher.close();
    } catch (e) {
      console.error(`[WATCHER] Gagal menutup watcher untuk ${dir}:`, e.message);
    }
    activeWatchers.delete(dir);
  }

  // 2. Hentikan semua tugas periodik
  for (const interval of intervals.values()) {
    clearInterval(interval);
  }
  intervals.clear();

  // 3. Hentikan semua proses FFmpeg
  await stopAllFFmpeg();

  logger.log('recorder', '[RECORDER] Semua layanan telah dihentikan.');
}

/**
 * Memulai perekaman untuk satu kamera tertentu.
 * @param {object} camera Objek kamera dari database.
 */
function startRecordingForCamera(camera) {
  if (camera.enabled === false) return;
  startFFmpegForCamera(camera, startDirWatcher);
}

/**
 * Menghentikan perekaman untuk satu kamera tertentu.
 * @param {number|string} cameraId ID kamera.
 * @param {string} storagePath Path storage kamera (opsional, untuk menutup watcher).
 */
async function stopRecordingForCamera(cameraId, storagePath) {
  const { stopFFmpegForCamera } = require('./lib/ffmpeg-manager.js');
  const { sanitizeCamId } = require('./lib/utils');
  
  // 1. Hentikan FFmpeg
  await stopFFmpegForCamera(cameraId);

  // 2. Hentikan watcher jika storagePath diketahui
  if (storagePath) {
    const camId = sanitizeCamId(cameraId);
    const dirPath = path.join(storagePath, `cam_${camId}`);
    const watcher = activeWatchers.get(dirPath);
    if (watcher) {
      try {
        await watcher.close();
        activeWatchers.delete(dirPath);
        logger.log('recorder', `[WATCHER] Watcher untuk ${dirPath} dihentikan.`);
      } catch (e) {
        console.error(`[WATCHER] Gagal menutup watcher untuk ${dirPath}:`, e.message);
      }
    }
  }
}

module.exports = {
  startAllRecordings,
  stopAllRecordings,
  startRecordingForCamera,
  stopRecordingForCamera,
};
