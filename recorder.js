// recorder.js

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const database = require('./lib/database');

/** ====== KONFIGURASI ====== */
const RECORDINGS_DIR      = path.join(__dirname, 'recordings');
const HLS_ROOT_DIR        = path.join(__dirname, 'public', 'hls');
const MAX_STORAGE         = 600 * 1024 * 1024 * 1024; // 600 GB total
const SEGMENT_DURATION    = 180; // detik, sesuai dengan -segment_time di ffmpeg

// Pengaturan post-process faststart
const FASTSTART_POSTPROC      = true;
const POSTPROC_DELAY_MS       = 1500;
const POSTPROC_STABLE_MS      = 1200;
const POSTPROC_MAX_RETRY      = 5;
const POSTPROC_RETRY_BACKOFF  = 1000;
const QUEUE_CONCURRENCY       = 2;

if (!fs.existsSync(RECORDINGS_DIR)) fs.mkdirSync(RECORDINGS_DIR, { recursive: true });
if (!fs.existsSync(HLS_ROOT_DIR))   fs.mkdirSync(HLS_ROOT_DIR,   { recursive: true });

const processes = new Map();

/** ====== FASTSTART QUEUE ====== */

const jobQueue = [];
let runningJobs = 0;
const inQueue = new Set();

function enqueueRemuxJob(filePath) {
  if (!FASTSTART_POSTPROC) return;
  if (!filePath.endsWith('.mp4')) return;
  if (inQueue.has(filePath)) return;

  inQueue.add(filePath);
  jobQueue.push({ filePath, attempts: 0, nextDelay: POSTPROC_RETRY_BACKOFF });
  processQueue();
}

function processQueue() {
  while (runningJobs < QUEUE_CONCURRENCY && jobQueue.length > 0) {
    const job = jobQueue.shift();
    runningJobs++;
    processJob(job)
      .catch(() => {})
      .finally(() => {
        runningJobs--;
        processQueue();
      });
  }
}

function waitFileStable(filePath, stableMs = POSTPROC_STABLE_MS, timeoutMs = 20000) {
  return new Promise((resolve) => {
    let lastSize = -1;
    let lastChange = Date.now();
    const start = Date.now();

    const itv = setInterval(() => {
      fs.stat(filePath, (err, st) => {
        if (err) {
          clearInterval(itv);
          return resolve(true);
        }
        if (st.size !== lastSize) {
          lastSize = st.size;
          lastChange = Date.now();
        }
        if (Date.now() - lastChange >= stableMs) {
          clearInterval(itv);
          resolve(true);
        }
        if (Date.now() - start > timeoutMs) {
          clearInterval(itv);
          resolve(true);
        }
      });
    }, 250);
  });
}

async function processJob(job) {
  const { filePath } = job;
  try {
    if (!fs.existsSync(filePath)) {
      inQueue.delete(filePath);
      return;
    }

    await new Promise(r => setTimeout(r, POSTPROC_DELAY_MS));
    await waitFileStable(filePath);

    await fixMoovAtom(filePath);
    inQueue.delete(filePath);
    console.log('[FASTSTART] Sukses remux:', filePath);
  } catch (e) {
    job.attempts++;
    if (job.attempts < POSTPROC_MAX_RETRY) {
      console.warn(`[FASTSTART] Gagal remux (attempt ${job.attempts}) untuk ${filePath}: ${e.message}`);
      await new Promise(r => setTimeout(r, job.nextDelay));
      job.nextDelay = Math.min(job.nextDelay * 1.5, 10000);
      jobQueue.push(job);
    } else {
      console.error(`[FASTSTART] Gagal permanen remux ${filePath}:`, e.message);
      inQueue.delete(filePath);
    }
  }
}

function fixMoovAtom(filePath) {
  return new Promise((resolve, reject) => {
    const dir = path.dirname(filePath);
    const base = path.basename(filePath, '.mp4');
    const tmpFile = path.join(dir, `${base}.faststart.tmp.mp4`);

    const ff = spawn('ffmpeg', [
      '-v', 'error',
      '-y',
      '-i', filePath,
      '-c', 'copy',
      '-movflags', '+faststart',
      tmpFile
    ], { windowsHide: true });

    let errLog = '';
    ff.stderr.on('data', (d) => { errLog += d.toString(); });

    ff.on('close', (code) => {
      if (code === 0) {
        try {
          fs.renameSync(tmpFile, filePath);
          resolve(true);
        } catch (e) {
          try { fs.unlinkSync(tmpFile); } catch {}
          reject(e);
        }
      } else {
        try { fs.unlinkSync(tmpFile); } catch {}
        reject(new Error(errLog || `ffmpeg exited with code ${code}`));
      }
    });
  });
}

/** ====== DB SYNC REAL-TIME ====== */

async function addSegmentToDatabase(camId, filePath) {
  try {
    const fileName = path.basename(filePath, '.mp4');
    const [datePart, timePart] = fileName.split('_');
    const [year, month, day] = datePart.split('-').map(Number);
    const [hour, minute, second] = timePart.split('-').map(Number);

    const timestamp = new Date(year, month - 1, day, hour, minute, second).getTime();
    const duration = SEGMENT_DURATION;

    const relativePath = `/recordings/cam_${camId}/${fileName}.mp4`;

    await database.addRecording({
      camera_id: camId,
      file_path: relativePath,
      timestamp,
      duration
    });

    console.log(`[DB] Added recording: cam=${camId}, file=${fileName}.mp4`);
  } catch (e) {
    console.error('[DB] Failed to add recording:', filePath, e.message);
  }
}

