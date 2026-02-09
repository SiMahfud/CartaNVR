'use strict';

const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const { spawn } = require('child_process');
const si = require('systeminformation');

const now = () => Date.now();

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

async function getDrives() {
  const isWindows = process.platform === 'win32';
  try {
    if (isWindows) {
      // get logical disks and filesystem info to get labels and space
      const [disks, fsSize] = await Promise.all([
        si.diskLayout(), // Physical disks (might give labels)
        si.fsSize()      // Filesystems (gives mount, label, size, available)
      ]);

      // systeminformation.fsSize() on Windows returns logical drives
      return fsSize
        .filter(fs => /^[A-Z]:/i.test(fs.mount))
        .map(fs => ({
          name: fs.mount.replace(/\\$/, ''),
          path: fs.mount.endsWith('\\') ? fs.mount : fs.mount + '\\',
          label: fs.label || '',
          totalSpace: fs.size,
          availableSpace: fs.available
        }));
    } else {
      // For Linux, we might still want to return '/' or other mounts if needed
      // But for now, we'll return an empty list as requested by the current logic
      // which falls back to '/' if no path is provided.
      return [];
    }
  } catch (error) {
    console.error('Error getting drives:', error);
    return [];
  }
}

async function waitFileStable(filePath, stableMs = 1200, timeoutMs = 20000) {
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
    const ffprobe = spawn(ffprobePath, [
      '-v', 'error',
      '-show_format',
      '-show_streams',
      '-of', 'json',
      filePath
    ], { windowsHide: true });

    let data = '';
    ffprobe.stdout.on('data', (chunk) => {
      data += chunk;
    });

    let stderr = '';
    ffprobe.stderr.on('data', (chunk) => {
        stderr += chunk;
    });

    ffprobe.on('close', (code) => {
      if (code === 0) {
        try {
          const metadata = JSON.parse(data);
          resolve(parseFloat(metadata.format?.duration) || 0);
        } catch (e) {
          reject(e);
        }
      } else {
        reject(new Error(`ffprobe process exited with code ${code}: ${stderr}`));
      }
    });

    ffprobe.on('error', (err) => {
      reject(err);
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

module.exports = {
  now,
  sleep,
  getDrives,
  waitFileStable,
  sanitizeCamId,
  getVideoDuration,
  parseTimestampFromNameOrMtime,
};
