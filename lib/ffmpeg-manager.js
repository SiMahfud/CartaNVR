'use strict';

const fs = require('fs');
const path = require('path');
const net = require('net');
const { spawn } = require('child_process');
const ffmpegStatic = require('ffmpeg-static');
const { now, sanitizeCamId } = require('./utils');
const logger = require('./logger');

const {
  DASH_ROOT_DIR,
  FFMPEG_MAX_RETRY,
  FFMPEG_BASE_BACKOFF_MS,
  FFMPEG_MAX_BACKOFF_MS,
  FFMPEG_COOL_OFF_MS,
  FFMPEG_WATCHDOG_TIMEOUT_MS,
} = require('./config');

// State
const processes = new Map();      // camId -> ChildProcess
const activeProbes = new Map();   // camId -> net.Socket
const restartTimers = new Map();  // camId -> setTimeout
const watchdogTimers = new Map(); // camId -> setTimeout
const procState = new Map();      // camId -> { retries, nextDelay, coolUntil, manualStop, isMonitoring }

function buildFfmpegArgs(camera, camRecDir, camDashDir) {
  const recordingTemplate = path.join(path.relative(camDashDir, camRecDir), '%Y-%m-%d_%H-%M-%S.mp4');

  const args = [
    // Global Options
    '-threads', '1', // Reduce RAM by limiting threads (especially on high-core servers)

    // Input Options
    '-rtsp_transport', 'tcp',
    '-thread_queue_size', '512',
    '-probesize', '10M',
    '-analyzeduration', '10M',
    '-i', camera.rtsp_url,

    // Output 1: MP4 Segments (For Recording) - ALWAYS ON
    '-map', '0:v:0',
    ...(camera.has_audio ? ['-map', '0:a:0?', '-c:a', 'aac', '-b:a', '128k'] : []),
    '-c:v', 'copy',
    ...(camera.has_audio ? [] : ['-an']),
    '-f', 'segment',
    '-reset_timestamps', '1',
    '-segment_time', '180',
    '-strftime', '1',
    // Removed movflags=+faststart for segments to reduce memory overhead
    recordingTemplate,
  ];

  if (camera.stream_method === 'go2rtc') {
    // go2rtc handles streaming independently — FFmpeg only records.
    // No additional output needed, saving significant CPU.
  } else if (camera.stream_method === 'jsmpeg') {
    // Output 2: JSMpeg (MPEG-1)
    args.push(
      '-map', '0:v:0',
      ...(camera.has_audio ? ['-map', '0:a:0?', '-c:a', 'mp2'] : []),
      '-c:v', 'mpeg1video',
      '-b:v', '1500k',
      '-bf', '0',
      '-f', 'mpegts',
      `http://127.0.0.1:9999/input/${camera.id}`
    );
  } else {
    // Output 2: DASH (Default)
    const videoCodecArgs = camera.is_hevc
      ? ['-c:v', 'libx264', '-preset', 'ultrafast', '-b:v', '2000k'] // Use ultrafast for lower memory/CPU
      : ['-c:v', 'copy'];

    args.push(
      '-map', '0:v:0',
      ...(camera.has_audio ? ['-map', '0:a:0?', '-c:a', 'aac', '-b:a', '128k'] : []),
      ...videoCodecArgs,
      ...(camera.has_audio ? [] : ['-an']),
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
    );
  }

  return args;
}

function clearAllTimers(camId) {
  if (restartTimers.has(camId)) {
    clearTimeout(restartTimers.get(camId));
    restartTimers.delete(camId);
  }
  if (watchdogTimers.has(camId)) {
    clearTimeout(watchdogTimers.get(camId));
    watchdogTimers.delete(camId);
  }
}

