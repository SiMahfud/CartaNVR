const test = require('node:test');
const assert = require('node:assert');
const database = require('../lib/database');

// We need to wait for database to be ready
const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

test('Centralized Logger', async (t) => {
    // Init DB
    await database.init();
    
    t.after(async () => {
        await database.close();
    });

    const logger = require('../lib/logger');
    const originalLog = console.log;
    let logOutput = [];
    
    t.beforeEach(() => {
        logOutput = [];
        console.log = (...args) => {
            logOutput.push(args.join(' '));
        };
    });
    
    t.afterEach(() => {
        console.log = originalLog;
    });

    await t.test('should not log if setting is disabled (default)', async () => {
        // Ensure setting is NOT set (or set to false/0)
        await database.setSetting('log_terminal_general', '0');
        
        await logger.log('general', 'Test message');
        assert.strictEqual(logOutput.length, 0, 'Should not have logged anything');
    });

    await t.test('should log if setting is enabled', async () => {
        await database.setSetting('log_terminal_general', '1');
        
        await logger.log('general', 'Test message');
        assert.ok(logOutput.length > 0, 'Should have logged something');
        assert.ok(logOutput[0].includes('Test message'), 'Log should contain the message');
    });

    await t.test('should handle different categories', async () => {
        await database.setSetting('log_terminal_recorder', '1');
        await database.setSetting('log_terminal_storage', '0');
        
        await logger.log('recorder', 'Recorder message');
        await logger.log('storage', 'Storage message');
        
        assert.ok(logOutput.some(l => l.includes('Recorder message')), 'Should log recorder message');
        assert.ok(!logOutput.some(l => l.includes('Storage message')), 'Should NOT log storage message');
    });
});
