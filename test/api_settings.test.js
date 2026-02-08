const test = require('node:test');
const assert = require('node:assert');
const request = require('supertest');

// Mock isAuthenticated before requiring app
const middleware = require('../lib/middleware');
test.mock.method(middleware, 'isAuthenticated', (req, res, next) => next());

const app = require('../app');
const database = require('../lib/database');

test('Settings API', async (t) => {
    process.env.DB_FILE = './nvr_api_settings_test.db';
    await database.init();
    
    t.after(async () => {
        await database.close();
        const fs = require('fs');
        if (fs.existsSync(process.env.DB_FILE)) fs.unlinkSync(process.env.DB_FILE);
    });

    t.beforeEach(async () => {
        // Reset all relevant settings to '0'
        await database.setSetting('log_terminal_general', '0');
        await database.setSetting('log_terminal_recorder', '0');
        await database.setSetting('log_terminal_storage', '0');
    });

    await t.test('GET /api/settings should return all logging settings', async () => {
        await database.setSetting('log_terminal_general', '1');
        await database.setSetting('log_terminal_recorder', '0');
        
        const response = await request(app)
            .get('/api/settings')
            .expect('Content-Type', /json/)
            .expect(200);
            
        assert.strictEqual(response.body.log_terminal_general, '1');
        assert.strictEqual(response.body.log_terminal_recorder, '0');
        assert.strictEqual(response.body.log_terminal_storage, '0'); // default
    });

    await t.test('POST /api/settings should update settings', async () => {
        await request(app)
            .post('/api/settings')
            .send({ log_terminal_storage: '1', log_terminal_general: '0' })
            .expect(200);
            
        const storageVal = await database.getSetting('log_terminal_storage');
        const generalVal = await database.getSetting('log_terminal_general');
        
        assert.strictEqual(storageVal, '1');
        assert.strictEqual(generalVal, '0');
    });
});
