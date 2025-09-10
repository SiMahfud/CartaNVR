'use strict';

const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const database = require('./database');
const {
  sanitizeCamId,
  getVideoDuration,
  parseTimestampFromNameOrMtime,
} = require('./utils');

const { RECORDINGS_DIR, MAX_STORAGE } = require('./config');

/** ====== SYNC FILE SYSTEM ↔ DB ====== */
async function syncExistingFilesOnce() {
  console.log('[STORAGE] Running one-time sync for existing files...');
  let deletedCount = 0;
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

        const filePath = path.join(camDir, file);
        try {
          const duration = await getVideoDuration(filePath);
          const timestamp = parseTimestampFromNameOrMtime(filePath);

          if (duration > 0 && Number.isFinite(timestamp)) {
            await database.addRecording({
              camera_id: camId,
              file_path: relativePath,
              timestamp,
              duration
            });
          } else {
            throw new Error('Invalid metadata (duration or timestamp)');
          }
        } catch (e) {
          deletedCount++;
          try {
            await fsp.unlink(filePath);
          } catch (delErr) {
            console.error(`[STORAGE-SYNC] Failed to delete corrupt file ${file}:`, delErr.message);
          }
        }
      }
    }
  } catch (e) {
    console.error('[STORAGE] Error during one-time sync:', e);
  }

  if (deletedCount > 0) {
    console.warn(`[STORAGE-SYNC] Deleted ${deletedCount} corrupt or incomplete file(s).`);
  }
  console.log('[STORAGE] One-time sync finished.');
}

async function periodicSyncDbToDisk() {
  try {
    const cameras = await database.getAllCameras();
    for (const camera of cameras) {
      const camId = sanitizeCamId(camera.id);
      const camDir = path.join(RECORDINGS_DIR, `cam_${camId}`);
      if (!fs.existsSync(camDir)) continue;

      const recs = await database.getRecordingsByCameraId(camId);
      for (const rec of recs) {
        const abs = path.join(__dirname, '..', rec.file_path.replace(/^\//, ''));
        if (!fs.existsSync(abs)) {
          try {
            await database.deleteRecordingByPath(rec.file_path);
            console.log('[STORAGE-SYNC] Removed dead DB entry:', rec.file_path);
          } catch (e) {
            console.warn('[STORAGE-SYNC] Failed to remove DB entry:', rec.file_path, e.message);
          }
        }
      }
    }
  } catch (e) {
    console.error('[STORAGE] periodicSyncDbToDisk error:', e);
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
      } catch (e) {
        console.warn('[STORAGE] Failed deleting:', oldest.file, e.message);
      }
    }
  } catch (e) {
    console.error('[STORAGE] cleanupStorage error:', e);
  }
}

module.exports = {
  syncExistingFilesOnce,
  periodicSyncDbToDisk,
  cleanupStorage,
};
