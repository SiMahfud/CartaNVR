'use strict';

/**
 * recorder.js
 */

const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const os = require('os');
const { spawn } = require('child_process');
const chokidar = require('chokidar');
const database = require('./lib/database');

/** ====== KONFIGURASI ====== */
const RECORDINGS_DIR       = path.join(__dirname, 'recordings');
const HLS_ROOT_DIR         = path.join(__dirname, 'public', 'hls');
const MAX_STORAGE          = 600 * 1024 * 1024 * 1024; // 600 GB total (ubah sesuai kebutuhan)
const CLEANUP_INTERVAL_MS  = 5 * 60 * 1000;             // 5 menit (hanya untuk cleanup)
const PERIODIC_SYNC_MS     = 30 * 60 * 1000;            // 30 menit (sync DB ←→ disk)

// Post-process faststart
const FASTSTART_POSTPROC       = true;        // aktif/nonaktifkan remux faststart
const POSTPROC_DELAY_MS        = 1500;        // tunda sebelum mencoba remux (biar file benar2 closed)
const POSTPROC_STABLE_MS       = 1200;        // waktu minimal file tidak berubah ukuran sebelum diproses
const POSTPROC_MAX_RETRY       = 5;           // maksimal retry
const POSTPROC_RETRY_BACKOFF   = 1000;        // jeda retry awal (bertumbuh)
const DEFAULT_CONCURRENCY      = Math.min(4, Math.max(2, (os.cpus()?.length || 2) - 1));
const QUEUE_CONCURRENCY        = DEFAULT_CONCURRENCY;   // maksimal proses ffmpeg remux berjalan bersamaan

// HLS tuning
const HLS_TIME_SECONDS         = 4;           // segment default 4 detik (lebih efisien dari 1 detik)
const HLS_LIST_SIZE            = 5;           // jumlah segmen di playlist

// Restart policy ffmpeg per kamera
const FFMPEG_MAX_RETRY         = 10;          // maksimum restart berturut-turut
const FFMPEG_BASE_BACKOFF_MS   = 2000;        // backoff awal 2s
const FFMPEG_MAX_BACKOFF_MS    = 60 * 1000;   // backoff maksimum 60s
const FFMPEG_COOL_OFF_MS       = 5 * 60 * 1000; // cooldown 5 menit jika sudah melewati max retry

if (!fs.existsSync(RECORDINGS_DIR)) fs.mkdirSync(RECORDINGS_DIR, { recursive: true });
if (!fs.existsSync(HLS_ROOT_DIR))   fs.mkdirSync(HLS_ROOT_DIR,   { recursive: true });

/** ====== STATE ====== */
const processes = new Map();           // camId → child_process
const procState = new Map();           // camId → { retries, nextDelay, coolUntil }
const intervals = new Map();           // name → setInterval ref
const activeWatchers = new Map();      // dir → chokidar FSWatcher
const lastFilePerDir = new Map();      // dirPath → last detected filePath (UNTUK LOGIKA BARU)

/** ====== UTIL ====== */
const now = () => Date.now();

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function waitFileStable(filePath, stableMs = POSTPROC_STABLE_MS, timeoutMs = 20000) {
  let lastSize = -1;
  let lastChange = now();
  const start = now();

  while (true) {
    try {
      const st = await fsp.stat(filePath);
      if (st.size !== lastSize) {
        lastSize = st.size;
        lastChange = now();
      }
      if (now() - lastChange >= stableMs) return true;
      if (now() - start > timeoutMs) return true; // timeout tapi tetap lanjut
      await sleep(250);
    } catch (e) {
      // Jika file belum ada sesaat karena rename/replace, coba lagi
      await sleep(250);
    }
  }
}

function sanitizeCamId(camId) {
  const n = Number(camId);
  if (!Number.isInteger(n) || n < 0) throw new Error('Invalid camera id');
  return n;
}

async function getVideoDuration(filePath) {
  return new Promise((resolve, reject) => {
    const ffprobe = spawn('ffprobe', [
      '-v', 'quiet',
      '-print_format', 'json',
      '-show_format',
      filePath
    ], { windowsHide: true });

    let jsonData = '';
    ffprobe.stdout.on('data', (d) => { jsonData += d.toString(); });
    ffprobe.on('error', (err) => reject(err));
    ffprobe.on('close', (code) => {
      if (code !== 0) return reject(new Error(`ffprobe exited with code ${code}`));
      try {
        const metadata = JSON.parse(jsonData);
        resolve(parseFloat(metadata.format?.duration) || 0);
      } catch (e) { reject(e); }
    });
  });
}

