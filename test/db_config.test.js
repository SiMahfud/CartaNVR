const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');

// We want to verify that we can load the database module with different environment variables
test('Database Configuration', async (t) => {
    const db = require('../lib/database');
    await db.init();
    await t.test('should favor SQLite by default', () => {
        assert.strictEqual(db.DB_TYPE, 'sqlite');
    });
});
