'use strict';

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const ffmpegPath = require('ffmpeg-static');
const database = require('./database');
const {
  sleep,
  waitFileStable,
  getVideoDuration,
  parseTimestampFromNameOrMtime,
  sanitizeCamId
} = require('./utils');

const {
  FASTSTART_POSTPROC,
  POSTPROC_DELAY_MS,
  POSTPROC_STABLE_MS,
  POSTPROC_MAX_RETRY,
  POSTPROC_RETRY_BACKOFF,
  QUEUE_CONCURRENCY,
} = require('./config');

/** ====== JOB QUEUE UNTUK REMUX FASTSTART ====== */
const jobQueue = [];
let runningJobs = 0;
const inQueue = new Set();
const pendingDebounce = new Map();
const processedOnce = new Set();
const PROCESSED_ONCE_MAX = 1000;

const activeProcesses = new Set();
let isShuttingDown = false;

function enqueueRemuxJob(filePath) {
  if (!FASTSTART_POSTPROC) return;
  if (!filePath.endsWith('.mp4')) return;
  if (isShuttingDown) return;

  clearTimeout(pendingDebounce.get(filePath));
  const to = setTimeout(() => {
    pendingDebounce.delete(filePath);
    if (inQueue.has(filePath)) return;
    inQueue.add(filePath);
    jobQueue.push({ filePath, attempts: 0, nextDelay: POSTPROC_RETRY_BACKOFF });
    processQueue();
  }, 500);
  pendingDebounce.set(filePath, to);
}

function processQueue() {
  if (isShuttingDown) return;
  while (runningJobs < QUEUE_CONCURRENCY && jobQueue.length > 0) {
    const job = jobQueue.shift();
    runningJobs++;
    processJob(job)
      .catch(() => { })
      .finally(() => {
        runningJobs--;
        processQueue();
      });
  }
}

async function processJob(job) {
  if (isShuttingDown) {
    inQueue.delete(job.filePath);
    return;
  }
  const { filePath } = job;
  try {
    if (!fs.existsSync(filePath)) {
      console.warn('[FASTSTART] File hilang sebelum diproses:', filePath);
      inQueue.delete(filePath);
      return;
    }

    await sleep(POSTPROC_DELAY_MS);
    await waitFileStable(filePath, POSTPROC_STABLE_MS);

    if (!fs.existsSync(filePath)) {
      console.warn('[FASTSTART] File hilang sebelum diproses:', filePath);
      inQueue.delete(filePath);
      return;
    }

    const stat = fs.statSync(filePath);
    if (stat.size === 0) {
      console.warn(`[FASTSTART] File kosong (0 byte): ${filePath}. Menghapus file rusak...`);
      try { fs.unlinkSync(filePath); } catch { }
      inQueue.delete(filePath);
      return;
    }

    const key = filePath + ':' + stat.size;
    if (processedOnce.has(key)) {
      inQueue.delete(filePath);
      return;
    }

    await fixMoovAtom(filePath);
    processedOnce.add(key);

    // Prune oldest entries if set exceeds max size
    if (processedOnce.size > PROCESSED_ONCE_MAX) {
      const toDelete = Math.floor(PROCESSED_ONCE_MAX / 2);
      let count = 0;
      for (const entry of processedOnce) {
        if (count >= toDelete) break;
        processedOnce.delete(entry);
        count++;
      }
    }

    // Tambahkan ke DB setelah remux sukses
    try {
      const duration = await getVideoDuration(filePath);
      const file = path.basename(filePath);
      const dirName = path.basename(path.dirname(filePath));
      const camId = sanitizeCamId(parseInt(dirName.replace('cam_', ''), 10));
      const relativePath = `/recordings/${dirName}/${file}`;
      const timestamp = parseTimestampFromNameOrMtime(filePath);

      // Look up camera's current storage_id to record where this file lives
      const camera = await database.getCameraById(camId);
      const storageId = camera ? camera.storage_id : null;

      if (duration > 0 && Number.isFinite(timestamp)) {
        await database.addRecording({
          camera_id: camId,
          storage_id: storageId,
          file_path: relativePath,
          timestamp: timestamp,
          duration: duration
        });
      } else {
        console.warn(`[FASTSTART] File ${filePath} tidak valid (durasi ${duration}s). Menghapus file...`);
        try { fs.unlinkSync(filePath); } catch { }
      }
    } catch (dbError) {
      console.error(`[RECORDER] Gagal menambahkan ${filePath} ke database:`, dbError);
    }

    inQueue.delete(filePath);
  } catch (e) {
    if (isShuttingDown) return; // Don't retry if shutting down

    const errMsg = e.stderr || e.message || '';
    const isCorrupt = /moov atom not found|Invalid data found when processing input/i.test(errMsg);

    if (isCorrupt) {
      console.warn(`[FASTSTART] File terpotong/rusak (${path.basename(filePath)}): moov atom tidak ditemukan. Menghapus file rusak agar tidak membebani sistem...`);
      try {
        if (fs.existsSync(filePath)) {
          fs.unlinkSync(filePath);
        }
      } catch (delErr) {
        console.error(`[FASTSTART] Gagal menghapus file rusak ${filePath}:`, delErr.message);
      }
      inQueue.delete(filePath);
      return;
    }

    job.attempts++;
    if (job.attempts < POSTPROC_MAX_RETRY) {
      console.warn(`[FASTSTART] Gagal remux (attempt ${job.attempts}) untuk ${path.basename(filePath)}: ${e.message}. Retry...`);
      await sleep(job.nextDelay);
      job.nextDelay = Math.min(job.nextDelay * 1.5, 10000);
      jobQueue.push(job);
    } else {
      console.error(`[FASTSTART] Gagal permanen remux ${filePath} setelah ${job.attempts} attempts:`, e.message);
      inQueue.delete(filePath);
    }
  }
}

