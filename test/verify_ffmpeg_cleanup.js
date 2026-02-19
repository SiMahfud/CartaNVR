const { stopAllPostProcessing, _test_addProcess } = require('../lib/post-processor.js');
const { spawn } = require('child_process');
const assert = require('assert');

console.log('[TEST] Starting FFmpeg Cleanup Test...');

// 1. Spawn a dummy process that runs for a while
// Using 'ping' on Windows or 'sleep' on Linux
const cmd = process.platform === 'win32'
    ? 'ping'
    : 'sleep';

const args = process.platform === 'win32'
    ? ['-n', '10', '127.0.0.1']
    : ['10'];

const dummyProc = spawn(cmd, args);

console.log(`[TEST] Spawned dummy process PID: ${dummyProc.pid}`);

// 2. Add it to potentially tracked processes via our test helper
_test_addProcess(dummyProc);

// 3. Verify it is running
if (dummyProc.killed || dummyProc.exitCode !== null) {
    console.error('[TEST] Pre-check failed: Process is not running!');
    process.exit(1);
}

// 4. Call stopAllPostProcessing
console.log('[TEST] Calling stopAllPostProcessing()...');
stopAllPostProcessing();

// 5. Check if process is killed
// We might need to wait a tiny bit for the OS to reflect the kill
setTimeout(() => {
    if (dummyProc.killed) {
        console.log('[TEST] SUCCESS: Process was killed.');
        process.exit(0);
    } else {
        // Sometimes .killed is false even if it was sent a signal, let's check exitCode
        if (dummyProc.exitCode !== null || dummyProc.signalCode !== null) {
            console.log(`[TEST] SUCCESS: Process exited with code ${dummyProc.exitCode} / signal ${dummyProc.signalCode}`);
            process.exit(0);
        } else {
            console.error('[TEST] FAILURE: Process is still running!');
            // Force kill to clean up
            dummyProc.kill('SIGKILL');
            process.exit(1);
        }
    }
}, 1000);
