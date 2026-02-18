const express = require('express');
const router = express.Router();
const database = require('../../lib/database');
const { isAuthenticated, isAuthenticatedOrFederated } = require('../../lib/middleware');
const fedClient = require('../../lib/federation-client');

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
    res.status(201).json(newCamera);
  } catch (error) {
    res.status(500).json({ error: 'Failed to add camera' });
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

    // Dynamic process control
    const recorder = require('../../recorder');
    if (oldCamera.enabled && req.body.enabled === false) {
      // Transitioned to Disabled
      await recorder.stopRecordingForCamera(cameraId, oldCamera.storage_path);
    } else if (!oldCamera.enabled && req.body.enabled === true) {
      // Transitioned to Enabled
      // We need the full camera object including storage info for starting
      const fullCamera = await database.getCameraById(cameraId);
      recorder.startRecordingForCamera(fullCamera);
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
    }

    await database.deleteCamera(cameraId);
    res.status(204).send();
  } catch (error) {
    console.error('Delete failed:', error);
    res.status(500).json({ error: 'Failed to delete camera' });
  }
});

module.exports = router;