function parseTimestampFromNameOrMtime(absFile) {
  const file = path.basename(absFile);
  const name = file.replace(/\.mp4$/i, '');
  const [datePart, timePart] = name.split('_');
  let ts = NaN;
  if (datePart && timePart) {
    const [y, m, d] = datePart.split('-').map(Number);
    const [H, M, S] = timePart.split('-').map(Number);
    const dt = new Date(y, (m || 1) - 1, d || 1, H || 0, M || 0, S || 0);
    ts = dt.getTime();
  }
  if (!Number.isFinite(ts) || Number.isNaN(ts)) {
    // fallback: mtime
    try {
      const st = fs.statSync(absFile);
      ts = st.mtimeMs;
    } catch {}
  }
  return Math.floor(ts);
}

/** ====== JOB QUEUE UNTUK REMUX FASTSTART ====== */
const jobQueue = [];
let runningJobs = 0;
const inQueue = new Set();             // set of absolute filePath sedang/telah diantrikan
const pendingDebounce = new Map();      // file → timeoutId (untuk debounce event beruntun)
const processedOnce = new Set();        // mencegah pengulangan process berlebih

function enqueueRemuxJob(filePath) {
  if (!FASTSTART_POSTPROC) return;
  if (!filePath.endsWith('.mp4')) return;

  console.log('[RECORDER] Segmen file baru tersimpan dan selesai ditulis:', filePath);

  // debounce 500ms tiap file
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
      .catch(() => {})
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
    await waitFileStable(filePath);

    // Hindari remux berulang pada file yang sama
    const key = filePath + ':' + fs.statSync(filePath).size;
    if (processedOnce.has(key)) {
      inQueue.delete(filePath);
      return;
    }

    await fixMoovAtom(filePath);
    console.log('[FASTSTART] Sukses remux:', filePath);

    // Tandai fingerprint ukuran terakhir agar tidak di-remux ulang
    processedOnce.add(key);

    // === TAMBAHKAN KE DB SETELAH REMUX SUKSES ===
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
        console.log(`[RECORDER] Added new recording to DB: ${relativePath}`);
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
      job.nextDelay = Math.min(job.nextDelay * 1.5, 10_000);
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

    const ff = spawn('ffmpeg', ['-v','error','-y','-i',filePath,'-c','copy','-movflags','+faststart',tmpFile], { windowsHide: true });
    let errLog = '';
    ff.stderr.on('data', (d) => { errLog += d.toString(); });
    ff.on('error', (err) => reject(err));
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

/** ====== SYNC FILE SYSTEM ↔ DB ====== */
async function syncExistingFilesOnce() {
  console.log('[RECORDER] Running one-time sync for existing files...');
  try {
    const cameras = await database.getAllCameras();
    for (const camera of cameras) {
      const camId = sanitizeCamId(camera.id);
      const camDir = path.join(RECORDINGS_DIR, `cam_${camId}`);
      if (!fs.existsSync(camDir)) continue;

      const existingRecordings = await database.getRecordingsByCameraId(camId);
      const existingPaths = new Set(existingRecordings.map(rec => rec.file_path));

      const filesOnDisk = (await fsp.readdir(camDir)).filter(f => f.endsWith('.mp4'));

      for (const file of filesOnDisk) {
        const relativePath = `/recordings/cam_${camId}/${file}`;
        if (existingPaths.has(relativePath)) continue;

        try {
          console.log(`[RECORDER-SYNC] Found unsynced file, processing: ${file}`);
          const filePath = path.join(camDir, file);
          const duration = await getVideoDuration(filePath);
          const timestamp = parseTimestampFromNameOrMtime(filePath);

          if (duration > 0 && Number.isFinite(timestamp)) {
            await database.addRecording({
              camera_id: camId,
              file_path: relativePath,
              timestamp,
              duration
            });
          }
        } catch (e) {
          console.warn(`[RECORDER-SYNC] Failed to sync file ${file}:`, e.message);
        }
      }
    }
  } catch (e) {
    console.error('[RECORDER] Error during one-time sync:', e);
  }
  console.log('[RECORDER] One-time sync finished.');
}

async function periodicSyncDbToDisk() {
  try {
    const cameras = await database.getAllCameras();
    for (const camera of cameras) {
      const camId = sanitizeCamId(camera.id);
      const camDir = path.join(RECORDINGS_DIR, `cam_${camId}`);
      if (!fs.existsSync(camDir)) continue;

      // Hapus entry DB yang file fisiknya sudah hilang
      const recs = await database.getRecordingsByCameraId(camId);
      for (const rec of recs) {
        const abs = path.join(__dirname, rec.file_path.replace(/^\//, ''));
        if (!fs.existsSync(abs)) {
          try {
            await database.deleteRecordingByPath(rec.file_path);
            console.log('[RECORDER-SYNC] Removed dead DB entry:', rec.file_path);
          } catch (e) {
            console.warn('[RECORDER-SYNC] Failed to remove DB entry:', rec.file_path, e.message);
          }
        }
      }
    }
  } catch (e) {
    console.error('[RECORDER] periodicSyncDbToDisk error:', e);
  }
}

/** ====== CLEANUP STORAGE (ASYNC) ====== */
async function cleanupStorage() {
  try {
    if (!fs.existsSync(RECORDINGS_DIR)) return;

    async function listFiles(dir) {
      const out = [];
      const entries = await fsp.readdir(dir, { withFileTypes: true });
      for (const ent of entries) {
        const fp = path.join(dir, ent.name);
        try {
          if (ent.isFile()) {
            if (fp.endsWith('.mp4')) {
              const st = await fsp.stat(fp);
              out.push({ file: fp, time: st.mtimeMs, size: st.size });
            }
          } else if (ent.isDirectory()) {
            out.push(...await listFiles(fp));
          }
        } catch {}
      }
      return out;
    }

    let list = (await listFiles(RECORDINGS_DIR)).sort((a, b) => a.time - b.time);
    let total = list.reduce((acc, f) => acc + f.size, 0);

    while (total > MAX_STORAGE && list.length > 0) {
      const oldest = list.shift();
      try {
        const camId = path.basename(path.dirname(oldest.file)).replace('cam_','');
        const fileName = path.basename(oldest.file);
        const relativePath = `/recordings/cam_${camId}/${fileName}`;

        await fsp.unlink(oldest.file);
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

/** ====== REKAMAN (FFMPEG) & WATCHER ====== */
function buildFfmpegArgs(camera, camRecDir, camHlsDir) {
  const recordingTemplate = path.join(camRecDir, '%Y-%m-%d_%H-%M-%S.mp4');
  const hlsIndexPath = path.join(camHlsDir, 'index.m3u8');

  return [
    '-rtsp_transport','tcp',
    '-i', camera.rtsp_url,

    // Rekam ke file segment mp4
    '-map','0:v:0',
    '-c:v','copy',
    '-an',
    '-f','segment',
    '-reset_timestamps','1',
    '-segment_time','180', // <-- Segmen 3 menit
    '-strftime','1',
    '-segment_format_options','movflags=+faststart',
    recordingTemplate,

    // HLS live preview
    '-map','0:v:0',
    '-c:v','copy',
    '-an',
    '-f','hls',
    '-hls_time', String(HLS_TIME_SECONDS),
    '-hls_list_size', String(HLS_LIST_SIZE),
    '-hls_flags','delete_segments+append_list+independent_segments',
    path.join(camHlsDir, 'index.m3u8')
  ];
}

function startFFmpegForCamera(camera) {
  const camId = sanitizeCamId(camera.id);

  if (processes.has(camId)) {
    console.log(`[RECORDER] FFmpeg for cam ${camId} already running. Skipping.`);
    return;
  }

  const camRecDir = path.join(RECORDINGS_DIR, `cam_${camId}`);
  const camHlsDir = path.join(HLS_ROOT_DIR,   `cam_${camId}`);
  fs.mkdirSync(camRecDir, { recursive: true });
  fs.mkdirSync(camHlsDir, { recursive: true });

  const args = buildFfmpegArgs(camera, camRecDir, camHlsDir);

  const st = procState.get(camId) || { retries: 0, nextDelay: FFMPEG_BASE_BACKOFF_MS, coolUntil: 0 };

  if (now() < st.coolUntil) {
    const waitMs = st.coolUntil - now();
    console.warn(`[RECORDER] Cam ${camId} in cool-off for ${Math.ceil(waitMs/1000)}s.`);
    setTimeout(() => startFFmpegForCamera(camera), waitMs);
    return;
  }

  console.log(`[RECORDER] Starting FFmpeg for cam ${camId}...`);
  const proc = spawn('ffmpeg', args, { stdio: ['ignore', 'ignore', 'pipe'], windowsHide: true });

  proc.stderr.on('data', (d) => {
    // TULISKAN log penting bila perlu
    const line = d.toString();
    if (/(Connection|timed out|Invalid data|error)/i.test(line)) {
      console.warn(`[FFMPEG ${camId}] ${line.trim()}`);
    }
  });

  proc.on('close', (code, signal) => {
    console.warn(`[RECORDER] FFmpeg for cam ${camId} exited (code=${code}, signal=${signal}).`);
    processes.delete(camId);

    // Update backoff state
    st.retries += 1;
    if (st.retries >= FFMPEG_MAX_RETRY) {
      st.coolUntil = now() + FFMPEG_COOL_OFF_MS;
      st.retries = 0;
      st.nextDelay = FFMPEG_BASE_BACKOFF_MS;
      console.warn(`[RECORDER] Cam ${camId} reached max retry. Cool-off for ${FFMPEG_COOL_OFF_MS/1000}s.`);
      setTimeout(() => startFFmpegForCamera(camera), FFMPEG_COOL_OFF_MS);
    } else {
      st.nextDelay = Math.min(st.nextDelay * 1.7, FFMPEG_MAX_BACKOFF_MS);
      setTimeout(() => startFFmpegForCamera(camera), st.nextDelay);
    }
    procState.set(camId, st);
  });

  proc.on('spawn', () => {
    // Reset retry state ketika berhasil start
    st.retries = 0;
    st.nextDelay = FFMPEG_BASE_BACKOFF_MS;
    st.coolUntil = 0;
    procState.set(camId, st);
  });

  processes.set(camId, proc);

  // Mulai watcher direktori rekaman (chokidar)
  startDirWatcher(camRecDir);
}

// =========================================================================
// ==================== FUNGSI YANG DIPERBARUI =============================
// =========================================================================
function startDirWatcher(dirPath) {
  if (activeWatchers.has(dirPath)) return;

  const watcher = chokidar.watch(dirPath, {
    persistent: true,
    depth: 0,
    ignoreInitial: true,
    // Kita masih menggunakan awaitWriteFinish untuk event 'change' sebagai fallback
    awaitWriteFinish: {
      stabilityThreshold: POSTPROC_STABLE_MS,
      pollInterval: 200
    }
  });

  // LOGIKA BARU: event 'add' sekarang memproses file SEBELUMNYA
  watcher.on('add', (newFile) => {
    // Ambil file sebelumnya yang tersimpan untuk direktori ini
    const previousFile = lastFilePerDir.get(dirPath);

    // Jika ada file sebelumnya (bukan file pertama yang dibuat)
    if (previousFile && previousFile !== newFile) {
      console.log(`[RECORDER] File baru terdeteksi: ${path.basename(newFile)}. Memproses file sebelumnya: ${path.basename(previousFile)}`);
      // Jalankan job untuk file yang sudah selesai ditulis
      enqueueRemuxJob(previousFile);
    }

    // Selalu update file terbaru yang terdeteksi untuk direktori ini
    lastFilePerDir.set(dirPath, newFile);
  });

  // LOGIKA LAMA
  // Berguna untuk memproses segmen TERAKHIR saat rekaman dihentikan,
  // karena tidak akan ada event 'add' lagi untuk memicunya.
  // watcher.on('change', (fp) => enqueueRemuxJob(fp));

  watcher.on('error', (e) => console.warn('[RECORDER] Watcher error:', dirPath, e.message));

  activeWatchers.set(dirPath, watcher);
}

/** ====== START/STOP LIFECYCLE ====== */
async function startAllRecordings() {
  const cameras = await database.getAllCameras();
  if (!cameras || cameras.length === 0) {
    console.log('[RECORDER] No cameras found.');
    return;
  }

  // Jalankan sync satu kali untuk file yang sudah ada
  await syncExistingFilesOnce();

  // Mulai semua proses perekaman
  cameras.forEach((cam) => startFFmpegForCamera(cam));

  // Cleanup interval
  if (!intervals.has('global_cleanup')) {
    cleanupStorage(); // Jalankan segera saat start
    const itv = setInterval(cleanupStorage, CLEANUP_INTERVAL_MS);
    intervals.set('global_cleanup', itv);
  }

  // Periodic DB sync interval
  if (!intervals.has('periodic_sync')) {
    const itv = setInterval(periodicSyncDbToDisk, PERIODIC_SYNC_MS);
    intervals.set('periodic_sync', itv);
  }
}

async function stopAllRecordings() {
  // Hentikan watchers
  for (const [dir, watcher] of activeWatchers.entries()) {
    try { await watcher.close(); } catch {}
    activeWatchers.delete(dir);
  }

  // Hentikan interval
  for (const [id, itv] of intervals.entries()) {
    clearInterval(itv);
    intervals.delete(id);
  }

  // Graceful stop ffmpeg
  const kills = [];
  for (const [camId, proc] of processes.entries()) {
    kills.push(new Promise(resolve => {
      let done = false;
      const timeout = setTimeout(() => {
        if (done) return;
        try { proc.kill('SIGKILL'); } catch {}
        done = true; resolve();
      }, 4000); // beri waktu flush 4 detik

      try { proc.kill('SIGTERM'); } catch {}
      proc.once('close', () => { if (!done) { clearTimeout(timeout); done = true; resolve(); } });
    }));
    processes.delete(camId);
  }
  await Promise.all(kills);
  console.log('[RECORDER] All recordings and watchers stopped.');
}

module.exports = {
  startAllRecordings,
  stopAllRecordings,
};