function startCameraMonitoring(camera, startDirWatcherCallback) {
  const camId = sanitizeCamId(camera.id);

  // Cleanup previous probes if any
  if (activeProbes.has(camId)) {
    activeProbes.get(camId).destroy();
    activeProbes.delete(camId);
  }

  let host, port;
  try {
    const u = new URL(camera.rtsp_url);
    host = u.hostname;
    port = u.port || 554;
  } catch (e) {
    logger.log('recorder', `[MONITOR] Invalid RTSP URL for cam ${camId}: ${camera.rtsp_url}`);
    // If URL is invalid, no point retrying monitoring immediately.
    // Maybe wait longer or just fail? For now, standard backoff.
    scheduleRestart(camera, startDirWatcherCallback, FFMPEG_MAX_BACKOFF_MS);
    return;
  }

  logger.log('recorder', `[MONITOR] Checking connectivity for cam ${camId} (${host}:${port})...`);

  const socket = new net.Socket();
  activeProbes.set(camId, socket);

  socket.setTimeout(5000); // 5s Monitor timeout

  socket.on('connect', () => {
    logger.log('recorder', `[MONITOR] Cam ${camId} is ONLINE. Resuming FFmpeg...`);
    socket.destroy();
    activeProbes.delete(camId);

    // Reset state to force immediate start
    const st = procState.get(camId) || {};
    st.retries = 0;
    st.nextDelay = FFMPEG_BASE_BACKOFF_MS;
    st.coolUntil = 0;
    st.isMonitoring = false;
    procState.set(camId, st);

    startFFmpegForCamera(camera, startDirWatcherCallback);
  });

  socket.on('timeout', () => {
    logger.log('recorder', `[MONITOR] Cam ${camId} timed out. Still offline.`);
    socket.destroy();
  });

  socket.on('error', (err) => {
    logger.log('recorder', `[MONITOR] Cam ${camId} unreachable: ${err.message}`);
  });

  socket.on('close', () => {
    activeProbes.delete(camId);
    // If we closed because of success, we already called startFFmpeg.
    // If closed due to error/timeout, we need to schedule next monitor check.
    const st = procState.get(camId);
    if (st && st.isMonitoring) {
      scheduleRestart(camera, startDirWatcherCallback, FFMPEG_BASE_BACKOFF_MS); // Monitor check interval
    }
  });

  socket.connect(port, host);
}

function scheduleRestart(camera, startDirWatcherCallback, delayMs) {
  const camId = sanitizeCamId(camera.id);
  clearAllTimers(camId);

  // Check if manually stopped before scheduling
  const st = procState.get(camId);
  if (st && st.manualStop) return;

  logger.log('recorder', `[SCHEDULER] Scheduling restart/monitor for cam ${camId} in ${delayMs / 1000}s`);
  const timer = setTimeout(() => {
    const currentState = procState.get(camId);
    if (currentState && currentState.isMonitoring) {
      startCameraMonitoring(camera, startDirWatcherCallback);
    } else {
      startFFmpegForCamera(camera, startDirWatcherCallback);
    }
  }, delayMs);

  restartTimers.set(camId, timer);
}


function startFFmpegForCamera(camera, startDirWatcherCallback) {
  const camId = sanitizeCamId(camera.id);

  // If monitoring, delegate to startCameraMonitoring
  const st = procState.get(camId) || { retries: 0, nextDelay: FFMPEG_BASE_BACKOFF_MS, coolUntil: 0, isMonitoring: false };

  if (st.isMonitoring) {
    startCameraMonitoring(camera, startDirWatcherCallback);
    return;
  }

  // Double check processes
  if (processes.has(camId)) {
    logger.log('recorder', `[FFMPEG] Process for cam ${camId} already running. Skipping.`);
    return;
  }

  if (activeProbes.has(camId)) {
    // Should not happen if logic is correct, but safe check
    activeProbes.get(camId).destroy();
    activeProbes.delete(camId);
  }

  if (!camera.storage_path) {
    logger.log('recorder', `[FFMPEG] Camera ${camId} (${camera.name}) has no storage path assigned. Skipping recording.`);
    return;
  }

  // Check cool-off
  if (now() < st.coolUntil) {
    const waitMs = st.coolUntil - now();
    logger.log('recorder', `[FFMPEG] Cam ${camId} in cool-off, switching to MONITOR mode.`);
    st.isMonitoring = true;
    procState.set(camId, st);
    startCameraMonitoring(camera, startDirWatcherCallback);
    return;
  }

  const camRecDir = path.join(camera.storage_path, `cam_${camId}`);
  const camDashDir = path.join(DASH_ROOT_DIR, `cam_${camId}`);
  fs.mkdirSync(camRecDir, { recursive: true });
  fs.mkdirSync(camDashDir, { recursive: true });

  const args = buildFfmpegArgs(camera, camRecDir, camDashDir);

  logger.log('recorder', `[FFMPEG] Starting for cam ${camId}... (Attempt ${st.retries + 1})`);
  const proc = spawn(ffmpegStatic, args, { stdio: ['ignore', 'ignore', 'pipe'], windowsHide: true, cwd: camDashDir });

  const resetWatchdog = () => {
    clearTimeout(watchdogTimers.get(camId));
    const timer = setTimeout(() => {
      logger.log('recorder', `[FFMPEG] Watchdog timeout for cam ${camId}. Killing process.`);
      proc.kill('SIGKILL');
    }, FFMPEG_WATCHDOG_TIMEOUT_MS);
    watchdogTimers.set(camId, timer);
  };

  proc.stderr.on('data', (d) => {
    resetWatchdog();
    const line = d.toString();

    // Cek keberhasilan koneksi
    if (st.retries > 0 && /Input #0, rtsp/i.test(line)) {
      logger.log('recorder', `[FFMPEG] Connection for cam ${camId} restored.`);
      st.retries = 0;
      st.nextDelay = FFMPEG_BASE_BACKOFF_MS;
      st.isMonitoring = false;
      procState.set(camId, st);
    }

    if (/(Connection timed out|Could not open|Invalid data found when processing input)/i.test(line)) {
      logger.log('recorder', `[FFMPEG ${camId}] Fatal error detected: "${line.trim()}". Killing process to force restart.`);
      proc.kill('SIGKILL');
    } else if (/(error)/i.test(line)) {
      logger.log('recorder', `[FFMPEG ${camId}] ${line.trim()}`);
    }
  });

  proc.on('close', (code, signal) => {
    clearAllTimers(camId);
    processes.delete(camId);

    const st = procState.get(camId);
    if (st && st.manualStop) {
      logger.log('recorder', `[FFMPEG] Process for cam ${camId} stopped manually.`);
      procState.delete(camId);
      return;
    }

    if (signal !== 'SIGTERM') {
      st.retries += 1;

      logger.log('recorder', `[FFMPEG] Process for cam ${camId} exited (code ${code}, signal ${signal}). Retries: ${st.retries}`);

      if (st.retries >= FFMPEG_MAX_RETRY) {
        logger.log('recorder', `[FFMPEG] Cam ${camId} max retries reached. Switching to MONITOR mode.`);
        st.coolUntil = now() + FFMPEG_COOL_OFF_MS; // Optional context, but mainly we switch monitoring
        st.isMonitoring = true;
        st.retries = 0; // Reset retries so if monitor succeeds we start fresh
        st.nextDelay = FFMPEG_BASE_BACKOFF_MS;
        procState.set(camId, st);
        scheduleRestart(camera, startDirWatcherCallback, FFMPEG_BASE_BACKOFF_MS);
      } else {
        st.nextDelay = Math.min(st.nextDelay * 1.5, FFMPEG_MAX_BACKOFF_MS);
        procState.set(camId, st);
        scheduleRestart(camera, startDirWatcherCallback, st.nextDelay);
      }
    } else {
      logger.log('recorder', `[FFMPEG] Process for cam ${camId} stopped.`);
    }
  });

  proc.on('spawn', () => {
    logger.log('recorder', `[FFMPEG] Spawned process for cam ${camId}.`);
    st.coolUntil = 0;
    procState.set(camId, st);
    resetWatchdog();
  });

  processes.set(camId, proc);

  if (startDirWatcherCallback) {
    startDirWatcherCallback(camRecDir);
  }
}

