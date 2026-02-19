const database = require('./database');
const dbEmitter = require('./db-events');

// Cache federation key untuk menghindari query DB per-request
let cachedFederationKey = null;
let fedKeyCacheReady = false;

async function refreshFedKeyCache() {
  try {
    cachedFederationKey = await database.getSetting('federation_key');
    fedKeyCacheReady = true;
  } catch { /* DB belum siap */ }
}

// Refresh saat pertama kali diperlukan dan saat berubah
dbEmitter.on('settingChanged', (key) => {
  if (key === 'federation_key') {
    refreshFedKeyCache();
  }
});

function isAuthenticated(req, res, next) {
  if (req.isAuthenticated()) {
    return next();
  }

  if (req.accepts('json') || req.path.startsWith('/api') || req.xhr) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  res.redirect('/'); // Redirect ke halaman login jika belum login
}

async function isFederated(req, res, next) {
  const authHeader = req.get('X-NVR-Auth');
  if (!authHeader) {
    return res.status(401).send('Missing X-NVR-Auth header');
  }

  try {
    if (!fedKeyCacheReady) await refreshFedKeyCache();
    if (cachedFederationKey && authHeader === cachedFederationKey) {
      return next();
    }
    res.status(401).send('Invalid federation key');
  } catch (err) {
    console.error('Federation Auth Error:', err);
    res.status(500).send('Internal Server Error');
  }
}

/**
 * Combined middleware: accepts either session auth OR federation key.
 * Use this on endpoints that need to serve both logged-in users and remote nodes.
 */
async function isAuthenticatedOrFederated(req, res, next) {
  // If federation header is present, validate it
  const authHeader = req.get('X-NVR-Auth');
  const queryKey = req.query.api_key;

  if (authHeader || queryKey) {
    try {
      if (!fedKeyCacheReady) await refreshFedKeyCache();
      if (cachedFederationKey && (authHeader === cachedFederationKey || queryKey === cachedFederationKey)) {
        return next();
      }
      return res.status(401).json({ error: 'Invalid federation key' });
    } catch (err) {
      console.error('Federation Auth Error:', err);
      return res.status(500).json({ error: 'Internal Server Error' });
    }
  }

  // Otherwise, fall back to session auth
  if (req.isAuthenticated()) {
    return next();
  }

  if (req.accepts('json') || req.path.startsWith('/api') || req.xhr) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  res.redirect('/');
}

module.exports = { isAuthenticated, isFederated, isAuthenticatedOrFederated };