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

test('Federation API Aggregation', async (t) => {
    const middleware = require('../lib/middleware');
    test.mock.method(middleware, 'isAuthenticated', (req, res, next) => next());

    const database = require('../lib/database');
    const request = require('supertest');
    const app = require('../app');

    process.env.DB_FILE = './nvr_fed_aggregation_test.db';
    await database.init();

    t.after(async () => {
        await database.close();
        const fs = require('fs');
        if (fs.existsSync(process.env.DB_FILE)) fs.unlinkSync(process.env.DB_FILE);
    });

    await t.test('GET /api/cameras should include remote cameras', async (t) => {
        // Mock remote node in DB
        const remoteNode = await database.addRemoteNode({
            url: 'http://mock-remote:3000',
            label: 'Mock Remote',
            api_key: 'mock-key'
        });

        // Mock fetch for fedClient
        const originalFetch = global.fetch;
        global.fetch = async (url) => {
            if (url.includes('/api/cameras')) {
                return {
                    ok: true,
                    json: async () => [{ id: 99, name: 'Mock Remote Cam' }]
                };
            }
            return { ok: false };
        };

        try {
            // Mock auth
            test.mock.method(middleware, 'isAuthenticated', (req, res, next) => next());

            const response = await request(app)
                .get('/api/cameras')
                .expect(200);
            
            assert.ok(Array.isArray(response.body));
            assert.ok(response.body.some(c => c.name === 'Mock Remote Cam' && c.isRemote === true));
        } finally {
            global.fetch = originalFetch;
        }
    });
});
