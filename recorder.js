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

  console.log(`[WATCHER] Memulai watcher untuk direktori: ${dirPath}`);
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
  console.log('[RECORDER] Memulai semua layanan...');
  const cameras = await database.getAllCameras();
  if (!cameras || cameras.length === 0) {
    console.log('[RECORDER] Tidak ada kamera ditemukan di database.');
    return;
  }

  // 1. Sinkronisasi file yang mungkin sudah ada sebelumnya.
  await syncExistingFilesOnce();

  // 2. Mulai proses FFmpeg untuk setiap kamera.
  // ffmpeg-manager akan memanggil balik `startDirWatcher` untuk setiap direktori baru.
  cameras.forEach((cam) => startFFmpegForCamera(cam, startDirWatcher));

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
  console.log('[RECORDER] Semua layanan telah dimulai.');
}

/**
 * Menghentikan semua proses yang berjalan dengan aman.
 */
async function stopAllRecordings() {
  console.log('[RECORDER] Menghentikan semua layanan...');
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

  console.log('[RECORDER] Semua layanan telah dihentikan.');
}

module.exports = {
  startAllRecordings,
  stopAllRecordings,
};
