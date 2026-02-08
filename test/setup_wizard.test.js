const test = require('node:test');
const assert = require('node:assert');
const { validateHost, validateNonEmpty, verifyConnection } = require('../lib/setup-wizard');

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

test('Connection Verification', async (t) => {
    await t.test('verifyConnection should be a function', () => {
        assert.strictEqual(typeof verifyConnection, 'function');
    });

    await t.test('verifyConnection should return true for sqlite', async () => {
        const result = await verifyConnection({ DB_TYPE: 'sqlite' });
        assert.strictEqual(result, true);
    });

    await t.test('verifyConnection should handle mysql success', async () => {
        // Mock mysql2
        const mockMysql = require('mysql2/promise');
        const originalCreateConnection = mockMysql.createConnection;
        mockMysql.createConnection = async () => ({
            end: async () => {}
        });

        try {
            const result = await verifyConnection({
                DB_TYPE: 'mysql',
                MYSQL_HOST: 'localhost',
                MYSQL_USER: 'root',
                MYSQL_DATABASE: 'nvr'
            });
            assert.strictEqual(result, true);
        } finally {
            mockMysql.createConnection = originalCreateConnection;
        }
    });

    await t.test('verifyConnection should handle mysql failure', async () => {
        const mockMysql = require('mysql2/promise');
        const originalCreateConnection = mockMysql.createConnection;
        mockMysql.createConnection = async () => {
            throw new Error('Connection refused');
        };

        try {
            await assert.rejects(
                verifyConnection({
                    DB_TYPE: 'mysql',
                    MYSQL_HOST: 'localhost',
                    MYSQL_USER: 'root',
                    MYSQL_DATABASE: 'nvr'
                }),
                { message: /Failed to connect to MySQL: Connection refused/ }
            );
        } finally {
            mockMysql.createConnection = originalCreateConnection;
        }
    });
});
