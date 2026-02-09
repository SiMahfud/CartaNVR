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
        // Reset all relevant settings
        await database.setSetting('log_terminal_general', '0');
        await database.setSetting('log_terminal_recorder', '0');
        await database.setSetting('log_terminal_storage', '0');
        await database.setSetting('server_port', '3000');
        await database.setSetting('recording_path', './recordings');
    });

    await t.test('GET /api/settings should return all settings', async () => {
        await database.setSetting('log_terminal_general', '1');
        await database.setSetting('server_port', '8080');
        
        const response = await request(app)
            .get('/api/settings')
            .expect('Content-Type', /json/)
            .expect(200);
            
        assert.strictEqual(response.body.log_terminal_general, '1');
        assert.strictEqual(response.body.server_port, '8080');
        assert.strictEqual(response.body.recording_path, './recordings');
    });

    await t.test('POST /api/settings should update multiple settings', async () => {
        await request(app)
            .post('/api/settings')
            .send({ 
                log_terminal_storage: '1', 
                server_port: '9000',
                recording_path: '/mnt/data' 
            })
            .expect(200);
            
        assert.strictEqual(await database.getSetting('log_terminal_storage'), '1');
        assert.strictEqual(await database.getSetting('server_port'), '9000');
        assert.strictEqual(await database.getSetting('recording_path'), '/mnt/data');
    });
});
