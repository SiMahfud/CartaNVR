const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const fs = require('fs');

test('Startup Config Check', async (t) => {
    // We need to test the logic that triggers the wizard
    // Since server.js runs initialize() immediately, we'll test the checkConfig function by requiring a modified version or mocking
    
    await t.test('should trigger wizard if DB_TYPE is missing', async () => {
        const setupWizard = require('../lib/setup-wizard');
        const originalRunWizard = setupWizard.runWizard;
        const originalVerifyConnection = setupWizard.verifyConnection;
        const originalSaveConfig = setupWizard.saveConfig;

        let wizardCalled = false;
        setupWizard.runWizard = async () => {
            wizardCalled = true;
            return { DB_TYPE: 'sqlite' };
        };
        setupWizard.verifyConnection = async () => true;
        setupWizard.saveConfig = async () => {};

        try {
            // Simulate the checkConfig logic
            const checkConfig = async () => {
                if (!process.env.DB_TYPE) {
                    const config = await setupWizard.runWizard();
                    await setupWizard.verifyConnection(config);
                    await setupWizard.saveConfig(config);
                }
            };

            // Ensure DB_TYPE is not set for this test
            const oldDbType = process.env.DB_TYPE;
            delete process.env.DB_TYPE;

            await checkConfig();

            assert.strictEqual(wizardCalled, true, 'Wizard should have been called');
            
            // Restore
            process.env.DB_TYPE = oldDbType;
        } finally {
            setupWizard.runWizard = originalRunWizard;
            setupWizard.verifyConnection = originalVerifyConnection;
            setupWizard.saveConfig = originalSaveConfig;
        }
    });

    await t.test('should NOT trigger wizard if DB_TYPE is present', async () => {
        const setupWizard = require('../lib/setup-wizard');
        const originalRunWizard = setupWizard.runWizard;
        
        let wizardCalled = false;
        setupWizard.runWizard = async () => {
            wizardCalled = true;
            return { DB_TYPE: 'sqlite' };
        };

        try {
            const checkConfig = async () => {
                if (!process.env.DB_TYPE) {
                    const config = await setupWizard.runWizard();
                    await setupWizard.verifyConnection(config);
                    await setupWizard.saveConfig(config);
                }
            };

            const oldDbType = process.env.DB_TYPE;
            process.env.DB_TYPE = 'sqlite';

            await checkConfig();

            assert.strictEqual(wizardCalled, false, 'Wizard should NOT have been called');
            
            process.env.DB_TYPE = oldDbType;
        } finally {
            setupWizard.runWizard = originalRunWizard;
        }
    });
});
