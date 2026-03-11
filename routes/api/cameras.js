const express = require('express');
const router = express.Router();
const database = require('../../lib/database');
const { isAuthenticated, isAuthenticatedOrFederated } = require('../../lib/middleware');
const fedClient = require('../../lib/federation-client');
const go2rtcManager = require('../../lib/go2rtc-manager');

// Semua rute di sini sudah diawali dengan /api dari server.js, dan /cameras dari api/index.js

// GET /api/cameras - accepts both session auth and federation key
router.get('/', isAuthenticatedOrFederated, async (req, res) => {
  try {
    const localCameras = await database.getAllCameras();

    // Fetch remote cameras
    const remoteNodes = await database.getAllRemoteNodes();
    const remoteCamerasPromises = remoteNodes.map(node => fedClient.getRemoteCameras(node));
    const remoteCamerasResults = await Promise.all(remoteCamerasPromises);
    const remoteCameras = remoteCamerasResults.flat();

    res.json([...localCameras, ...remoteCameras]);
  } catch (error) {
    console.error('Failed to aggregate cameras:', error);
    res.status(500).json({ error: 'Failed to retrieve cameras' });
  }
});

// POST /api/cameras
router.post('/', isAuthenticated, async (req, res) => {
  try {
    const newCamera = await database.addCamera(req.body);

    // Register with go2rtc if applicable
    if (newCamera && req.body.stream_method === 'go2rtc' && req.body.rtsp_url && req.body.enabled !== false) {
      await go2rtcManager.addStream(newCamera.id, req.body.rtsp_url, req.body.has_audio).catch(() => { });
    }

    res.status(201).json(newCamera);
  } catch (error) {
    res.status(500).json({ error: 'Failed to add camera' });
  }
});

// POST /api/cameras/:id/restart-stream
router.post('/:id/restart-stream', isAuthenticated, async (req, res) => {
  try {
    const cameraId = req.params.id;
    const camera = await database.getCameraById(cameraId);
    
    if (!camera) {
      return res.status(404).json({ error: 'Camera not found' });
    }

    if (camera.stream_method === 'go2rtc' && camera.enabled !== false) {
      console.log(`[CAMERA] Manually restarting go2rtc stream for cam ${cameraId}`);
      // Hapus stream dari go2rtc
      await go2rtcManager.removeStream(cameraId).catch(() => {});
      
      // Beri jeda sebentar agar go2rtc benar-benar membersihkan resource lamanya
      await new Promise(resolve => setTimeout(resolve, 1000));
      
      // Daftarkan ulang stream ke go2rtc
      await go2rtcManager.addStream(cameraId, camera.rtsp_url, camera.has_audio).catch(() => {});
      
      res.json({ message: 'Stream restarted successfully' });
    } else {
      res.status(400).json({ error: 'Camera is not using go2rtc or is disabled' });
    }
  } catch (error) {
    console.error('Failed to restart stream:', error);
    res.status(500).json({ error: 'Failed to restart stream' });
  }
});

// PUT /api/cameras/:id
router.put('/:id', isAuthenticated, async (req, res) => {
  try {
    const cameraId = req.params.id;
    const oldCamera = await database.getCameraById(cameraId);
    if (!oldCamera) {
      return res.status(404).json({ error: 'Camera not found' });
    }

    const updatedCamera = await database.updateCamera(cameraId, req.body);

    // Dynamic process control - use explicit boolean coercion
    const recorder = require('../../recorder');
    const wasEnabled = !!oldCamera.enabled;
    const isNowEnabled = req.body.enabled !== false && req.body.enabled !== 0 && req.body.enabled !== '0' && req.body.enabled !== 'false';

    // Check for critical changes that require restart
    const streamMethodChanged = req.body.stream_method && req.body.stream_method !== oldCamera.stream_method;
    const rtspUrlChanged = req.body.rtsp_url && req.body.rtsp_url !== oldCamera.rtsp_url;
    const audioSettingChanged = 'has_audio' in req.body && !!req.body.has_audio !== !!oldCamera.has_audio;
    const needsRestart = isNowEnabled && (streamMethodChanged || rtspUrlChanged || audioSettingChanged);

    if (wasEnabled && !isNowEnabled) {
      // Transitioned to Disabled
      await recorder.stopRecordingForCamera(cameraId, oldCamera.storage_path);
    } else if (!wasEnabled && isNowEnabled) {
      // Transitioned to Enabled
      const fullCamera = await database.getCameraById(cameraId);
      recorder.startRecordingForCamera(fullCamera);
    } else if (wasEnabled && isNowEnabled && needsRestart) {
      // Still enabled, but critical config changed -> Restart
      console.log(`[CAMERA] Critical config changed for cam ${cameraId}. Restarting stream...`);
      await recorder.stopRecordingForCamera(cameraId, oldCamera.storage_path);
      // Fetch fresh data including new config
      const fullCamera = await database.getCameraById(cameraId);
      recorder.startRecordingForCamera(fullCamera);
    }
    // Sync go2rtc streams
    const oldUsedGo2rtc = oldCamera.stream_method === 'go2rtc' && wasEnabled;
    const newUsesGo2rtc = (req.body.stream_method || oldCamera.stream_method) === 'go2rtc' && isNowEnabled;

    if (oldUsedGo2rtc && !newUsesGo2rtc) {
      // Was go2rtc, no longer → remove stream
      await go2rtcManager.removeStream(cameraId).catch(() => { });
    } else if (newUsesGo2rtc && (rtspUrlChanged || streamMethodChanged || audioSettingChanged || (!wasEnabled && isNowEnabled))) {
      // Now uses go2rtc and something changed → add/update stream
      const freshCam = await database.getCameraById(cameraId);
      if (freshCam && freshCam.rtsp_url) {
        await go2rtcManager.addStream(cameraId, freshCam.rtsp_url, freshCam.has_audio).catch(() => { });
      }
    }

    res.json(updatedCamera);
  } catch (error) {
    console.error('Update failed:', error);
    res.status(500).json({ error: 'Failed to update camera' });
  }
});

// DELETE /api/cameras/:id
router.delete('/:id', isAuthenticated, async (req, res) => {
  try {
    const cameraId = req.params.id;
    // Stop recording first if exists
    const camera = await database.getCameraById(cameraId);
    if (camera) {
      const recorder = require('../../recorder');
      await recorder.stopRecordingForCamera(cameraId, camera.storage_path);

      // Remove from go2rtc if applicable
      if (camera.stream_method === 'go2rtc') {
        await go2rtcManager.removeStream(cameraId).catch(() => { });
      }
    }

    // Delete associated recordings from DB first
    await database.deleteRecordingsByCameraId(cameraId);
    await database.deleteCamera(cameraId);
    res.status(204).send();
  } catch (error) {
    console.error('Delete failed:', error);
    res.status(500).json({ error: 'Failed to delete camera' });
  }
});

module.exports = router;
