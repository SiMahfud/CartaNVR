const test = require('node:test');
const assert = require('node:assert');
const request = require('supertest');
const database = require('../lib/database');
const app = require('../app');

test('CORS and Origin Handling', async (t) => {
  await database.init();

  await t.test('should allow requests with no Origin header', async () => {
    const res = await request(app).get('/');
    assert.strictEqual(res.status, 200);
  });

  await t.test('should allow same-origin requests matching Host header', async () => {
    const res = await request(app)
      .get('/')
      .set('Host', 'nvr.sman1campurdarat.sch.id')
      .set('Origin', 'https://nvr.sman1campurdarat.sch.id');

    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.headers['access-control-allow-origin'], 'https://nvr.sman1campurdarat.sch.id');
  });

  await t.test('should allow same-origin requests matching X-Forwarded-Host header', async () => {
    const res = await request(app)
      .get('/')
      .set('X-Forwarded-Host', 'nvr.sman1campurdarat.sch.id')
      .set('Origin', 'https://nvr.sman1campurdarat.sch.id');

    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.headers['access-control-allow-origin'], 'https://nvr.sman1campurdarat.sch.id');
  });

  await t.test('should allow same-origin POST /login without crashing with CORS error', async () => {
    const res = await request(app)
      .post('/login')
      .set('Host', 'nvr.sman1campurdarat.sch.id')
      .set('Origin', 'https://nvr.sman1campurdarat.sch.id')
      .send({ username: 'invalid_user', password: 'wrong_password' });

    // Should redirect to /?error=1 (status 302), NOT crash with status 500
    assert.strictEqual(res.status, 302);
    assert.strictEqual(res.headers['access-control-allow-origin'], 'https://nvr.sman1campurdarat.sch.id');
  });

  await t.test('should allow localhost and loopback origins', async () => {
    const res = await request(app)
      .get('/')
      .set('Origin', 'http://localhost:3000');

    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.headers['access-control-allow-origin'], 'http://localhost:3000');
  });

  await t.test('should allow private IP origins', async () => {
    const res = await request(app)
      .get('/')
      .set('Origin', 'http://192.168.1.50:8080');

    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.headers['access-control-allow-origin'], 'http://192.168.1.50:8080');
  });

  await t.test('should allow origins from CORS_WHITELIST env', async () => {
    const originalWhitelist = process.env.CORS_WHITELIST;
    process.env.CORS_WHITELIST = '*.example.com, trusted-site.org';

    try {
      const res = await request(app)
        .get('/')
        .set('Origin', 'https://sub.example.com');

      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.headers['access-control-allow-origin'], 'https://sub.example.com');
    } finally {
      process.env.CORS_WHITELIST = originalWhitelist;
    }
  });

  await t.test('should not crash with 500 when request comes from unknown origin', async () => {
    const res = await request(app)
      .get('/')
      .set('Host', 'myserver.com')
      .set('Origin', 'https://untrusted-attacker.com');

    // Should not be 500 internal server error
    assert.notStrictEqual(res.status, 500);
    // Should NOT have access-control-allow-origin header for attacker
    assert.strictEqual(res.headers['access-control-allow-origin'], undefined);
  });
});
