const test = require('node:test');
const assert = require('node:assert');
const database = require('../lib/database');

test('Reload Settings Hook', async (t) => {
    process.env.DB_FILE = './nvr_reload_test.db';
    await database.init();
    
    t.after(async () => {
        await database.close();
        const fs = require('fs');
        if (fs.existsSync(process.env.DB_FILE)) fs.unlinkSync(process.env.DB_FILE);
    });

    await t.test('Should emit settingChanged event when a setting is updated', async () => {
        let capturedKey, capturedValue;
        database.events.once('settingChanged', (key, value) => {
            capturedKey = key;
            capturedValue = value;
        });

        await database.setSetting('test_key', 'test_value');
        
        // Wait a tiny bit for event loop
        await new Promise(resolve => setTimeout(resolve, 10));

        assert.strictEqual(capturedKey, 'test_key');
        assert.strictEqual(capturedValue, 'test_value');
    });
});
