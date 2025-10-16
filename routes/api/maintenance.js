const express = require('express');
const router = express.Router();
const { exec } = require('child_process');
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const config = require('../../lib/config');
const database = require('../../lib/database');
const { isAuthenticated } = require('../../lib/middleware');

// All these routes are prefixed with /api/maintenance

router.post('/reboot', isAuthenticated, (req, res) => {
    const serviceName = config.pm2_service_name || 'nvr';
    const command = `pm2 restart "${serviceName}"`;

    // Respond to the client immediately
    res.status(200).json({ message: 'Application reboot initiated.' });

    // Execute the restart command in the background
    exec(command, { windowsHide: true }, (error, stdout, stderr) => {
        if (error) {
            console.error(`Error rebooting application: ${error.message}`);
            // This happens in the background, so we just log it.
        }
        if (stderr) {
            console.warn(`Reboot command stderr: ${stderr}`);
        }
        console.log(`Reboot command stdout: ${stdout}`);
    });
});

router.post('/flush-logs', isAuthenticated, (req, res) => {
    const command = `pm2 flush "${config.pm2_service_name}"`;

    exec(command, { windowsHide: true }, (error, stdout, stderr) => {
        if (error) {
            console.error(`Error flushing logs: ${error.message}`);
            return res.status(500).json({ message: `Failed to flush logs: ${error.message}` });
        }
        if (stderr) {
            console.warn(`Flush logs command stderr: ${stderr}`);
        }
        console.log(`Flush logs command stdout: ${stdout}`);
        res.status(200).json({ message: 'PM2 logs flushed successfully.' });
    });
});

router.get('/logs', isAuthenticated, (req, res) => {
    const lines = req.query.lines || 200;
    // --nostream is crucial to prevent the command from hanging
    const command = `pm2 logs "${config.pm2_service_name}" --lines ${lines} --nostream`;

    exec(command, { windowsHide: true }, (error, stdout, stderr) => {
        if (error) {
            console.error(`Error fetching logs: ${error.message}`);
            // Even if the command fails, stderr might have useful info (e.g., "process not found")
            return res.status(500).json({ logs: stderr || '' });
        }
        // PM2 logs command often outputs to both stdout and stderr, so we combine them.
        res.status(200).json({ logs: stdout + stderr });
    });
});

router.post('/update', isAuthenticated, (req, res) => {
    // Menjalankan git pull
    const command = `git pull`;

    console.log(`Executing update command: ${command}`);

    exec(command, { windowsHide: true }, (error, stdout, stderr) => {
        const output = stdout + stderr;
        if (error) {
            console.error(`Update command failed: ${error.message}`);
            return res.status(500).json({ message: `Update failed: ${error.message}`, output });
        }
        console.log(`Update command output: ${output}`);
        res.status(200).json({ message: 'Application update initiated successfully. The service need to restart restart.', output });
    });
});

router.post('/run-script', isAuthenticated, (req, res) => {
    // PERINGATAN: Endpoint ini menjalankan perintah dengan sudo.
    // Pastikan Anda telah mengkonfigurasi /etc/sudoers dengan benar di server Anda
    // agar pengguna yang menjalankan Node.js dapat menjalankan skrip ini tanpa password.
    const scriptPath = '/opt/nvr/maintenance.sh'; // Ganti dengan path skrip Anda yang sebenarnya
    const command = `sudo ${scriptPath}`;

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