/** ====== CLEANUP STORAGE ====== */

async function cleanupStorage() {
  try {
    if (!fs.existsSync(RECORDINGS_DIR)) return;

    function listFiles(dir) {
      let files = [];
      for (const f of fs.readdirSync(dir)) {
        const fp = path.join(dir, f);
        try {
          const st = fs.statSync(fp);
          if (st.isFile()) {
            files.push({ file: fp, time: st.mtimeMs, size: st.size });
          } else if (st.isDirectory()) {
            files = files.concat(listFiles(fp));
          }
        } catch {}
      }
      return files;
    }

    let list = listFiles(RECORDINGS_DIR).filter(x => x.file.endsWith('.mp4')).sort((a, b) => a.time - b.time);
    let total = list.reduce((acc, f) => acc + f.size, 0);

    while (total > MAX_STORAGE && list.length > 0) {
      const oldest = list.shift();
      try {
        const camId = path.basename(path.dirname(oldest.file)).replace('cam_','');
        const fileName = path.basename(oldest.file);
        const relativePath = `/recordings/cam_${camId}/${fileName}`;

        fs.unlinkSync(oldest.file);
        await database.deleteRecordingByPath(relativePath);
        total -= oldest.size;
        console.log('[RECORDER] Deleted old file and DB entry:', oldest.file);
      } catch (e) {
        console.warn('[RECORDER] Failed deleting:', oldest.file, e.message);
      }
    }
  } catch (e) {
    console.error('[RECORDER] cleanupStorage error:', e);
  }
}

/** ====== REKAMAN (FFMPEG) ====== */

function startFFmpegForCamera(camera) {
  const camId = camera.id;
  if (!camId) return;

  if (processes.has(camId)) {
    console.log(`[RECORDER] FFmpeg for cam ${camId} already running.`);
    return;
  }

  const camRecDir = path.join(RECORDINGS_DIR, `cam_${camId}`);
  const camHlsDir = path.join(HLS_ROOT_DIR,   `cam_${camId}`);
  fs.mkdirSync(camRecDir, { recursive: true });
  fs.mkdirSync(camHlsDir, { recursive: true });

  const recordingTemplate = path.join(camRecDir, '%Y-%m-%d_%H-%M-%S.mp4');
  const hlsIndexPath = path.join(camHlsDir, 'index.m3u8');

  const args = [
    '-rtsp_transport', 'tcp',
    '-i', camera.rtsp_url,

    '-map', '0:v:0', '-c:v', 'copy', '-an',
    '-f', 'segment',
    '-reset_timestamps', '1',
    '-segment_time', String(SEGMENT_DURATION),
    '-strftime', '1',
    '-segment_format_options', 'movflags=+faststart',
    recordingTemplate,

    '-map', '0:v:0', '-c:v', 'copy', '-an',
    '-f', 'hls',
    '-hls_time', '1',
    '-hls_list_size', '5',
    '-hls_flags', 'delete_segments+append_list+independent_segments',
    hlsIndexPath
  ];

  console.log(`[RECORDER] Starting FFmpeg for cam ${camId}...`);
  const proc = spawn('ffmpeg', args, { stdio: ['ignore', 'ignore', 'pipe'], windowsHide: true });

  proc.on('close', () => {
    console.warn(`[RECORDER] FFmpeg for cam ${camId} exited. Restarting in 2s...`);
    processes.delete(camId);
    setTimeout(() => startFFmpegForCamera(camera), 2000);
  });

  processes.set(camId, proc);

  // Watch folder rekaman
  startDirWatcher(camId, camRecDir);
}

const activeWatchers = new Map();

function startDirWatcher(camId, dirPath) {
  if (activeWatchers.has(dirPath)) return;

  const watcher = fs.watch(dirPath, { persistent: true }, (eventType, filename) => {
    if (!filename || !filename.endsWith('.mp4')) return;
    const full = path.join(dirPath, filename);
    fs.stat(full, (err, st) => {
      if (!err && st.isFile()) {
        enqueueRemuxJob(full);
        addSegmentToDatabase(camId, full); // real-time sync DB
        cleanupStorage(); // optional: cek storage tiap kali ada file baru
      }
    });
  });

  watcher.on('error', (e) => {
    console.warn('[RECORDER] Watcher error:', dirPath, e.message);
  });

  activeWatchers.set(dirPath, watcher);
}

/** ====== START/STOP ====== */

async function startAllRecordings() {
  const cameras = await database.getAllCameras();
  if (!cameras || cameras.length === 0) {
    console.log('[RECORDER] No cameras found.');
    return;
  }
  cameras.forEach((cam) => startFFmpegForCamera(cam));
}

function stopAllRecordings() {
  for (const [camId, proc] of processes.entries()) {
    try { proc.kill('SIGTERM'); } catch {}
    processes.delete(camId);
  }
  for (const [dir, watcher] of activeWatchers.entries()) {
    try { watcher.close(); } catch {}
    activeWatchers.delete(dir);
  }
}

module.exports = {
  startAllRecordings,
  stopAllRecordings,
};
