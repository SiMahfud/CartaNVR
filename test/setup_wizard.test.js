const test = require('node:test');
const assert = require('node:assert');
const { validateHost, validateNonEmpty } = require('../lib/setup-wizard');

test('Setup Wizard Validation', async (t) => {
    await t.test('validateNonEmpty should return true for non-empty string', () => {
        assert.strictEqual(validateNonEmpty('test'), true);
    });

    await t.test('validateNonEmpty should return error message for empty string', () => {
        assert.strictEqual(typeof validateNonEmpty(''), 'string');
    });

    await t.test('validateHost should return true for valid hostname', () => {
        assert.strictEqual(validateHost('localhost'), true);
        assert.strictEqual(validateHost('127.0.0.1'), true);
        assert.strictEqual(validateHost('db.example.com'), true);
    });

    await t.test('validateHost should return error message for invalid hostname', () => {
        assert.strictEqual(typeof validateHost('not a host!'), 'string');
        assert.strictEqual(typeof validateHost(''), 'string');
    });
});
