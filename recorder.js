// recorder.js

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const database = require('./lib/database');

/** ====== KONFIGURASI ====== */
const RECORDINGS_DIR      = path.join(__dirname, 'recordings');
const HLS_ROOT_DIR        = path.join(__dirname, 'public', 'hls');
const MAX_STORAGE         = 600 * 1024 * 1024 * 1024; // 600 GB total (ubah sesuai kebutuhan)
const CLEANUP_INTERVAL_MS = 5 * 60 * 1000; // 5 menit (hanya untuk cleanup)

// Pengaturan post-process faststart
const FASTSTART_POSTPROC      = true;        // aktif/nonaktifkan remux faststart
const POSTPROC_DELAY_MS       = 1500;        // tunda sebelum mencoba remux (biar file benar2 closed)
const POSTPROC_STABLE_MS      = 1200;        // waktu minimal file tidak berubah ukuran sebelum diproses
const POSTPROC_MAX_RETRY      = 5;           // maksimal retry
const POSTPROC_RETRY_BACKOFF  = 1000;        // jeda retry awal (bertumbuh)
const QUEUE_CONCURRENCY       = 2;           // maksimal proses ffmpeg remux berjalan bersamaan

if (!fs.existsSync(RECORDINGS_DIR)) fs.mkdirSync(RECORDINGS_DIR, { recursive: true });
if (!fs.existsSync(HLS_ROOT_DIR))   fs.mkdirSync(HLS_ROOT_DIR,   { recursive: true });

const processes = new Map();
const intervals = new Map();

/** ====== UTIL ====== */

function now() { return Date.now(); }

function waitFileStable(filePath, stableMs = POSTPROC_STABLE_MS, timeoutMs = 20000) {
  return new Promise((resolve, reject) => {
    let lastSize = -1;
    let lastChange = now();
    const start = now();

    const itv = setInterval(() => {
      fs.stat(filePath, (err, st) => {
        if (err) {
          clearInterval(itv);
          return reject(err);
        }
        if (st.size !== lastSize) {
          lastSize = st.size;
          lastChange = now();
        }
        if (now() - lastChange >= stableMs) {
          clearInterval(itv);
          resolve(true);
        }
        if (now() - start > timeoutMs) {
          clearInterval(itv);
          resolve(true);
        }
      });
    }, 250);
  });
}

function getVideoDuration(filePath) {
  return new Promise((resolve, reject) => {
    const ffprobe = spawn('ffprobe', [
      '-v', 'quiet',
      '-print_format', 'json',
      '-show_format',
      filePath
    ], { windowsHide: true });

    let jsonData = '';
    ffprobe.stdout.on('data', (data) => { jsonData += data.toString(); });
    ffprobe.on('error', (err) => reject(err));
    ffprobe.on('close', (code) => {
      if (code !== 0) return reject(new Error(`ffprobe exited with code ${code}`));
      try {
        const metadata = JSON.parse(jsonData);
        resolve(parseFloat(metadata.format?.duration) || 0);
      } catch (e) {
        reject(e);
      }
    });
  });
}

/** ====== JOB QUEUE UNTUK REMUX FASTSTART ====== */

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

/**
 * [MODIFIKASI UTAMA]
 * Proses job remux dan setelah berhasil, langsung tambahkan entri ke database.
 */
