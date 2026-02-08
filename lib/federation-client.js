/**
 * lib/federation-client.js
 * 
 * Utility to communicate with other NVR nodes.
 */

/**
 * Fetches the camera list from a remote node.
 * @param {Object} node The remote node object {url, api_key, label}.
 * @returns {Promise<Array>} List of cameras from the remote node.
 */
async function getRemoteCameras(node) {
    try {
        const response = await fetch(`${node.url}/api/cameras`, {
            headers: {
                'X-NVR-Auth': node.api_key
            },
            // Set a reasonable timeout
            signal: AbortSignal.timeout(5000)
        });

        if (!response.ok) {
            console.error(`[FEDERATION] Failed to fetch cameras from ${node.label}: ${response.statusText}`);
            return [];
        }

        const cameras = await response.json();
        return cameras.map(cam => ({
            ...cam,
            isRemote: true,
            nodeLabel: node.label,
            nodeUrl: node.url,
            // Ensure unique ID across the federation for the frontend
            id: `remote_${node.id || 'new'}_${cam.id}`
        }));
    } catch (err) {
        console.error(`[FEDERATION] Error fetching cameras from ${node.label}:`, err.message);
        return [];
    }
}

/**
 * Fetches health status from a remote node.
 * @param {Object} node The remote node object.
 */
async function getRemoteHealth(node) {
    try {
        const response = await fetch(`${node.url}/api/maintenance/health`, {
            headers: {
                'X-NVR-Auth': node.api_key
            },
            signal: AbortSignal.timeout(5000)
        });

        if (!response.ok) return null;
        return await response.json();
    } catch (err) {
        return null;
    }
}

module.exports = {
    getRemoteCameras,
    getRemoteHealth
};
