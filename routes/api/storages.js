const express = require('express');
const router = express.Router();
const database = require('../../lib/database');
const { isAuthenticated } = require('../../lib/middleware');

// All these routes are prefixed with /api/storages from the main api router

router.get('/', isAuthenticated, async (req, res) => {
  try {
    const storages = await database.getAllStorages();
    res.json(storages);
  } catch (error) {
    res.status(500).json({ error: 'Failed to retrieve storages' });
  }
});

router.post('/', isAuthenticated, async (req, res) => {
  try {
    const newStorage = await database.addStorage(req.body);
    res.status(201).json(newStorage);
  } catch (error) {
    res.status(500).json({ error: 'Failed to add storage' });
  }
});

router.put('/:id', isAuthenticated, async (req, res) => {
  try {
    const updatedStorage = await database.updateStorage(req.params.id, req.body);
    res.json(updatedStorage);
  } catch (error) {
    console.error('Update failed:', error);
    res.status(500).json({ error: 'Failed to update storage' });
  }
});

router.delete('/:id', isAuthenticated, async (req, res) => {
  try {
    await database.deleteStorage(req.params.id);
    res.status(204).send();
  } catch (error) {
    console.error('Delete failed:', error);
    res.status(500).json({ error: 'Failed to delete storage' });
  }
});

module.exports = router;
