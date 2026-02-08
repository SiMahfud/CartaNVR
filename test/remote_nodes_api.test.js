const test = require('node:test');
const assert = require('node:assert');
const request = require('supertest');
const database = require('../lib/database');

// Mock isAuthenticated before requiring app
const middleware = require('../lib/middleware');
test.mock.method(middleware, 'isAuthenticated', (req, res, next) => next());

const app = require('../app');

test('Remote Nodes API', async (t) => {
    // Unique DB for this test
    process.env.DB_FILE = './nvr_remote_nodes_test.db';
    await database.init();

    t.after(async () => {
        await database.close();
        const fs = require('fs');
        if (fs.existsSync(process.env.DB_FILE)) fs.unlinkSync(process.env.DB_FILE);
    });

    let nodeId;

    await t.test('POST /api/system/nodes should create a new remote node', async () => {
        const newNode = {
            url: 'http://192.168.1.100:3000',
            label: 'Office NVR',
            api_key: 'secret-key-123'
        };

        const response = await request(app)
            .post('/api/system/nodes')
            .send(newNode)
            .expect(201);
        
        assert.ok(response.body.id);
        assert.strictEqual(response.body.label, newNode.label);
        nodeId = response.body.id;
    });

    await t.test('GET /api/system/nodes should return all remote nodes', async () => {
        const response = await request(app)
            .get('/api/system/nodes')
            .expect(200);
        
        assert.ok(Array.isArray(response.body));
        assert.ok(response.body.some(n => n.id === nodeId));
    });

    await t.test('PUT /api/system/nodes/:id should update a remote node', async () => {
        const updatedNode = {
            url: 'http://192.168.1.100:3000',
            label: 'Main Office',
            api_key: 'updated-key'
        };

        await request(app)
            .put(`/api/system/nodes/${nodeId}`)
            .send(updatedNode)
            .expect(200);
        
        const response = await request(app).get('/api/system/nodes');
        const node = response.body.find(n => n.id === nodeId);
        assert.strictEqual(node.label, 'Main Office');
        assert.strictEqual(node.api_key, 'updated-key');
    });

    await t.test('DELETE /api/system/nodes/:id should delete a remote node', async () => {
        await request(app)
            .delete(`/api/system/nodes/${nodeId}`)
            .expect(200);
        
        const response = await request(app).get('/api/system/nodes');
        assert.ok(!response.body.some(n => n.id === nodeId));
    });
});
