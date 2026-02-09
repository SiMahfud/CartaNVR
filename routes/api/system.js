const express = require('express');
const router = express.Router();
const { exec } = require('child_process');
const fs = require('fs');
const path = require('path');
const onvifScanner = require('../../lib/onvif-scanner');
const database = require('../../lib/database');
const { isAuthenticated, isAuthenticatedOrFederated } = require('../../lib/middleware');
const utils = require('../../lib/utils');

// Note: The /api prefix is handled by the main app.
// These routes are mounted under /api

router.post('/scan', isAuthenticated, async (req, res) => {
  try {
    const { ipRange, port, user, pass } = req.body;
    if (!ipRange) {
      return res.status(400).json({ error: 'ipRange is required' });
    }
    const devices = await onvifScanner.scan(ipRange, port, user, pass);
    res.json(devices);
  } catch (error) {
    console.error('Scan failed:', error);
    res.status(500).json({ error: 'Failed to scan for devices' });
  }
});

router.get('/playback/:cameraId', isAuthenticatedOrFederated, async (req, res) => {
  try {
    const rawId = req.params.cameraId.replace('cam_', '');
    const isRemote = rawId.startsWith('remote_');

    const now = new Date();
    const defaultStart = new Date(now.getTime() - (24 * 60 * 60 * 1000));
    const startTime = req.query.start ? new Date(req.query.start).getTime() : defaultStart.getTime();
    const endTime = req.query.end ? new Date(req.query.end).getTime() : now.getTime();

    if (isNaN(startTime) || isNaN(endTime)) {
      return res.status(400).json({ error: 'Invalid date format for start or end time.' });
    }

    if (isRemote) {
      // Logic for remote playback search
      const parts = rawId.split('_');
      const nodeId = parts[1];
      const originalCamId = parts[2];

      const remoteNodes = await database.getAllRemoteNodes();
      const node = remoteNodes.find(n => String(n.id) === String(nodeId));

      if (!node) return res.status(404).json({ error: 'Remote node not found' });

      // Fetch from remote
      const query = `?start=${startTime}&end=${endTime}`;
      const response = await fetch(`${node.url}/api/playback/cam_${originalCamId}${query}`, {
        headers: { 'X-NVR-Auth': node.api_key },
        signal: AbortSignal.timeout(10000)
      });

      if (!response.ok) throw new Error('Remote node error');

      const segments = await response.json();
      // Correct the playback URLs to be absolute
      const correctedSegments = segments.map(s => ({
        ...s,
        file: s.file.startsWith('http') ? s.file : `${node.url}${s.file}`
      }));

      return res.json(correctedSegments);
    }

    // Local playback logic
    const segments = await database.getRecordings(rawId, startTime, endTime);
    res.json(segments);

  } catch (err) {
    console.error("Server error fetching playback:", err);
    res.status(500).json({ error: 'Failed to read recordings' });
  }
});

router.get('/config', isAuthenticated, async (req, res) => {
  const config = require('../../lib/config');
  if (config.syncWithDatabase) {
    await config.syncWithDatabase();
  }
  res.json(config);
});

router.post('/config', isAuthenticated, async (req, res) => {
  // Deprecation Notice: We are moving towards database-backed settings.
  // This route now updates the database instead of config.json.

  const oldConfig = require('../../lib/config');
  const oldServiceName = oldConfig.pm2_service_name;

  try {
    const newSettings = req.body;
    const newServiceName = newSettings.pm2_service_name;

    // 1. Save all incoming fields to database
    for (const [key, value] of Object.entries(newSettings)) {
      await database.setSetting(key, String(value));
    }

    // 2. Sync the in-memory config object
    if (oldConfig.syncWithDatabase) {
      await oldConfig.syncWithDatabase();
    }

    // 3. Handle PM2 restart if service name changed
    if (newServiceName && oldServiceName && newServiceName !== oldServiceName) {
      console.log(`PM2 service name changed from "${oldServiceName}" to "${newServiceName}". Restarting service...`);
      const restartCommand = `(pm2 delete "${oldServiceName}" || true) && pm2 start server.js --name "${newServiceName}"`;

      exec(restartCommand, { windowsHide: true }, (error, stdout, stderr) => {
        if (error) console.error(`Failed to restart PM2 service: ${error.message}`);
      });

      return res.status(200).json({ message: 'Config updated in database. Application is restarting with the new PM2 service name.' });
    } else {
      return res.status(200).json({ message: 'Config updated in database successfully.' });
    }

  } catch (error) {
    console.error('Failed to save config to database:', error);
    return res.status(500).json({ error: 'Failed to save config to database' });
  }
});