async function processJob(job) {
  const { filePath } = job;
  try {
    if (!fs.existsSync(filePath)) {
      console.warn('[FASTSTART] File hilang sebelum diproses:', filePath);
      inQueue.delete(filePath);
      return;
    }

    await new Promise(r => setTimeout(r, POSTPROC_DELAY_MS));
    await waitFileStable(filePath);

    await fixMoovAtom(filePath);
    console.log('[FASTSTART] Sukses remux:', filePath);

    // === TAMBAHKAN KE DB SETELAH REMUX SUKSES ===
    try {
      const duration = await getVideoDuration(filePath);
      const file = path.basename(filePath);
      const dirName = path.basename(path.dirname(filePath));
      const camId = parseInt(dirName.replace('cam_', ''), 10);
      const relativePath = `/recordings/${dirName}/${file}`;

      const name = path.basename(file, '.mp4');
      const [datePart, timePart] = name.split('_');
      const [year, month, day] = (datePart || '').split('-').map(Number);
      const [hour, minute, second] = (timePart || '').split('-').map(Number);
      const timestamp = new Date(year, month - 1, day, hour, minute, second).getTime();

      if (duration > 0 && !isNaN(timestamp) && !isNaN(camId)) {
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
    // === AKHIR LOGIKA PENAMBAHAN KE DB ===

    inQueue.delete(filePath);

  } catch (e) {
    job.attempts++;
    if (job.attempts < POSTPROC_MAX_RETRY) {
      console.warn(`[FASTSTART] Gagal remux (attempt ${job.attempts}) untuk ${filePath}: ${e.message}. Retry...`);
      await new Promise(r => setTimeout(r, job.nextDelay));
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

/**
 * [FUNGSI BARU]
 * Sinkronisasi satu kali saat startup untuk file yang belum ada di DB.
 */
async function syncExistingFilesOnce() {
  console.log('[RECORDER] Running one-time sync for existing files...');
  try {
    const cameras = await database.getAllCameras();
    for (const camera of cameras) {
      const camDir = path.join(RECORDINGS_DIR, `cam_${camera.id}`);
      if (!fs.existsSync(camDir)) continue;

      const existingRecordings = await database.getRecordingsByCameraId(camera.id);
      const existingPaths = new Set(existingRecordings.map(rec => rec.file_path));
      const filesOnDisk = fs.readdirSync(camDir).filter(f => f.endsWith('.mp4'));

      for (const file of filesOnDisk) {
        const relativePath = `/recordings/cam_${camera.id}/${file}`;
        if (existingPaths.has(relativePath)) continue;

        try {
          console.log(`[RECORDER-SYNC] Found unsynced file, processing: ${file}`);
          const filePath = path.join(camDir, file);
          const duration = await getVideoDuration(filePath);

          const name = path.basename(file, '.mp4');
          const [datePart, timePart] = name.split('_');
          const [year, month, day] = (datePart || '').split('-').map(Number);
          const [hour, minute, second] = (timePart || '').split('-').map(Number);
          const timestamp = new Date(year, month - 1, day, hour, minute, second).getTime();

          if (duration > 0 && !isNaN(timestamp)) {
            await database.addRecording({
              camera_id: camera.id,
              file_path: relativePath,
              timestamp: timestamp,
              duration: duration
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

/** ====== REKAMAN (FFMPEG) & WATCHER ====== */

function startFFmpegForCamera(camera) {
  const camId = camera.id;
  if (!camId) {
    console.error('[RECORDER] Camera without id:', camera);
    return;
  }
  if (processes.has(camId)) {
    console.log(`[RECORDER] FFmpeg for cam ${camId} already running. Skipping.`);
    return;
  }

  const camRecDir = path.join(RECORDINGS_DIR, `cam_${camId}`);
  const camHlsDir = path.join(HLS_ROOT_DIR,   `cam_${camId}`);
  fs.mkdirSync(camRecDir, { recursive: true });
  fs.mkdirSync(camHlsDir, { recursive: true });

  const recordingTemplate = path.join(camRecDir, '%Y-%m-%d_%H-%M-%S.mp4');
  const hlsIndexPath = path.join(camHlsDir, 'index.m3u8');

  const args = ['-rtsp_transport','tcp','-i',camera.rtsp_url,'-map','0:v:0','-c:v','copy','-an','-f','segment','-reset_timestamps','1','-segment_time','180','-strftime','1','-segment_format_options','movflags=+faststart',recordingTemplate,'-map','0:v:0','-c:v','copy','-an','-f','hls','-hls_time','1','-hls_list_size','5','-hls_flags','delete_segments+append_list+independent_segments',hlsIndexPath];
  
  console.log(`[RECORDER] Starting FFmpeg for cam ${camId}...`);
  const proc = spawn('ffmpeg', args, { stdio: ['ignore', 'ignore', 'pipe'], windowsHide: true });
  
  proc.on('close', (code, signal) => {
    console.warn(`[RECORDER] FFmpeg for cam ${camId} exited (code=${code}, signal=${signal}). Restarting in 2s...`);
    processes.delete(camId);
    setTimeout(() => startFFmpegForCamera(camera), 2000);
  });
  processes.set(camId, proc);
  startDirWatcher(camRecDir);
}

const activeWatchers = new Map();
function startDirWatcher(dirPath) {
  if (activeWatchers.has(dirPath)) return;

  const watcher = fs.watch(dirPath, { persistent: true }, (eventType, filename) => {
    if (!filename || !filename.endsWith('.mp4')) return;
    const full = path.join(dirPath, filename);
    fs.stat(full, (err, st) => {
      if (!err && st.isFile()) {
        enqueueRemuxJob(full);
      }
    });
  });
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

  if (!intervals.has('global_cleanup')) {
    cleanupStorage(); // Jalankan segera saat start
    
    // Interval sekarang HANYA untuk cleanup storage
    const itv = setInterval(cleanupStorage, CLEANUP_INTERVAL_MS);
    intervals.set('global_cleanup', itv);
  }
}

function stopAllRecordings() {
  for (const [camId, proc] of processes.entries()) {
    try { proc.kill('SIGTERM'); } catch {}
    processes.delete(camId);
  }
  for (const [id, itv] of intervals.entries()) {
    clearInterval(itv);
    intervals.delete(id);
  }
  for (const [dir, watcher] of activeWatchers.entries()) {
    try { watcher.close(); } catch {}
    activeWatchers.delete(dir);
  }
  console.log('[RECORDER] All recordings and watchers stopped.');
}

module.exports = {
  startAllRecordings,
  stopAllRecordings,
};