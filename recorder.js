// recorder.js

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const database = require('./lib/database');

/** ====== KONFIGURASI ====== */
const RECORDINGS_DIR = path.join(__dirname, 'recordings');
const HLS_ROOT_DIR   = path.join(__dirname, 'public', 'hls');
const MAX_STORAGE    = 600 * 1024 * 1024 * 1024; // 600 GB total (ubah sesuai kebutuhan)
const SYNC_INTERVAL_MS = 5 * 60 * 1000; // 5 menit

if (!fs.existsSync(RECORDINGS_DIR)) fs.mkdirSync(RECORDINGS_DIR, { recursive: true });
if (!fs.existsSync(HLS_ROOT_DIR))   fs.mkdirSync(HLS_ROOT_DIR,   { recursive: true });

const processes = new Map();
const intervals = new Map();

/** Helper untuk mendapatkan durasi video dengan ffprobe */
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
        resolve(parseFloat(metadata.format.duration) || 0);
      } catch (e) {
        reject(e);
      }
    });
  });
}

/** Sinkronisasi rekaman dari filesystem ke database */
async function syncFileSystemToDatabase() {
  console.log('[RECORDER] Starting filesystem sync to database...');
  try {
    const cameras = await database.getAllCameras();
    for (const camera of cameras) {
      const camDir = path.join(RECORDINGS_DIR, `cam_${camera.id}`);
      if (!fs.existsSync(camDir)) continue;

      const files = fs.readdirSync(camDir).filter(f => f.endsWith('.mp4'));
      for (const file of files) {
        try {
          const filePath = path.join(camDir, file);
          const relativePath = `/recordings/cam_${camera.id}/${file}`;
          const duration = await getVideoDuration(filePath);

          const name = path.basename(file, '.mp4');
          const [datePart, timePart] = name.split('_');
          const [year, month, day] = datePart.split('-').map(Number);
          const [hour, minute, second] = timePart.split('-').map(Number);
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
          // Abaikan jika file rusak atau ffprobe gagal, lanjut ke file berikutnya
          // console.error(`[RECORDER] Failed to process file ${file}:`, e.message);
        }
      }
    }
  } catch (e) {
    console.error('[RECORDER] Error during filesystem sync:', e);
  }
  console.log('[RECORDER] Filesystem sync finished.');
}

/** Hapus file paling lama dan sinkronkan ke DB */
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

    let list = listFiles(RECORDINGS_DIR).sort((a, b) => a.time - b.time);
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

/** Start satu proses ffmpeg per kamera */
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

  const args = [
    '-rtsp_transport', 'tcp',
    '-i', camera.rtsp_url,
    '-map', '0:v:0', '-c:v', 'copy', '-an',
    '-f', 'segment',
    '-reset_timestamps', '1',
    '-segment_time', '180', // 3 menit
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

  proc.stderr.on('data', (d) => { /* process.stdout.write(`[FFMPEG ${camId}] ${d}`); */ });

  proc.on('close', (code, signal) => {
    console.warn(`[RECORDER] FFmpeg for cam ${camId} exited (code=${code}, signal=${signal}). Restarting in 2s...`);
    processes.delete(camId);
    setTimeout(() => startFFmpegForCamera(camera), 2000);
  });

  processes.set(camId, proc);
}

async function startAllRecordings() {
  const cameras = await database.getAllCameras();
  if (!cameras || cameras.length === 0) {
    console.log('[RECORDER] No cameras found.');
    return;
  }
  cameras.forEach((cam) => startFFmpegForCamera(cam));

  // Jalankan cleanup & sync saat start dan setiap interval
  if (!intervals.has('global_sync')) {
    cleanupStorage(); // Jalankan segera saat start
    syncFileSystemToDatabase(); // Jalankan segera saat start

    const itv = setInterval(() => {
      cleanupStorage();
      syncFileSystemToDatabase();
    }, SYNC_INTERVAL_MS);
    intervals.set('global_sync', itv);
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
}

module.exports = {
  startAllRecordings,
  stopAllRecordings,
};