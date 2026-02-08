const test = require('node:test');
const assert = require('node:assert');
const discovery = require('../lib/discovery');

test('mDNS Discovery', async (t) => {
    t.after(() => {
        discovery.destroy();
    });

    await t.test('should advertise and discover NVR service', async () => {
        // Use a unique name for testing
        const testName = `Test NVR ${Date.now()}`;
        
        // Start advertising
        discovery.startAdvertising(testName, 3000);

        // Scan for services
        return new Promise((resolve, reject) => {
            const timeout = setTimeout(() => {
                discovery.stopScanning();
                discovery.stopAdvertising();
                reject(new Error('Discovery timed out'));
            }, 10000);

            discovery.scan((service) => {
                if (service.name === testName) {
                    clearTimeout(timeout);
                    discovery.stopScanning();
                    discovery.stopAdvertising();
                    assert.strictEqual(service.port, 3000);
                    resolve();
                }
            });
        });
    });
});
