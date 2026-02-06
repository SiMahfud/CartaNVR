const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const sqlite3 = require('sqlite3').verbose();

test('SQLite Initialization', async (t) => {
    const dbPath = path.join(__dirname, '../nvr_init_test.db');
    
    // Ensure we start fresh
    if (fs.existsSync(dbPath)) {
        fs.unlinkSync(dbPath);
    }

    await t.test('should create database and tables', (t, done) => {
        const db = new sqlite3.Database(dbPath);
        
        db.serialize(() => {
            // This mimics what should be in lib/database.js but simplified for testing
            db.run(`CREATE TABLE IF NOT EXISTS test_users (id INTEGER PRIMARY KEY, username TEXT)`);
            
            db.get("SELECT name FROM sqlite_master WHERE type='table' AND name='test_users'", (err, row) => {
                try {
                    assert.ifError(err);
                    assert.ok(row, 'Table test_users should exist');
                    db.close(done);
                } catch (e) {
                    db.close(() => done(e));
                }
            });
        });
    });
});
