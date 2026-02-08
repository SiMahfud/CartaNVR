const test = require('node:test');
const assert = require('node:assert');
const request = require('supertest');
const database = require('../lib/database');
const middleware = require('../lib/middleware');
const app = require('../app');

test('Federation Authentication', async (t) => {
    // Unique DB for this test
    process.env.DB_FILE = './nvr_fed_auth_test.db';
    await database.init();

    t.after(async () => {
        await database.close();
        const fs = require('fs');
        if (fs.existsSync(process.env.DB_FILE)) fs.unlinkSync(process.env.DB_FILE);
    });

    await t.test('should generate and save federation key', async () => {
        const crypto = require('crypto');
        const key = crypto.randomBytes(32).toString('hex');
        await database.setSetting('federation_key', key);
        
        const savedKey = await database.getSetting('federation_key');
        assert.strictEqual(savedKey, key);
    });

    await t.test('middleware should allow valid X-NVR-Auth header', async () => {
        const key = 'test-secret-key';
        await database.setSetting('federation_key', key);

        // We need an endpoint that uses this middleware.
        // For testing, we can create a temporary route or mock it.
        // Let's check if we can add a test route to app.
        
        const express = require('express');
        const testApp = express();
        testApp.get('/test-fed-auth', middleware.isFederated, (req, res) => {
            res.status(200).send('OK');
        });

        const response = await request(testApp)
            .get('/test-fed-auth')
            .set('X-NVR-Auth', key);
        
        assert.strictEqual(response.status, 200);
    });

    await t.test('middleware should block invalid X-NVR-Auth header', async () => {
        const key = 'test-secret-key';
        await database.setSetting('federation_key', key);

        const express = require('express');
        const testApp = express();
        testApp.get('/test-fed-auth', middleware.isFederated, (req, res) => {
            res.status(200).send('OK');
        });

        const response = await request(testApp)
            .get('/test-fed-auth')
            .set('X-NVR-Auth', 'wrong-key');
        
        assert.strictEqual(response.status, 401);
    });

    await t.test('middleware should block missing X-NVR-Auth header', async () => {
        const express = require('express');
        const testApp = express();
        testApp.get('/test-fed-auth', middleware.isFederated, (req, res) => {
            res.status(200).send('OK');
        });

        const response = await request(testApp)
            .get('/test-fed-auth');
        
        assert.strictEqual(response.status, 401);
    });
});
