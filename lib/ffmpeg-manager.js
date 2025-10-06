'use strict';

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const ffmpegStatic = require('ffmpeg-static');
const { now, sanitizeCamId } = require('./utils');

const {
  DASH_ROOT_DIR,
  FFMPEG_MAX_RETRY,
  FFMPEG_BASE_BACKOFF_MS,
  FFMPEG_MAX_BACKOFF_MS,
  FFMPEG_COOL_OFF_MS,
  FFMPEG_WATCHDOG_TIMEOUT_MS,
} = require('./config');

// State
const processes = new Map();
const procState = new Map();
const watchdogTimers = new Map();

function buildFfmpegArgs(camera, camRecDir, camDashDir) {
  const recordingTemplate = path.join(path.relative(camDashDir, camRecDir), '%Y-%m-%d_%H-%M-%S.mp4');

  const videoCodecArgs = camera.is_hevc
    ? ['-c:v', 'libx264', '-preset', 'veryfast', '-b:v', '2000k']
    : ['-c:v', 'copy'];

  return [
    // Input
    '-rtsp_transport', 'tcp',
    '-i', camera.rtsp_url,

    // Output 1: MP4 Segments
    '-map', '0:v:0',
    '-c:v', 'copy',
    '-an',
    '-f', 'segment',
    '-reset_timestamps', '1',
    '-segment_time', '180',
    '-strftime', '1',
    '-segment_format_options', 'movflags=+faststart',
    recordingTemplate,

    // Output 2: DASH Manifest
    '-map', '0:v:0',
    ...videoCodecArgs,
    '-an',
    '-f', 'dash',
    '-seg_duration', '4',
    '-use_template', '1',
    '-use_timeline', '1',
    '-init_seg_name', 'init-stream$RepresentationID$.m4s',
    '-media_seg_name', 'chunk-stream$RepresentationID$-$Number%05d$.m4s',
    '-window_size', '10',
    '-extra_window_size', '5',
    '-remove_at_exit', '1',
    'index.mpd'
  ];
}

function startFFmpegForCamera(camera, startDirWatcherCallback) {
  const camId = sanitizeCamId(camera.id);

  if (processes.has(camId)) {
    console.log(`[FFMPEG] Process for cam ${camId} already running. Skipping.`);
    return;
  }

  if (!camera.storage_path) {
    console.warn(`[FFMPEG] Camera ${camId} (${camera.name}) has no storage path assigned. Skipping recording.`);
    return;
  }

  const camRecDir = path.join(camera.storage_path, `cam_${camId}`);
  const camDashDir = path.join(DASH_ROOT_DIR, `cam_${camId}`);
  fs.mkdirSync(camRecDir, { recursive: true });
  fs.mkdirSync(camDashDir, { recursive: true });

  const args = buildFfmpegArgs(camera, camRecDir, camDashDir);

  const st = procState.get(camId) || { retries: 0, nextDelay: FFMPEG_BASE_BACKOFF_MS, coolUntil: 0 };

  if (now() < st.coolUntil) {
    const waitMs = st.coolUntil - now();
    console.warn(`[FFMPEG] Cam ${camId} in cool-off for ${Math.ceil(waitMs/1000)}s.`);
    setTimeout(() => startFFmpegForCamera(camera, startDirWatcherCallback), waitMs);
    return;
  }

  console.log(`[FFMPEG] Starting for cam ${camId}...`);
  const proc = spawn(ffmpegStatic, args, { stdio: ['ignore', 'ignore', 'pipe'], windowsHide: true, cwd: camDashDir });

  const resetWatchdog = () => {
    clearTimeout(watchdogTimers.get(camId));
    const timer = setTimeout(() => {
      console.warn(`[FFMPEG] Watchdog timeout for cam ${camId}. Killing process.`);
      proc.kill('SIGKILL');
    }, FFMPEG_WATCHDOG_TIMEOUT_MS);
    watchdogTimers.set(camId, timer);
  };

  proc.stderr.on('data', (d) => {
    resetWatchdog();
    const line = d.toString();

    // Cek keberhasilan koneksi
    if (st.retries > 0 && /Input #0, rtsp/i.test(line)) {
      console.log(`[FFMPEG] Connection for cam ${camId} restored.`);
      st.retries = 0;
      st.nextDelay = FFMPEG_BASE_BACKOFF_MS;
      procState.set(camId, st);
    }

    if (/(Connection timed out|Could not open|Invalid data found when processing input)/i.test(line)) {
      console.warn(`[FFMPEG ${camId}] Fatal error detected: "${line.trim()}". Killing process to force restart.`);
      proc.kill('SIGKILL');
    } else if (/(error)/i.test(line)) {
      console.warn(`[FFMPEG ${camId}] ${line.trim()}`);
    }
  });

  proc.on('close', (code, signal) => {
    clearTimeout(watchdogTimers.get(camId));
    watchdogTimers.delete(camId);
    processes.delete(camId);

    if (signal !== 'SIGTERM') {
      st.retries += 1;

      if (st.retries === 1) {
        console.warn(`[FFMPEG] Process for cam ${camId} exited unexpectedly. Retrying with backoff...`);
      }

      if (st.retries >= FFMPEG_MAX_RETRY) {
        st.coolUntil = now() + FFMPEG_COOL_OFF_MS;
        st.retries = 0;
        st.nextDelay = FFMPEG_BASE_BACKOFF_MS;
        console.warn(`[FFMPEG] Cam ${camId} reached max retry. Cool-off for ${FFMPEG_COOL_OFF_MS / 1000}s.`);
        setTimeout(() => startFFmpegForCamera(camera, startDirWatcherCallback), FFMPEG_COOL_OFF_MS);
      } else {
        st.nextDelay = Math.min(st.nextDelay * 1.7, FFMPEG_MAX_BACKOFF_MS);
        setTimeout(() => startFFmpegForCamera(camera, startDirWatcherCallback), st.nextDelay);
      }
      procState.set(camId, st);
    } else {
      console.log(`[FFMPEG] Process for cam ${camId} stopped.`);
    }
  });

  proc.on('spawn', () => {
    console.log(`[FFMPEG] Spawned process for cam ${camId}.`);
    st.coolUntil = 0; // Reset cool-off on new spawn attempt
    procState.set(camId, st);
    resetWatchdog();
  });

  processes.set(camId, proc);

  if (startDirWatcherCallback) {
    startDirWatcherCallback(camRecDir);
  }
}

async function stopAllFFmpeg() {
    const kills = [];
    for (const [camId, proc] of processes.entries()) {
        kills.push(new Promise(resolve => {
            let done = false;
            const timeout = setTimeout(() => {
                if (done) return;
                console.warn(`[FFMPEG] Process for cam ${camId} did not exit gracefully. Forcing kill.`);
                try { proc.kill('SIGKILL'); } catch {}
                done = true;
                resolve();
            }, 4000);

            proc.on('close', () => {
                if (!done) {
                    clearTimeout(timeout);
                    done = true;
                    resolve();
                }
            });
            try { proc.kill('SIGTERM'); } catch {}
        }));
        processes.delete(camId);
    }
    await Promise.all(kills);
    console.log('[FFMPEG] All processes stopped.');
}


module.exports = {
  startFFmpegForCamera,
  stopAllFFmpeg,
};