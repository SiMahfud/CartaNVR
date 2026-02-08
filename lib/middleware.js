const database = require('./database');

function isAuthenticated(req, res, next) {
  if (req.isAuthenticated()) {
    return next();
  }
  res.redirect('/'); // Redirect ke halaman login jika belum login
}

async function isFederated(req, res, next) {
  const authHeader = req.get('X-NVR-Auth');
  if (!authHeader) {
    return res.status(401).send('Missing X-NVR-Auth header');
  }

  try {
    const fedKey = await database.getSetting('federation_key');
    if (fedKey && authHeader === fedKey) {
      return next();
    }
    res.status(401).send('Invalid federation key');
  } catch (err) {
    console.error('Federation Auth Error:', err);
    res.status(500).send('Internal Server Error');
  }
}

module.exports = { isAuthenticated, isFederated };