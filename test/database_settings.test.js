const test = require('node:test');
const assert = require('node:assert');
const database = require('../lib/database');

test('Database Settings Table', async (t) => {
    await database.init();
    
    t.after(async () => {
        await database.close();
    });

    await t.test('should have getSetting and setSetting functions', () => {
        assert.strictEqual(typeof database.getSetting, 'function', 'getSetting should be a function');
        assert.strictEqual(typeof database.setSetting, 'function', 'setSetting should be a function');
    });

    await t.test('should be able to set and get a setting', async () => {
        const key = 'test_setting';
        const value = 'test_value';
        
        await database.setSetting(key, value);
        const retrievedValue = await database.getSetting(key);
        
        assert.strictEqual(retrievedValue, value, 'Retrieved value should match set value');
    });

    await t.test('should return null for non-existent setting', async () => {
        const value = await database.getSetting('non_existent_key');
        assert.strictEqual(value, null, 'Should return null for non-existent key');
    });

    await t.test('should be able to update an existing setting', async () => {
        const key = 'update_test';
        await database.setSetting(key, 'initial');
        await database.setSetting(key, 'updated');
        const value = await database.getSetting(key);
        assert.strictEqual(value, 'updated', 'Should return updated value');
    });
});