async function stopFFmpegForCamera(cameraId) {
  const camId = sanitizeCamId(cameraId);

  // 1. Mark manual stop to prevent restarts
  const st = procState.get(camId) || {};
  st.manualStop = true;
  st.isMonitoring = false;
  procState.set(camId, st);

  // 2. Clear any pending start/monitor timers
  clearAllTimers(camId);

  // 3. Destroy any active probes
  if (activeProbes.has(camId)) {
    logger.log('recorder', `[FFMPEG] Stopping monitor probe for cam ${camId}`);
    activeProbes.get(camId).destroy();
    activeProbes.delete(camId);
  }

  // 4. Kill FFmpeg process if running
  const proc = processes.get(camId);
  if (!proc) {
    logger.log('recorder', `[FFMPEG] No running process for cam ${camId} to stop.`);
    // Clean up state completely since we are stopping manually
    procState.delete(camId);
    return;
  }

  return new Promise(resolve => {
    let done = false;

    const timeout = setTimeout(() => {
      if (done) return;
      logger.log('recorder', `[FFMPEG] Process for cam ${camId} did not exit gracefully. Forcing kill.`);
      try { proc.kill('SIGKILL'); } catch { }
      if (processes.has(camId) && processes.get(camId) === proc) {
        processes.delete(camId);
      }
      done = true;
      resolve();
    }, 4000);

    proc.once('close', () => {
      if (!done) {
        clearTimeout(timeout);
        done = true;
        resolve();
      }
    });

    try { proc.kill('SIGTERM'); } catch { }
  });
}



async function stopAllFFmpeg() {
  const kills = [];
  // Need to get all keys from processes AND procState/activeProbes to ensure we stop everything
  const allCamIds = new Set([...processes.keys(), ...procState.keys(), ...activeProbes.keys()]);

  for (const camId of allCamIds) {
    kills.push(stopFFmpegForCamera(camId));
  }

  await Promise.all(kills);
  logger.log('recorder', '[FFMPEG] All processes and monitors stopped.');
}


module.exports = {
  startFFmpegForCamera,
  stopFFmpegForCamera,
  stopAllFFmpeg,
};
