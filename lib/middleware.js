function isAuthenticated(req, res, next) {
  if (req.isAuthenticated()) {
    return next();
  }
  res.redirect('/'); // Redirect ke halaman login jika belum login
}

module.exports = { isAuthenticated };
