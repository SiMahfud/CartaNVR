const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

/**
 * Performs a basic health check of the NVR system.
 * @returns {Object} An object containing the status of various components.
 */
function checkHealth() {
    const results = {
        status: 'healthy',
        components: {}
    };

    // 1. Check recordings directory
    const recordingsDir = path.join(__dirname, '../recordings');
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

    // 3. Check Database (SQLite for now as per current implementation)
    const dbPath = path.join(__dirname, '../nvr.db');
    results.components.database = fs.existsSync(dbPath) ? 'ok' : 'missing';
    if (results.components.database === 'missing') results.status = 'degraded';

    return results;
}

module.exports = { checkHealth };
