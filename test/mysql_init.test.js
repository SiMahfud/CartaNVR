const test = require('node:test');
const assert = require('node:assert');
const { spawnSync } = require('child_process');

test('MySQL Connection Logic', async (t) => {
    await t.test('should attempt to connect to MySQL when DB_TYPE is mysql', () => {
        // Run a separate process to avoid polluting this process's require cache
        const result = spawnSync('node', [
            '-e',
            'const db = require("./lib/database"); db.init().catch(e => { console.log(e.message); process.exit(1); });'
        ], { env: { ...process.env, DB_TYPE: 'mysql', MYSQL_HOST: 'localhost', MYSQL_USER: 'root' } });

        const output = result.stdout.toString() + result.stderr.toString();
        // console.log('DEBUG OUTPUT:', output);
        // Since no real MySQL is running, it should either log a failure or we check if it tried to call mysql.createPool
        // We expect it to fail to connect to localhost:3306 or fail authentication
        assert.ok(
            output.includes('ECONNREFUSED') || 
            output.includes('Database initialization failed') || 
            output.includes('connect') ||
            output.includes('Access denied'), 
            'Should attempt to connect and fail. Output: ' + output
        );
    });
});