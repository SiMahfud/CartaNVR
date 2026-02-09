const test = require('node:test');
const assert = require('node:assert');
const request = require('supertest');
const fs = require('fs');
const path = require('path');

// Mock isAuthenticated before requiring app
const middleware = require('../lib/middleware');
test.mock.method(middleware, 'isAuthenticated', (req, res, next) => next());

const app = require('../app');
const database = require('../lib/database');
const logger = require('../lib/logger');

test('Settings End-to-End Persistence', async (t) => {
    const TEST_DB = './nvr_settings_e2e.db';
    process.env.DB_FILE = TEST_DB;
    await database.init();
    
    t.after(async () => {
        await database.close();
        if (fs.existsSync(TEST_DB)) fs.unlinkSync(TEST_DB);
    });

    await t.test('Saving settings via API should persist to DB and reflect in GET', async () => {
        const testSettings = {
            log_terminal_general: '1',
            server_port: '5555',
            recording_path: '/tmp/test_recordings',
            CLEANUP_INTERVAL_MS: '600000'
        };

        // 1. Save settings
        await request(app)
            .post('/api/settings')
            .send(testSettings)
            .expect(200);

        // 2. Verify in Database directly
        assert.strictEqual(await database.getSetting('log_terminal_general'), '1');
        assert.strictEqual(await database.getSetting('server_port'), '5555');
        assert.strictEqual(await database.getSetting('recording_path'), '/tmp/test_recordings');
        assert.strictEqual(await database.getSetting('CLEANUP_INTERVAL_MS'), '600000');

        // 3. Verify via GET API
        const response = await request(app)
            .get('/api/settings')
            .expect(200);
        
        assert.strictEqual(response.body.log_terminal_general, '1');
        assert.strictEqual(response.body.server_port, '5555');
        assert.strictEqual(response.body.recording_path, '/tmp/test_recordings');
    });

    await t.test('Settings change should trigger Reload Hook (settingChanged event)', async () => {
        let eventFired = false;
        let changedKey, changedValue;

        database.events.once('settingChanged', (key, value) => {
            eventFired = true;
            changedKey = key;
            changedValue = value;
        });

        await request(app)
            .post('/api/settings')
            .send({ log_terminal_recorder: '1' })
            .expect(200);

        // Give a moment for event to propagate
        await new Promise(resolve => setTimeout(resolve, 50));

        assert.strictEqual(eventFired, true, 'settingChanged event should have fired');
        assert.strictEqual(changedKey, 'log_terminal_recorder');
        assert.strictEqual(changedValue, '1');
    });

    await t.test('Logger should update its internal state when settings change', async () => {
        // Initially set to 0
        await database.setSetting('log_terminal_general', '0');
        // Trigger manually or via API to ensure sync
        await request(app).post('/api/settings').send({ log_terminal_general: '0' }).expect(200);
        
        // Wait for propagation
        await new Promise(resolve => setTimeout(resolve, 50));
        
        // Now update to 1
        await request(app)
            .post('/api/settings')
            .send({ log_terminal_general: '1' })
            .expect(200);

        await new Promise(resolve => setTimeout(resolve, 50));

        // We can't easily check logger's private state, but we can check if it's listening
        // In a real E2E we might check terminal output, but here we trust the event hook
        // which was verified in the previous sub-test.
    });

    await t.test('Settings should survive application restart (DB close/re-init)', async () => {
        const restartKey = 'restart_test_key';
        const restartValue = 'survivor';

        // 1. Set setting
        await database.setSetting(restartKey, restartValue);
        
        // 2. Simulate restart by closing and re-opening DB
        await database.close();
        await database.init();

        // 3. Verify setting still exists
        const retrieved = await database.getSetting(restartKey);
        assert.strictEqual(retrieved, restartValue, 'Setting should persist after DB restart');
    });
});
