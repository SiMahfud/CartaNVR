const test = require('node:test');
const assert = require('node:assert');
const request = require('supertest');
const path = require('path');

// Set environment for test
process.env.NODE_ENV = 'test';
process.env.DB_TYPE = 'sqlite';

const database = require('../lib/database');
const ffmpegManager = require('../lib/ffmpeg-manager');

// Mock isAuthenticated before requiring app
const middleware = require('../lib/middleware');
test.mock.method(middleware, 'isAuthenticated', (req, res, next) => next());

// Mock ffmpegManager functions BEFORE requiring recorder or app
const startMock = test.mock.method(ffmpegManager, 'startFFmpegForCamera', () => {});
const stopMock = test.mock.method(ffmpegManager, 'stopFFmpegForCamera', async () => {});

const recorder = require('../recorder');
const app = require('../app');

test('Camera Enabled Logic Integration', async (t) => {
    let camId;

    t.after(async () => {
        await database.close();
        // The session store also uses the database, so closing it should help.
    });

    t.before(async () => {
        // Wait for DB init
        await new Promise(resolve => setTimeout(resolve, 1000));
        
        // Ensure clean state
        const cameras = await database.getAllCameras();
        for (const c of cameras) {
            await database.deleteCamera(c.id);
        }

        // Add a test camera
        const cam = await database.addCamera({
            name: 'Logic Test Cam',
            ip_address: '127.0.0.1',
            rtsp_url: 'rtsp://localhost/logic',
            storage_id: null,
            is_hevc: false,
            enabled: true
        });
        camId = cam.id;
    });

    await t.test('PUT /api/cameras/:id should stop recording when disabled', async () => {
        startMock.mock.resetCalls();
        stopMock.mock.resetCalls();

        await request(app)
            .put(`/api/cameras/${camId}`)
            .send({
                name: 'Logic Test Cam',
                rtsp_url: 'rtsp://localhost/logic',
                storage_id: null,
                is_hevc: false,
                enabled: false
            })
            .expect(200);

        const retrieved = await database.getCameraById(camId);
        assert.strictEqual(retrieved.enabled, false);
        
        assert.strictEqual(stopMock.mock.callCount(), 1);
        assert.strictEqual(stopMock.mock.calls[0].arguments[0].toString(), camId.toString());
    });

    await t.test('PUT /api/cameras/:id should start recording when enabled', async () => {
        startMock.mock.resetCalls();
        stopMock.mock.resetCalls();

        await request(app)
            .put(`/api/cameras/${camId}`)
            .send({
                name: 'Logic Test Cam',
                rtsp_url: 'rtsp://localhost/logic',
                storage_id: null,
                is_hevc: false,
                enabled: true
            })
            .expect(200);

        const retrieved = await database.getCameraById(camId);
        assert.strictEqual(retrieved.enabled, true);
        
        assert.strictEqual(startMock.mock.callCount(), 1);
        assert.strictEqual(startMock.mock.calls[0].arguments[0].id, camId);
    });

    await t.test('recorder.startAllRecordings should respect enabled flag', async () => {
        startMock.mock.resetCalls();
        
        // Add one disabled camera
        await database.addCamera({
            name: 'Disabled Startup Cam',
            ip_address: '127.0.0.1',
            rtsp_url: 'rtsp://localhost/disabled_startup',
            enabled: false
        });

        await recorder.startAllRecordings();
        
        const calls = startMock.mock.calls;
        const startNames = calls.map(c => c.arguments[0].name);
        
        assert.ok(startNames.includes('Logic Test Cam'), 'Should start enabled camera');
        assert.ok(!startNames.includes('Disabled Startup Cam'), 'Should NOT start disabled camera');
    });
});