function fixMoovAtom(filePath) {
  return new Promise((resolve, reject) => {
    const dir = path.dirname(filePath);
    const base = path.basename(filePath, '.mp4');
    const tmpFile = path.join(dir, `${base}.faststart.tmp.mp4`);

    const ffmpeg = spawn(ffmpegPath, [
      '-y',
      '-i',
      filePath,
      '-c',
      'copy',
      '-movflags',
      '+faststart',
      tmpFile,
    ], { windowsHide: true });

    activeProcesses.add(ffmpeg);

    let stderr = '';
    ffmpeg.stderr.on('data', (data) => {
      // Limit stderr buffer to ~10KB to prevent unbounded memory growth
      if (stderr.length < 10240) {
        stderr += data.toString();
      }
    });

    ffmpeg.on('close', (code) => {
      activeProcesses.delete(ffmpeg);
      if (code === 0) {
        try {
          fs.renameSync(tmpFile, filePath);
          resolve(true);
        } catch (e) {
          try {
            fs.unlinkSync(tmpFile);
          } catch { }
          reject(e);
        }
      } else {
        try {
          fs.unlinkSync(tmpFile);
        } catch { }
        // If shutting down, code might be null or SIGTERM related, which is expected
        if (isShuttingDown) {
          reject(new Error('Process terminated due to shutdown'));
        } else {
          // Format stderr: strip the verbose FFmpeg build & configuration banner
          const lines = stderr
            .split('\n')
            .map(l => l.trim())
            .filter(l => l && !l.startsWith('built with') && !l.startsWith('configuration:') && !l.startsWith('libav') && !l.startsWith('ffmpeg version'));
          const cleanStderr = lines.slice(-5).join(' ') || stderr.trim();
          const err = new Error(`ffmpeg process exited with code ${code}: ${cleanStderr}`);
          err.code = code;
          err.stderr = stderr;
          reject(err);
        }
      }
    });

    ffmpeg.on('error', (err) => {
      activeProcesses.delete(ffmpeg);
      try {
        fs.unlinkSync(tmpFile);
      } catch { }
      reject(err);
    });
  });
}

function stopAllPostProcessing() {
  console.log('[POSTPROC] Stopping all background FFmpeg processes...');
  isShuttingDown = true;

  // Clear queue
  jobQueue.length = 0;
  inQueue.clear();
  pendingDebounce.forEach(clearTimeout);
  pendingDebounce.clear();

  // Kill running processes
  for (const proc of activeProcesses) {
    try {
      proc.kill('SIGKILL');
    } catch (e) {
      console.error('[POSTPROC] Error killing process:', e.message);
    }
  }
  activeProcesses.clear();
  console.log('[POSTPROC] Background processes stopped.');
}

module.exports = {
  enqueueRemuxJob,
  stopAllPostProcessing,
  _test_addProcess: (proc) => activeProcesses.add(proc)
};

