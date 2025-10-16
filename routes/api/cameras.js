const express = require('express');
const router = express.Router();
const database = require('../../lib/database');
const { isAuthenticated } = require('../../lib/middleware');

// Semua rute di sini sudah diawali dengan /api dari server.js, dan /cameras dari api/index.js

// GET /api/cameras
router.get('/', isAuthenticated, async (req, res) => {
  try {
    const cameras = await database.getAllCameras();
    res.json(cameras);
  } catch (error) {
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
    const updatedCamera = await database.updateCamera(req.params.id, req.body);
    res.json(updatedCamera);
  } catch (error) {
    console.error('Update failed:', error);
    res.status(500).json({ error: 'Failed to update camera' });
  }
});

// DELETE /api/cameras/:id
router.delete('/:id', isAuthenticated, async (req, res) => {
  try {
    await database.deleteCamera(req.params.id);
    res.status(204).send();
  } catch (error) {
    console.error('Delete failed:', error);
    res.status(500).json({ error: 'Failed to delete camera' });
  }
});

module.exports = router;
