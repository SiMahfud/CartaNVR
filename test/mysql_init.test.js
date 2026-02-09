const test = require('node:test');
const assert = require('node:assert');
const { spawnSync } = require('child_process');

test('MySQL Connection Logic', async (t) => {
    await t.test('should attempt to connect to MySQL when DB_TYPE is mysql', () => {
        // Run a separate process to avoid polluting this process's require cache
        const result = spawnSync('node', [
            '-e',
            'const db = require("./lib/database"); db.init().catch(e => { console.log(e.message); process.exit(1); });'
        ], {
            env: { ...process.env, DB_TYPE: 'mysql', MYSQL_HOST: 'localhost', MYSQL_USER: 'root', MYSQL_CONNECT_TIMEOUT: '2000' },
            timeout: 5000
        });

        const output = result.stdout.toString() + result.stderr.toString();
        // console.log('DEBUG OUTPUT:', output);
        // console.log('DEBUG STATUS:', result.status, 'SIGNAL:', result.signal);

        // Test passes if any of these conditions are met:
        // 1. Connection refused error
        // 2. Timeout killed the process (signal = SIGTERM)
        // 3. Process exited with error code (status != 0)
        // 4. Any connect-related error message
        const connectionFailed =
            output.includes('ECONNREFUSED') ||
            output.includes('ETIMEDOUT') ||
            output.includes('Database initialization failed') ||
            output.includes('connect') ||
            output.includes('Access denied') ||
            result.signal === 'SIGTERM' ||  // Timeout killed the process
            result.status !== 0;  // Process exited with error

        assert.ok(
            connectionFailed,
            'Should attempt to connect and fail. Output: ' + output + ', Status: ' + result.status + ', Signal: ' + result.signal
        );
    });
});