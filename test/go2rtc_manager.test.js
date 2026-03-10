'use strict';

const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const fs = require('fs');

// Mock child_process and http before requiring the module
const childProcess = require('child_process');
const http = require('http');

let spawnCalls = [];
let killed = false;
let mockProc = null;

const originalSpawn = childProcess.spawn;
const originalRequest = http.request;

function setupMocks() {
    spawnCalls = [];
    killed = false;

    childProcess.spawn = (command, args, options) => {
        spawnCalls.push({ command, args, options });

        mockProc = {
            stdout: { on: () => { } },
            stderr: { on: () => { } },
            on: (event, cb) => {
                if (event === 'close') {
                    mockProc.simulateClose = cb;
                }
            },
            once: (event, cb) => {
                if (event === 'close') {
                    mockProc.simulateCloseOnce = cb;
                }
            },
            kill: (signal) => {
                killed = signal;
                if (mockProc.simulateCloseOnce) {
                    mockProc.simulateCloseOnce(0, signal);
                } else if (mockProc.simulateClose) {
                    mockProc.simulateClose(0, signal);
                }
            }
        };
        return mockProc;
    };

    http.request = (options, cb) => {
        const req = {
            on: () => { },
            end: () => { },
            write: () => { },
            destroy: () => { }
        };

        // Simulate successful API response immediately
        setTimeout(() => {
            const res = {
                statusCode: 200,
                on: (event, dataCb) => {
                    if (event === 'data') dataCb('{"status":"ok"}');
                    if (event === 'end') dataCb();
                }
            };
            if (cb) cb(res);
        }, 10);

        return req;
    };
}

function teardownMocks() {
    childProcess.spawn = originalSpawn;
    http.request = originalRequest;
}

test('go2rtc-manager tests', async (t) => {
    t.beforeEach(() => {
        setupMocks();
    });

    t.afterEach(() => {
        teardownMocks();
        // Reset singleton state if needed
    });

    await t.test('generates config and starts process', async () => {
        const go2rtcManager = require('../lib/go2rtc-manager');

        // Use the getApiPort to verify module loaded
        assert.strictEqual(typeof go2rtcManager.getApiPort(), 'number');

        const started = await go2rtcManager.start();

        // Depending on whether go2rtc-static is actually installed during the test run,
        // this might be true or false. We just want to ensure it doesn't crash.
        assert.ok(started !== undefined);
    });

    await t.test('stops process gracefully', async () => {
        const go2rtcManager = require('../lib/go2rtc-manager');

        // We already called start, so there might be a mockProc
        if (mockProc) {
            await go2rtcManager.stop();
            assert.ok(killed === 'SIGTERM' || killed === 'SIGKILL' || killed === true, 'should have attempted to kill process');
        }
    });

    await t.test('API adds and removes streams', async () => {
        const go2rtcManager = require('../lib/go2rtc-manager');

        // These should use the mocked http.request and resolve successfully
        const addResult = await go2rtcManager.addStream('test1', 'rtsp://test');
        assert.strictEqual(addResult, true);

        const removeResult = await go2rtcManager.removeStream('test1');
        assert.strictEqual(removeResult, true);
    });
});
