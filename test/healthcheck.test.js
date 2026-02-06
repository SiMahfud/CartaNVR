const test = require('node:test');
const assert = require('node:assert');
const { checkHealth } = require('../lib/healthcheck');

test('System Health Check', async (t) => {
    await t.test('should return a health status object', () => {
        const health = checkHealth();
        assert.strictEqual(typeof health, 'object');
        assert.ok(health.status);
        assert.ok(health.components);
    });

    await t.test('should verify database existence', () => {
        const health = checkHealth();
        assert.ok(health.components.database === 'ok' || health.components.database === 'missing');
    });
});
