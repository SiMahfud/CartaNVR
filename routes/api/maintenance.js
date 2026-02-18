const express = require('express');
const router = express.Router();
const { exec } = require('child_process');
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const config = require('../../lib/config');
const database = require('../../lib/database');
const { isAuthenticated, isAuthenticatedOrFederated } = require('../../lib/middleware');
const { checkHealth } = require('../../lib/healthcheck');

// All these routes are prefixed with /api/maintenance

// GET /api/maintenance/health - accepts both session auth and federation key
router.get('/health', isAuthenticatedOrFederated, async (req, res) => {
    try {
        const health = await checkHealth();
        res.json(health);
    } catch (error) {
        console.error('Health check failed:', error);
        res.status(500).json({ status: 'error', error: error.message });
    }
});

router.post('/reboot', isAuthenticated, (req, res) => {
    const serviceName = config.pm2_service_name || 'nvr';
    // Validate service name to prevent command injection
    if (!/^[a-zA-Z0-9_\-\s]+$/.test(serviceName)) {
        return res.status(400).json({ message: 'Invalid PM2 service name configuration' });
    }
    const command = `pm2 restart "${serviceName}"`;

    // Respond to the client immediately
    res.status(200).json({ message: 'Application reboot initiated.' });

    // Execute the restart command in the background
    exec(command, { windowsHide: true }, (error, stdout, stderr) => {
        if (error) {
            console.error(`Error rebooting application: ${error.message}`);
        }
        if (stderr) {
            console.warn(`Reboot command stderr: ${stderr}`);
        }
        console.log(`Reboot command stdout: ${stdout}`);
    });
});

router.post('/flush-logs', isAuthenticated, (req, res) => {
    // Basic validation to prevent command injection
    const serviceName = config.pm2_service_name || 'nvr';
    if (!/^[a-zA-Z0-9_\-\s]+$/.test(serviceName)) {
        return res.status(400).json({ message: 'Invalid PM2 service name' });
    }

    const command = `pm2 flush "${serviceName}"`;

    exec(command, { windowsHide: true }, (error, stdout, stderr) => {
        if (error) {
            console.error(`Error flushing logs: ${error.message}`);
            return res.status(500).json({ message: `Failed to flush logs: ${error.message}` });
        }
        res.status(200).json({ message: 'PM2 logs flushed successfully.' });
    });
});

router.get('/logs', isAuthenticated, (req, res) => {
    let lines = parseInt(req.query.lines, 10) || 200;
    if (lines < 0 || lines > 5000) lines = 200; // Cap lines for safety

    const serviceName = config.pm2_service_name || 'nvr';
    if (!/^[a-zA-Z0-9_\-\s]+$/.test(serviceName)) {
        return res.status(500).json({ logs: 'Invalid service name configuration' });
    }

    // --nostream is crucial to prevent the command from hanging
    const command = `pm2 logs "${serviceName}" --lines ${lines} --nostream`;

    exec(command, { windowsHide: true }, (error, stdout, stderr) => {
        if (error) {
            console.error(`Error fetching logs: ${error.message}`);
            return res.status(500).json({ logs: stderr || '' });
        }
        res.status(200).json({ logs: stdout + stderr });
    });
});

router.post('/update', isAuthenticated, (req, res) => {
    // Validate we're in a git repository
    const gitDir = path.join(config.BASE_DIR, '.git');
    if (!fs.existsSync(gitDir)) {
        return res.status(400).json({ message: 'Not a git repository. Update not available.' });
    }

    const command = `git pull`;

    console.log(`Executing update command: ${command}`);

    exec(command, { cwd: config.BASE_DIR, windowsHide: true }, (error, stdout, stderr) => {
        const output = stdout + stderr;
        if (error) {
            console.error(`Update command failed: ${error.message}`);
            return res.status(500).json({ message: `Update failed: ${error.message}`, output });
        }
        console.log(`Update command output: ${output}`);
        res.status(200).json({ message: 'Application update initiated successfully. The service needs to be restarted.', output });
    });
});

router.post('/run-script', isAuthenticated, (req, res) => {
    const scriptPath = '/opt/nvr/maintenance.sh';

    // Validate script exists before executing
    if (!fs.existsSync(scriptPath)) {
        return res.status(404).json({ message: `Maintenance script not found at ${scriptPath}` });
    }

    // Validate script path is the expected file (no path traversal)
    const resolvedPath = path.resolve(scriptPath);
    if (resolvedPath !== scriptPath) {
        return res.status(400).json({ message: 'Invalid script path' });
    }

    const command = `sudo ${resolvedPath}`;

    console.log(`Executing maintenance script: ${command}`);

    exec(command, { windowsHide: true }, (error, stdout, stderr) => {
        const output = stdout + stderr;
        if (error) {
            console.error(`Maintenance script failed: ${error.message}`);
            return res.status(500).json({ message: `Maintenance script failed: ${error.message}`, output });
        }
        console.log(`Maintenance script output: ${output}`);
        res.status(200).json({ message: 'Maintenance script executed successfully.', output });
    });
});

router.post('/delete-all-recordings', isAuthenticated, async (req, res) => {
    console.log('Received request to delete all recordings.');
    try {
        let deletedFiles = 0;
        const storages = await database.getAllStorages();

        for (const storage of storages) {
            if (!fs.existsSync(storage.path)) {
                console.warn(`Storage path not found, skipping: ${storage.path}`);
                continue;
            }

            const cameraDirs = await fsp.readdir(storage.path);
            for (const camDirName of cameraDirs) {
                if (!camDirName.startsWith('cam_')) continue;

                const camDirPath = path.join(storage.path, camDirName);
                try {
                    const stats = await fsp.stat(camDirPath);
                    if (!stats.isDirectory()) continue;

                    const files = await fsp.readdir(camDirPath);
                    for (const file of files) {
                        if (file.endsWith('.mp4')) {
                            const filePath = path.join(camDirPath, file);
                            try {
                                await fsp.unlink(filePath);
                                deletedFiles++;
                            } catch (fileErr) {
                                console.error(`Failed to delete file: ${filePath}`, fileErr);
                            }
                        }
                    }
                } catch (dirErr) {
                    console.error(`Failed to process directory: ${camDirPath}`, dirErr);
                }
            }
        }

        const dbResult = await database.deleteAllRecordingsFromDB();
        console.log(`Deleted ${deletedFiles} file(s) and ${dbResult.deleted} DB entries.`);
        res.status(200).json({ message: `Successfully deleted ${deletedFiles} recording(s) and cleared the database.` });

    } catch (error) {
        console.error('Error deleting all recordings:', error);
        res.status(500).json({ message: `Failed to delete all recordings: ${error.message}` });
    }
});

module.exports = router;
