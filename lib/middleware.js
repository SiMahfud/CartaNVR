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

/**
 * Combined middleware: accepts either session auth OR federation key.
 * Use this on endpoints that need to serve both logged-in users and remote nodes.
 */
async function isAuthenticatedOrFederated(req, res, next) {
  // If federation header is present, validate it
  // If federation header is present, validate it
  const authHeader = req.get('X-NVR-Auth');
  const queryKey = req.query.api_key;

  if (authHeader || queryKey) {
    try {
      const fedKey = await database.getSetting('federation_key');
      if (fedKey && (authHeader === fedKey || queryKey === fedKey)) {
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
  res.redirect('/');
}

module.exports = { isAuthenticated, isFederated, isAuthenticatedOrFederated };