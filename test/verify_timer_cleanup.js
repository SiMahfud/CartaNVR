const { startFFmpegForCamera, stopFFmpegForCamera } = require('../lib/ffmpeg-manager.js');
const { spawn } = require('child_process');

console.log('[TEST] Starting Timer Cleanup Test...');

// Mock camera object
const mockCamera = {
    id: 999,
    name: 'Test Cam',
    rtsp_url: 'rtsp://127.0.0.1:9554/stream', // Likely unreachable
    storage_path: 'f:\\nvr\\test_out',
    is_hevc: false
};

// Start the camera
console.log('[TEST] Starting camera (expecting failure and retry schedule)...');
startFFmpegForCamera(mockCamera, () => { });

// Wait for a bit to let it fail and schedule a retry/monitor
setTimeout(async () => {
    console.log('[TEST] Stopping camera now...');
    await stopFFmpegForCamera(mockCamera.id);

    console.log('[TEST] Camera stopped. Waiting to see if it restarts (it SHOULD NOT)...');

    // Convert console.log to trap "Starting for cam" messages
    const originalLog = console.log;
    let restarted = false;
    console.log = (...args) => {
        originalLog(...args);
        if (args[0] && typeof args[0] === 'string' && (args[0].includes('[FFMPEG] Starting') || args[0].includes('[MONITOR] Checking'))) {
            restarted = true;
        }
    };

    setTimeout(() => {
        console.log = originalLog; // Restore
        if (restarted) {
            console.error('[TEST] FAILURE: Camera restarted after being stopped!');
            process.exit(1);
        } else {
            console.log('[TEST] SUCCESS: Camera remained silent.');
            process.exit(0);
        }
    }, 5000); // Wait 5 seconds to ensure no queued timers fire

}, 3000);
