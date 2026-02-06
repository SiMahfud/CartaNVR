const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

// Set environment for test
process.env.NODE_ENV = 'test';
process.env.DB_TYPE = 'sqlite';
const dbFile = './nvr_test.db';

// Clean up before starting
if (fs.existsSync(dbFile)) {
    try {
        fs.unlinkSync(dbFile);
    } catch (e) {}
}

const database = require('../lib/database');

test('Camera Enabled Database Column', async (t) => {
    // Wait a bit for the async init in lib/database.js to finish
    await new Promise(resolve => setTimeout(resolve, 1000));

    t.after(async () => {
        await database.close();
    });

    await t.test('should add a camera with default enabled=true', async () => {
        const cam = {
            name: 'Test Cam',
            ip_address: '127.0.0.1',
            rtsp_url: 'rtsp://localhost/test',
            storage_id: null,
            is_hevc: false
        };
        const added = await database.addCamera(cam);
        
        const retrieved = await database.getCameraById(added.id);
        assert.strictEqual(retrieved.enabled, true, 'Default enabled should be true');
    });

    await t.test('should add a camera with enabled=false', async () => {
        const cam = {
            name: 'Disabled Cam',
            ip_address: '127.0.0.1',
            rtsp_url: 'rtsp://localhost/disabled',
            storage_id: null,
            is_hevc: false,
            enabled: false
        };
        const added = await database.addCamera(cam);
        const retrieved = await database.getCameraById(added.id);
        assert.strictEqual(retrieved.enabled, false, 'Should be disabled');
    });

    await t.test('should update enabled status', async () => {
        const cam = {
            name: 'Update Cam',
            ip_address: '127.0.0.1',
            rtsp_url: 'rtsp://localhost/update',
            storage_id: null,
            is_hevc: false
        };
        const added = await database.addCamera(cam);
        
        const updateData = {
            name: 'Update Cam',
            rtsp_url: 'rtsp://localhost/update',
            storage_id: null,
            is_hevc: false,
            enabled: false
        };
        
        await database.updateCamera(added.id, updateData);
        
        const retrieved = await database.getCameraById(added.id);
        assert.strictEqual(retrieved.enabled, false, 'Should be updated to disabled');
        
        updateData.enabled = true;
        await database.updateCamera(added.id, updateData);
        const retrieved2 = await database.getCameraById(added.id);
        assert.strictEqual(retrieved2.enabled, true, 'Should be updated back to enabled');
    });

    await t.test('should include enabled in getAllCameras', async () => {
        const cameras = await database.getAllCameras();
        assert.ok(cameras.length > 0);
        assert.strictEqual(typeof cameras[0].enabled, 'boolean');
    });
});
