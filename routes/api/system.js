const express = require('express');
const router = express.Router();
const { exec } = require('child_process');
const fs = require('fs');
const path = require('path');
const onvifScanner = require('../../lib/onvif-scanner');
const database = require('../../lib/database');
const { isAuthenticated } = require('../../lib/middleware');

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

router.get('/playback/:cameraId', isAuthenticated, async (req, res) => {
  try {
    const cameraId = req.params.cameraId.replace('cam_', '');
    const now = new Date();
    const defaultStart = new Date(now.getTime() - (24 * 60 * 60 * 1000));
    const startTime = req.query.start ? new Date(req.query.start).getTime() : defaultStart.getTime();
    const endTime = req.query.end ? new Date(req.query.end).getTime() : now.getTime();

    if (isNaN(startTime) || isNaN(endTime)) {
      return res.status(400).json({ error: 'Invalid date format for start or end time.' });
    }

    const segments = await database.getRecordings(cameraId, startTime, endTime);
    res.json(segments);

  } catch (err) {
    console.error("Server error fetching playback from DB:", err);
    res.status(500).json({ error: 'Failed to read recordings from database' });
  }
});

router.get('/config', isAuthenticated, (req, res) => {
  delete require.cache[require.resolve('../../lib/config')];
  const config = require('../../lib/config');
  res.json(config);
});

router.post('/config', isAuthenticated, async (req, res) => {
  const configPath = path.join(__dirname, '..', '..', 'lib', 'config.json');
  
  // 1. Get old config by requiring it (it will be cached)
  const oldConfig = require('../../lib/config');
  const oldServiceName = oldConfig.pm2_service_name;

  try {
    const newConfig = req.body;
    const newServiceName = newConfig.pm2_service_name;

    // Read existing user config from file to merge
    let existingConfig = {};
    if (fs.existsSync(configPath)) {
      const rawData = fs.readFileSync(configPath);
      existingConfig = JSON.parse(rawData);
    }

    // 2. Save the new config to file
    const updatedConfig = { ...existingConfig, ...newConfig };
    fs.writeFileSync(configPath, JSON.stringify(updatedConfig, null, 2));
    
    // Clear require cache to ensure next require gets the new version
    delete require.cache[require.resolve('../../lib/config')];
    
    // 3. Check if service name has changed and handle PM2 restart
    if (newServiceName && oldServiceName && newServiceName !== oldServiceName) {
      console.log(`PM2 service name changed from "${oldServiceName}" to "${newServiceName}". Restarting service...`);
      
      // Use `pm2 delete` which stops and removes. Add `|| true` so the command doesn't fail if the old service doesn't exist.
      const restartCommand = `(pm2 delete "${oldServiceName}" || true) && pm2 start server.js --name "${newServiceName}"`;
      
      console.log(`Executing: ${restartCommand}`);

      exec(restartCommand, { windowsHide: true }, (error, stdout, stderr) => {
        if (error) {
          console.error(`Failed to restart PM2 service: ${error.message}`);
        }
        if (stdout) console.log('PM2 restart command stdout:', stdout);
        if (stderr) console.warn('PM2 restart command stderr:', stderr);
      });

      // Respond immediately, the restart happens in the background
      return res.status(200).json({ message: 'Config updated. Application is restarting with the new PM2 service name.' });

    } else {
      return res.status(200).json({ message: 'Config updated successfully.' });
    }

  } catch (error) {
    console.error('Failed to save config:', error);
    // Important: clear cache again in case of error so we don't have a corrupted config state
    delete require.cache[require.resolve('../../lib/config')];
    return res.status(500).json({ error: 'Failed to save config' });
      }
  });
  
  router.get('/settings', isAuthenticated, async (req, res) => {
// ... existing settings code
  });
  
router.post('/settings', isAuthenticated, async (req, res) => {
// ... existing settings code
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
    res.json({ message: 'Remote node deleted successfully' });
  } catch (error) {
    console.error('Failed to delete remote node:', error);
    res.status(500).json({ error: 'Failed to delete remote node' });
  }
});
  
router.get('/browse', isAuthenticated, (req, res) => {
  
    const isWindows = process.platform === 'win32';
    let currentPath = req.query.path;
    console.log(`Browsing path: ${currentPath}`);

    if (!currentPath) {
        if (isWindows) {
            console.log('No path, listing drives (Windows)');
            exec('wmic logicaldisk get name', { windowsHide: true }, (err, stdout) => {
                if (err) {
                    console.error('Error getting drives:', err);
                    return res.status(500).json({ error: 'Failed to get drives' });
                }
                const drives = stdout.split('\r\n').slice(1).map(line => line.trim()).filter(line => line.length > 0).map(drive => ({
                    name: drive,
                    path: drive + '\\'
                }));
                res.json({
                    currentPath: 'Computer',
                    parentDir: null,
                    isRoot: true,
                    directories: drives
                });
            });
            return;
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
