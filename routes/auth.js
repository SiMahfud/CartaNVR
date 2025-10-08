const express = require('express');
const passport = require('passport');
const path = require('path'); // <-- Tambahkan ini
const router = express.Router();

// Rute untuk Halaman Login
router.get('/', (req, res) => {
  if (req.isAuthenticated()) {
    return res.redirect('/dashboard');
  }
  // Perbaiki path untuk keluar dari direktori 'routes'
  res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
});

// Rute untuk proses login
router.post('/login', passport.authenticate('local', {
  successRedirect: '/dashboard',
  failureRedirect: '/?error=1' // Redirect kembali ke login dengan pesan error
}));

// Rute untuk logout
router.get('/logout', (req, res, next) => {
  req.logout(function(err) {
    if (err) { return next(err); }
    res.redirect('/');
  });
});

module.exports = router;