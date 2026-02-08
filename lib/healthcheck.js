const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const database = require('./database');
const config = require('./config');

/**
 * Performs a basic health check of the NVR system.
 * @returns {Promise<Object>} An object containing the status of various components.
 */
async function checkHealth() {
    const results = {
        status: 'healthy',
        components: {}
    };

    // 1. Check recordings directory
    const recordingsDir = config.RECORDINGS_DIR;
    results.components.recordingsDir = fs.existsSync(recordingsDir) ? 'ok' : 'missing';
    if (results.components.recordingsDir === 'missing') results.status = 'degraded';

    // 2. Check ffmpeg
    try {
        const ffmpeg = spawnSync('ffmpeg', ['-version']);
        results.components.ffmpeg = ffmpeg.status === 0 ? 'ok' : 'error';
    } catch (e) {
        results.components.ffmpeg = 'missing';
    }
    if (results.components.ffmpeg !== 'ok') results.status = 'degraded';

    // 3. Check Database
    try {
        await database.init();
        // Simple query to verify connection
        await database.findUserById(1);
        results.components.database = 'ok';
    } catch (e) {
        results.components.database = 'error';
        results.status = 'degraded';
    }

    return results;
}

module.exports = { checkHealth };
