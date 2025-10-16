const express = require('express');
const path = require('path');
const { isAuthenticated } = require('../lib/middleware');
const router = express.Router();

// Halaman Dashboard (setelah login)
router.get('/dashboard', isAuthenticated, (req, res) => {
    res.sendFile(path.join(__dirname, '..', 'public', 'dashboard.html'));
});

router.get('/manage-cameras', isAuthenticated, (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'manage-cameras.html'));
});

router.get('/playback', isAuthenticated, (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'playback.html'));
});

router.get('/settings', isAuthenticated, (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'settings.html'));
});

module.exports = router;
