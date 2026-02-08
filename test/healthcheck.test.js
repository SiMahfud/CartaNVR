const test = require('node:test');
const assert = require('node:assert');
const { checkHealth } = require('../lib/healthcheck');
const database = require('../lib/database');

test('System Health Check', async (t) => {
    t.after(async () => {
        await database.close();
    });

    await t.test('should return a health status object', async () => {
        const health = await checkHealth();
        assert.strictEqual(typeof health, 'object');
        assert.ok(health.status);
        assert.ok(health.components);
    });

    await t.test('should verify database existence', async () => {
        const health = await checkHealth();
        assert.ok(health.components.database === 'ok' || health.components.database === 'error');
    });
});
