'use strict';

const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const database = require('./database');
const logger = require('./logger');
const {
  sanitizeCamId,
  getVideoDuration,
  parseTimestampFromNameOrMtime,
} = require('./utils');

/** ====== SYNC FILE SYSTEM ↔ DB ====== */
async function syncExistingFilesOnce(targetCameraId = null) {
  logger.log('storage', `[STORAGE] Running sync for ${targetCameraId ? 'cam ' + targetCameraId : 'existing files'}...`);
  let quarantinedCount = 0;
  try {
    let cameras = await database.getAllCameras();
    if (targetCameraId) {
      cameras = cameras.filter(c => sanitizeCamId(c.id) === sanitizeCamId(targetCameraId));
    }

    for (const camera of cameras) {
      if (!camera.storage_path) continue;

      const camId = sanitizeCamId(camera.id);
      const camDir = path.join(camera.storage_path, `cam_${camId}`);
      if (!fs.existsSync(camDir)) continue;

      const corruptDir = path.join(camDir, 'corrupt');

      const existingRecordings = await database.getRecordingsByCameraId(camId);
      const existingMap = new Map(); // path -> size
      existingRecordings.forEach(rec => existingMap.set(rec.file_path, rec.file_size));

      const filesOnDisk = (await fsp.readdir(camDir)).filter(f => f.endsWith('.mp4'));

      for (const file of filesOnDisk) {
        const relativePath = `/recordings/cam_${camId}/${file}`;
        const filePath = path.join(camDir, file);
        const stats = await fsp.stat(filePath);

        // If in DB and size matches, skip
        if (existingMap.has(relativePath) && existingMap.get(relativePath) === stats.size) {
          continue;
        }

        try {
          const duration = await getVideoDuration(filePath);
          const timestamp = parseTimestampFromNameOrMtime(filePath);

          if (duration > 0 && Number.isFinite(timestamp)) {
            await database.addRecording({
              camera_id: camId,
              file_path: relativePath,
              timestamp,
              duration,
              file_size: stats.size
            });
          } else {
            throw new Error('Invalid metadata');
          }
        } catch (e) {
          quarantinedCount++;
          if (!fs.existsSync(corruptDir)) fs.mkdirSync(corruptDir, { recursive: true });
          const targetPath = path.join(corruptDir, file);
          try {
            await fsp.rename(filePath, targetPath);
            logger.log('storage', `[QUARANTINE] Moved corrupt file ${file} to ${corruptDir}`);
          } catch (mvErr) {
            console.error(`[QUARANTINE] Failed to move ${file}:`, mvErr.message);
          }
        }
      }
    }
  } catch (e) {
    console.error('[STORAGE] Error during one-time sync:', e);
  }

  if (quarantinedCount > 0) {
    logger.log('storage', `[STORAGE-SYNC] Quarantined ${quarantinedCount} corrupt or incomplete file(s).`);
  }
  logger.log('storage', '[STORAGE] Sync finished.');
}

async function periodicSyncDbToDisk() {
  try {
    const cameras = await database.getAllCameras();
    for (const camera of cameras) {
      if (!camera.storage_path) continue;

      const camId = sanitizeCamId(camera.id);
      const camDir = path.join(camera.storage_path, `cam_${camId}`);

      const recs = await database.getRecordingsByCameraId(camId);
      for (const rec of recs) {
        const fileName = path.basename(rec.file_path);
        const absPath = path.join(camDir, fileName);

        try {
          const stats = await fsp.stat(absPath);
          // If size mismatched significantly or file changed, we might want to re-validate
          // but for now just simple existence check is preserved, plus size update if needed
          if (rec.file_size !== stats.size) {
            // Optionally trigger re-validation here if size changed.
            // For now we just sync the DB if it exists but size is different (e.g. from previous version)
            // But if it's vastly different, it might be corrupt.
          }
        } catch {
          try {
            await database.deleteRecordingByPath(rec.file_path);
            logger.log('storage', '[STORAGE-SYNC] Removed dead DB entry:', rec.file_path);
          } catch (e) {
            logger.log('storage', '[STORAGE-SYNC] Failed to remove DB entry:', rec.file_path, e.message);
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
  logger.log('storage', '[STORAGE] Running cleanup...');
  try {
    const storages = await database.getAllStorages();
    const cameras = await database.getAllCameras();

    for (const storage of storages) {
      const maxStorageBytes = storage.max_gb * 1024 * 1024 * 1024;
      let totalSize = 0;
      let allFiles = [];

      const camerasInStorage = cameras.filter(c => c.storage_id === storage.id);

      for (const camera of camerasInStorage) {
        const camId = sanitizeCamId(camera.id);
        const camDir = path.join(storage.path, `cam_${camId}`);
        if (!fs.existsSync(camDir)) continue;

        const files = await fsp.readdir(camDir);
        for (const file of files) {
          if (file.endsWith('.mp4')) {
            const filePath = path.join(camDir, file);
            try {
              const stats = await fsp.stat(filePath);
              allFiles.push({
                filePath,
                size: stats.size,
                mtime: stats.mtimeMs,
                camId,
              });
              totalSize += stats.size;
            } catch (e) {
              // Ignore errors
            }
          }
        }
      }

      if (totalSize > maxStorageBytes) {
        logger.log('storage', `[STORAGE] Storage '${storage.name}' is over capacity (${(totalSize / (1024 * 1024 * 1024)).toFixed(2)} GB / ${storage.max_gb} GB). Cleaning up...`);
        allFiles.sort((a, b) => a.mtime - b.mtime);

        while (totalSize > maxStorageBytes && allFiles.length > 0) {
          const oldestFile = allFiles.shift();
          try {
            await fsp.unlink(oldestFile.filePath);
            const relativePath = `/recordings/cam_${oldestFile.camId}/${path.basename(oldestFile.filePath)}`;
            await database.deleteRecordingByPath(relativePath);
            totalSize -= oldestFile.size;
            logger.log('storage', `[STORAGE] Deleted old file: ${oldestFile.filePath}`);
          } catch (e) {
            logger.log('storage', `[STORAGE] Failed deleting:`, oldestFile.filePath, e.message);
          }
        }
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