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
async function syncExistingFilesOnce() {
  logger.log('storage', '[STORAGE] Running one-time sync for existing files...');
  let deletedCount = 0;
  try {
    const cameras = await database.getAllCameras();
    for (const camera of cameras) {
      if (!camera.storage_path) continue;

      const camId = sanitizeCamId(camera.id);
      const camDir = path.join(camera.storage_path, `cam_${camId}`);
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
    logger.log('storage', `[STORAGE-SYNC] Deleted ${deletedCount} corrupt or incomplete file(s).`);
  }
  logger.log('storage', '[STORAGE] One-time sync finished.');
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

            if (!fs.existsSync(absPath)) {
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
                logger.log('storage', `[STORAGE] Storage '${storage.name}' is over capacity (${(totalSize / (1024*1024*1024)).toFixed(2)} GB / ${storage.max_gb} GB). Cleaning up...`);
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