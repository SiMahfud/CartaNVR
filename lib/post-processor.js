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

function enqueueRemuxJob(filePath) {
  if (!FASTSTART_POSTPROC) return;
  if (!filePath.endsWith('.mp4')) return;

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
  const { filePath } = job;
  try {
    if (!fs.existsSync(filePath)) {
      console.warn('[FASTSTART] File hilang sebelum diproses:', filePath);
      inQueue.delete(filePath);
      return;
    }

    await sleep(POSTPROC_DELAY_MS);
    await waitFileStable(filePath, POSTPROC_STABLE_MS);

    const key = filePath + ':' + fs.statSync(filePath).size;
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

      if (duration > 0 && Number.isFinite(timestamp)) {
        await database.addRecording({
          camera_id: camId,
          file_path: relativePath,
          timestamp: timestamp,
          duration: duration
        });
      }
    } catch (dbError) {
      console.error(`[RECORDER] Gagal menambahkan ${filePath} ke database:`, dbError);
    }

    inQueue.delete(filePath);
  } catch (e) {
    job.attempts++;
    if (job.attempts < POSTPROC_MAX_RETRY) {
      console.warn(`[FASTSTART] Gagal remux (attempt ${job.attempts}) untuk ${filePath}: ${e.message}. Retry...`);
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

    let stderr = '';
    ffmpeg.stderr.on('data', (data) => {
      stderr += data.toString();
    });

    ffmpeg.on('close', (code) => {
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
        reject(new Error(`ffmpeg process exited with code ${code}: ${stderr}`));
      }
    });

    ffmpeg.on('error', (err) => {
      try {
        fs.unlinkSync(tmpFile);
      } catch { }
      reject(err);
    });
  });
}

module.exports = {
  enqueueRemuxJob,
};
