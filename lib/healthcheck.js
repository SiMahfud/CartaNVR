const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const database = require('./database');
const config = require('./config');
const ffmpegPath = require('ffmpeg-static');

/**
 * Performs a basic health check of the NVR system.
 * @returns {Promise<Object>} An object containing the status of various components.
 */
async function checkHealth() {
    const results = {
        status: 'healthy',
        components: {},
        remote_nodes: []
    };

    // 1. Check recordings directory
    const recordingsDir = config.RECORDINGS_DIR;
    results.components.recordingsDir = fs.existsSync(recordingsDir) ? 'ok' : 'missing';
    if (results.components.recordingsDir === 'missing') results.status = 'degraded';

    // 2. Check ffmpeg (use bundled ffmpeg-static binary)
    try {
        const ffmpeg = spawnSync(ffmpegPath, ['-version'], { windowsHide: true });
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

    // 4. Check Remote Nodes
    try {
        const fedClient = require('./federation-client');
        const remoteNodes = await database.getAllRemoteNodes();
        if (remoteNodes.length > 0) {
            const remoteHealthPromises = remoteNodes.map(async (node) => {
                const health = await fedClient.getRemoteHealth(node);
                return {
                    label: node.label,
                    url: node.url,
                    status: health ? health.status : 'unreachable'
                };
            });
            results.remote_nodes = await Promise.all(remoteHealthPromises);

            if (results.remote_nodes.some(n => n.status === 'unreachable')) {
                if (results.status === 'healthy') results.status = 'degraded';
            }
        }
    } catch (e) {
        console.error('Remote health check failed:', e);
    }

    return results;
}

module.exports = { checkHealth };
