const express = require('express');
const router = express.Router();
const path = require('path');
const fs = require('fs');
const database = require('../../lib/database');
const { sanitizeCamId } = require('../../lib/utils');
const { isAuthenticated, isAuthenticatedOrFederated } = require('../../lib/middleware');

// Base path: /api/recordings

router.get('/:cameraId/:filename', isAuthenticatedOrFederated, async (req, res) => {
    try {
        const { cameraId, filename } = req.params;

        // Validate filename to prevent path traversal
        if (filename.includes('..') || filename.includes('/') || filename.includes('\\')) {
            return res.status(400).send('Invalid filename');
        }

        const camId = sanitizeCamId(cameraId.replace('cam_', ''));
        const camera = await database.getCameraById(camId);

        if (!camera || !camera.storage_path) {
            return res.status(404).send('Camera or storage not found');
        }

        const camDir = path.join(camera.storage_path, `cam_${camId}`);
        const filePath = path.join(camDir, filename);

        // Double-check resolved path stays within camera directory
        const resolvedPath = path.resolve(filePath);
        if (!resolvedPath.startsWith(path.resolve(camDir))) {
            return res.status(400).send('Invalid filename');
        }

        if (fs.existsSync(filePath)) {
            res.sendFile(filePath);
        } else {
            res.status(404).send('File not found');
        }
    } catch (error) {
        console.error('Error serving recording:', error);
        res.status(500).send('Server error');
    }
});

module.exports = router;
