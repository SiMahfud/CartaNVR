const test = require('node:test');
const assert = require('node:assert');
const request = require('supertest');
const path = require('path');
const fs = require('fs');

// Mock isAuthenticated before requiring app
const middleware = require('../lib/middleware');
test.mock.method(middleware, 'isAuthenticated', (req, res, next) => next());

const app = require('../app');

test('Browse API', async (t) => {
    
    await t.test('GET /api/browse should list drives on Windows when no path is provided', async (t) => {
        // We need to mock process.platform and the drive listing implementation
        // This is tricky because process.platform is read-only in some Node versions or behaves differently
        // For the Red phase, we just want to see it fail.
        
        const response = await request(app)
            .get('/api/browse')
            .expect('Content-Type', /json/)
            .expect(200);
            
        // If we are on Windows, it might fail with 'wmic' error if 'wmic' is missing (which is what we want to test)
        // If we are on Linux, it will return the root directory '/'
        
        if (process.platform === 'win32') {
            // On Windows, we expect it to fail or return drives
            // In the Red phase, it will likely return 500 if wmic is missing
            assert.ok(response.body.directories);
            assert.ok(Array.isArray(response.body.directories));
        } else {
            // On Linux, it returns root
            assert.strictEqual(response.body.currentPath, '/');
            assert.ok(response.body.directories);
        }
    });

    await t.test('GET /api/browse should list directories for a given path', async () => {
        const testDir = path.resolve('./test_browse_dir');
        if (!fs.existsSync(testDir)) fs.mkdirSync(testDir);
        const subDir = path.join(testDir, 'subdir');
        if (!fs.existsSync(subDir)) fs.mkdirSync(subDir);

        const response = await request(app)
            .get(`/api/browse?path=${encodeURIComponent(testDir)}`)
            .expect('Content-Type', /json/)
            .expect(200);

        assert.strictEqual(response.body.currentPath, testDir);
        const found = response.body.directories.find(d => d.name === 'subdir');
        assert.ok(found);

        fs.rmdirSync(subDir);
        fs.rmdirSync(testDir);
    });
});
