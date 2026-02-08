const test = require('node:test');
const assert = require('node:assert');

test('Federation Client', async (t) => {
    // We'll mock the global fetch
    const originalFetch = global.fetch;
    
    t.after(() => {
        global.fetch = originalFetch;
    });

    await t.test('should fetch cameras from remote node', async () => {
        const mockRemoteNode = {
            url: 'http://remote-nvr:3000',
            api_key: 'secret-key',
            label: 'Remote Office'
        };

        const mockCameras = [
            { id: 1, name: 'Remote Cam 1', rtsp_url: 'rtsp://remote/1' }
        ];

        global.fetch = async (url, options) => {
            assert.strictEqual(url, 'http://remote-nvr:3000/api/cameras');
            assert.strictEqual(options.headers['X-NVR-Auth'], 'secret-key');
            return {
                ok: true,
                json: async () => mockCameras
            };
        };

        const fedClient = require('../lib/federation-client');
        const cameras = await fedClient.getRemoteCameras(mockRemoteNode);
        
        assert.strictEqual(cameras.length, 1);
        assert.strictEqual(cameras[0].name, 'Remote Cam 1');
        assert.strictEqual(cameras[0].nodeLabel, 'Remote Office');
        assert.strictEqual(cameras[0].isRemote, true);
    });

    await t.test('should handle fetch failure gracefully', async () => {
        const mockRemoteNode = {
            url: 'http://broken-nvr:3000',
            api_key: 'secret-key'
        };

        global.fetch = async () => {
            return {
                ok: false,
                statusText: 'Internal Server Error'
            };
        };

        const fedClient = require('../lib/federation-client');
        const cameras = await fedClient.getRemoteCameras(mockRemoteNode);
        
        assert.strictEqual(cameras.length, 0);
    });
});
