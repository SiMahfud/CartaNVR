const test = require('node:test');
const assert = require('node:assert');
const { spawnSync } = require('child_process');

test('MySQL Connection Logic', async (t) => {
    await t.test('should attempt to connect to MySQL when DB_TYPE is mysql', () => {
        // Run a separate process to avoid polluting this process's require cache
        const result = spawnSync('node', [
            '-e',
            'process.env.DB_TYPE = "mysql"; try { require("./lib/database"); } catch(e) { console.log(e.message); }'
        ], { env: { ...process.env, DB_TYPE: 'mysql' } });

        const output = result.stdout.toString() + result.stderr.toString();
        // Since no real MySQL is running, it should either log a failure or we check if it tried to call mysql.createPool
        // We expect it to fail to connect to localhost:3306
        assert.ok(output.includes('ECONNREFUSED') || output.includes('Database initialization failed'), 'Should attempt to connect and fail');
    });
});