const express = require('express');
const router = express.Router();
const path = require('path');
const fs = require('fs');
const database = require('../../lib/database');
const { sanitizeCamId } = require('../../lib/utils');
const { isAuthenticated } = require('../../lib/middleware');

// Base path: /api/recordings

router.get('/:cameraId/:filename', isAuthenticated, async (req, res) => {
    try {
        const { cameraId, filename } = req.params;
        const camId = sanitizeCamId(cameraId.replace('cam_', ''));
        const camera = await database.getCameraById(camId);

        if (!camera || !camera.storage_path) {
            return res.status(404).send('Camera or storage not found');
        }

        const filePath = path.join(camera.storage_path, `cam_${camId}`, filename);

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