router.get('/settings', isAuthenticated, async (req, res) => {
  try {
    const settings = await database.getAllSettings();
    res.json(settings);
  } catch (error) {
    console.error('Failed to get settings:', error);
    res.status(500).json({ error: 'Failed to get settings' });
  }
});

router.post('/settings', isAuthenticated, async (req, res) => {
  try {
    const newSettings = req.body;
    for (const [key, value] of Object.entries(newSettings)) {
      await database.setSetting(key, String(value));
    }
    res.json({ message: 'Settings updated successfully' });
  } catch (error) {
    console.error('Failed to update settings:', error);
    res.status(500).json({ error: 'Failed to update settings' });
  }
});

router.get('/system/nodes', isAuthenticated, async (req, res) => {
  try {
    const nodes = await database.getAllRemoteNodes();
    res.json(nodes);
  } catch (error) {
    console.error('Failed to get remote nodes:', error);
    res.status(500).json({ error: 'Failed to get remote nodes' });
  }
});

router.post('/system/nodes', isAuthenticated, async (req, res) => {
  try {
    const node = await database.addRemoteNode(req.body);
    res.status(201).json(node);
  } catch (error) {
    console.error('Failed to add remote node:', error);
    res.status(500).json({ error: 'Failed to add remote node' });
  }
});

router.put('/system/nodes/:id', isAuthenticated, async (req, res) => {
  try {
    const node = await database.updateRemoteNode(req.params.id, req.body);
    res.json(node);
  } catch (error) {
    console.error('Failed to update remote node:', error);
    res.status(500).json({ error: 'Failed to update remote node' });
  }
});

router.delete('/system/nodes/:id', isAuthenticated, async (req, res) => {
  try {
    await database.deleteRemoteNode(req.params.id);
    res.json({ message: 'Remote node deleted' });
  } catch (error) {
    console.error('Failed to delete remote node:', error);
    res.status(500).json({ error: 'Failed to delete remote node' });
  }
});

router.get('/system/discover', isAuthenticated, async (req, res) => {
  const discovery = require('../../lib/discovery');
  const foundNodes = [];

  discovery.scan((node) => {
    if (!foundNodes.some(n => n.url === node.url)) {
      foundNodes.push(node);
    }
  });

  // Scan for 5 seconds then return results
  setTimeout(() => {
    discovery.stopScanning();
    res.json(foundNodes);
  }, 5000);
});

router.get('/browse', isAuthenticated, async (req, res) => {

  const isWindows = process.platform === 'win32';
  let currentPath = req.query.path;
  console.log(`Browsing path: ${currentPath}`);

  if (!currentPath) {
    if (isWindows) {
      console.log('No path, listing drives (Windows)');
      try {
        const drives = await utils.getDrives();
        return res.json({
          currentPath: 'Computer',
          parentDir: null,
          isRoot: true,
          directories: drives
        });
      } catch (err) {
        console.error('Error getting drives:', err);
        return res.status(500).json({ error: 'Failed to get drives' });
      }
    } else {
      console.log('No path, starting at / (Linux/macOS)');
      currentPath = '/';
    }
  }

  try {
    console.log(`Reading directory: ${currentPath}`);
    const files = fs.readdirSync(currentPath, { withFileTypes: true });
    const directories = files
      .filter(dirent => dirent.isDirectory())
      .map(dirent => ({
        name: dirent.name,
        path: path.join(currentPath, dirent.name)
      }));

    const parent = path.resolve(currentPath, '..');
    const isDriveRoot = isWindows && /^[A-Z]:\\?$/.test(currentPath);

    res.json({
      currentPath,
      parentDir: isDriveRoot ? '' : parent,
      isRoot: false,
      directories
    });
  } catch (error) {
    console.error('Error browsing path:', error);
    if (error.code === 'ENOENT') {
      console.log('Path not found, redirecting to root');
      res.redirect(`/api/browse`);
    } else {
      res.status(500).json({ error: 'Failed to browse path' });
    }
  }
});

module.exports = router;
