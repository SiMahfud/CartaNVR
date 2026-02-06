const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

test('Dependency Audit', async (t) => {
    const packageJsonPath = path.join(__dirname, '../package.json');
    const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
    const dependencies = Object.keys(packageJson.dependencies || {});

    for (const dep of dependencies) {
        await t.test(`should have ${dep} installed`, () => {
            try {
                require.resolve(dep);
            } catch (e) {
                assert.fail(`Dependency ${dep} is not installed`);
            }
        });
    }
});
