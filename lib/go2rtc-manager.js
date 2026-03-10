'use strict';

/**
 * go2rtc-manager.js
 *
 * Manages the go2rtc process lifecycle:
 * - Spawns go2rtc binary from go2rtc-static package
 * - Generates YAML config dynamically
 * - Registers/removes camera streams via go2rtc HTTP API
 * - Auto-restarts on crash with exponential backoff
 * - Graceful shutdown
 */

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const http = require('http');
const ffmpegStatic = require('ffmpeg-static');

const {
    GO2RTC_API_PORT,
    GO2RTC_WEBRTC_PORT,
    GO2RTC_ENABLED,
    BASE_DIR,
} = require('./config');

const logger = require('./logger');

// Resolve go2rtc binary path
let go2rtcBin;
try {
    go2rtcBin = require('go2rtc-static');
} catch {
    go2rtcBin = null;
}

// State
let proc = null;
let configPath = null;
let restartTimer = null;
let retries = 0;
let manualStop = false;

const MAX_RETRIES = 10;
const BASE_BACKOFF_MS = 2000;
const MAX_BACKOFF_MS = 60 * 1000;

/**
 * Generate go2rtc YAML config file
 * @returns {string} Path to generated config file
 */
function generateConfig() {
    const configDir = path.join(BASE_DIR, '.go2rtc');
    fs.mkdirSync(configDir, { recursive: true });

    const yamlContent = [
        'api:',
        `  listen: "127.0.0.1:${GO2RTC_API_PORT}"`,
        '',
        'rtsp:',
        '  listen: "127.0.0.1:8554"',  // go2rtc's ffmpeg module requires its internal RTSP server to be enabled
        '',
        'webrtc:',
        `  listen: ":${GO2RTC_WEBRTC_PORT}"`,
        '  candidates:',
        '    - stun:stun.l.google.com:19302',
        '    - stun:8.8.8.8:53',
        '',
        'log:',
        '  level: "info"',
        '',
    ].join('\n');

    const cfgPath = path.join(configDir, 'go2rtc.yaml');
    fs.writeFileSync(cfgPath, yamlContent, 'utf-8');
    return cfgPath;
}

/**
 * Make an HTTP request to go2rtc API
 */
function apiRequest(method, apiPath, body) {
    return new Promise((resolve, reject) => {
        const options = {
            hostname: '127.0.0.1',
            port: GO2RTC_API_PORT,
            path: apiPath,
            method,
            headers: {},
            timeout: 5000,
        };

        if (body) {
            const bodyStr = typeof body === 'string' ? body : JSON.stringify(body);
            options.headers['Content-Type'] = typeof body === 'string' ? 'text/plain' : 'application/json';
            options.headers['Content-Length'] = Buffer.byteLength(bodyStr);
        }

        const req = http.request(options, (res) => {
            let data = '';
            res.on('data', (chunk) => { data += chunk; });
            res.on('end', () => {
                if (res.statusCode >= 200 && res.statusCode < 300) {
                    try {
                        resolve(data ? JSON.parse(data) : null);
                    } catch {
                        resolve(data);
                    }
                } else {
                    reject(new Error(`go2rtc API ${method} ${apiPath} returned ${res.statusCode}: ${data}`));
                }
            });
        });

        req.on('timeout', () => {
            req.destroy();
            reject(new Error(`go2rtc API ${method} ${apiPath} timed out`));
        });

        req.on('error', reject);

        if (body) {
            req.write(typeof body === 'string' ? body : JSON.stringify(body));
        }
        req.end();
    });
}

/**
 * Wait for go2rtc API to be ready
 */
async function waitForReady(maxWaitMs = 10000) {
    const start = Date.now();
    while (Date.now() - start < maxWaitMs) {
        try {
            await apiRequest('GET', '/api/streams');
            return true;
        } catch {
            await new Promise(r => setTimeout(r, 500));
        }
    }
    return false;
}

/**
 * Start go2rtc process
 */
async function start() {
    if (!GO2RTC_ENABLED) {
        logger.log('general', '[GO2RTC] Disabled via config. Skipping.');
        return false;
    }

    if (!go2rtcBin) {
        logger.log('general', '[GO2RTC] go2rtc-static package not found. go2rtc streaming disabled.');
        return false;
    }

    if (proc) {
        logger.log('general', '[GO2RTC] Already running. Skipping start.');
        return true;
    }

    manualStop = false;
    retries = 0;

    return spawnProcess();
}

/**
 * Internal: spawn the go2rtc process
 */
async function spawnProcess() {
    if (manualStop) return false;

    configPath = generateConfig();

    logger.log('general', `[GO2RTC] Starting process (attempt ${retries + 1})...`);
    logger.log('general', `[GO2RTC] Binary: ${go2rtcBin}`);
    logger.log('general', `[GO2RTC] Config: ${configPath}`);

    try {
        proc = spawn(go2rtcBin, ['-config', configPath], {
            env: { ...process.env, PATH: `${path.dirname(ffmpegStatic)}${path.delimiter}${process.env.PATH}` },
            stdio: ['ignore', 'pipe', 'pipe'],
            windowsHide: true,
        });
    } catch (err) {
        logger.log('general', `[GO2RTC] Failed to spawn process: ${err.message}`);
        proc = null;
        return false;
    }

    proc.stdout.on('data', (data) => {
        const line = data.toString().trim();
        if (line) logger.log('general', `[GO2RTC] ${line}`);
    });

    proc.stderr.on('data', (data) => {
        const line = data.toString().trim();
        if (line) logger.log('general', `[GO2RTC] ERR: ${line}`);
    });

    proc.on('close', (code, signal) => {
        proc = null;

        if (manualStop) {
            logger.log('general', '[GO2RTC] Process stopped manually.');
            return;
        }

        logger.log('general', `[GO2RTC] Process exited (code=${code}, signal=${signal}).`);
        retries += 1;

        if (retries >= MAX_RETRIES) {
            logger.log('general', `[GO2RTC] Max retries (${MAX_RETRIES}) reached. Giving up.`);
            return;
        }

        const delay = Math.min(BASE_BACKOFF_MS * Math.pow(1.5, retries - 1), MAX_BACKOFF_MS);
        logger.log('general', `[GO2RTC] Restarting in ${(delay / 1000).toFixed(1)}s...`);
        restartTimer = setTimeout(() => spawnProcess(), delay);
    });

    // Wait for API to be ready
    const ready = await waitForReady(8000);
    if (ready) {
        logger.log('general', `[GO2RTC] Process started. API ready on http://127.0.0.1:${GO2RTC_API_PORT}`);
        retries = 0;
        return true;
    } else {
        logger.log('general', '[GO2RTC] Process started but API not responding. Will retry on next camera registration.');
        return true; // Process is running, API might come up later
    }
}

/**
 * Stop go2rtc process gracefully
 */
async function stop() {
    manualStop = true;

    if (restartTimer) {
        clearTimeout(restartTimer);
        restartTimer = null;
    }

    if (!proc) {
        return;
    }

    logger.log('general', '[GO2RTC] Stopping process...');

    return new Promise((resolve) => {
        let done = false;

        const timeout = setTimeout(() => {
            if (done) return;
            logger.log('general', '[GO2RTC] Force killing process...');
            try { proc.kill('SIGKILL'); } catch { /* ignore */ }
            proc = null;
            done = true;
            resolve();
        }, 5000);

        proc.once('close', () => {
            if (!done) {
                clearTimeout(timeout);
                done = true;
                resolve();
            }
        });

        try { proc.kill('SIGTERM'); } catch { /* ignore */ }
    });
}

/**
 * Register a camera stream with go2rtc
 * @param {string|number} camId Camera ID
 * @param {string} rtspUrl RTSP URL of the camera
 * @param {boolean} hasAudio Whether the camera has an audio stream that should be preserved/transcoded
 */
async function addStream(camId, rtspUrl, hasAudio = false) {
    const streamName = `cam_${camId}`;
    try {
        let finalUrl = rtspUrl;
        if (hasAudio) {
            // go2rtc natively drops non-AAC audio for MSE clients, or passes unsupported codecs.
            // Using `ffmpeg:rtsp://...?video=copy&audio=aac` directs go2rtc to spawn ffmpeg dynamically
            // for clients that request streams (like MSE).
            finalUrl = `ffmpeg:${rtspUrl}#video=copy#audio=aac`;
        }

        await apiRequest('PUT', `/api/streams?name=${encodeURIComponent(streamName)}&src=${encodeURIComponent(finalUrl)}`);
        logger.log('general', `[GO2RTC] Stream registered: ${streamName}`);
        return true;
    } catch (err) {
        logger.log('general', `[GO2RTC] Failed to register stream ${streamName}: ${err.message}`);
        return false;
    }
}

/**
 * Remove a camera stream from go2rtc
 * @param {string|number} camId Camera ID
 */
async function removeStream(camId) {
    const streamName = `cam_${camId}`;
    try {
        await apiRequest('DELETE', `/api/streams?name=${encodeURIComponent(streamName)}`);
        logger.log('general', `[GO2RTC] Stream removed: ${streamName}`);
        return true;
    } catch (err) {
        logger.log('general', `[GO2RTC] Failed to remove stream ${streamName}: ${err.message}`);
        return false;
    }
}

/**
 * Get all currently registered streams from go2rtc
 * @returns {Object} Map of stream names to stream info
 */
async function getStreams() {
    return apiRequest('GET', '/api/streams');
}

/**
 * Check if go2rtc is running
 */
function isRunning() {
    return proc !== null;
}

/**
 * Get the API port for proxy routing
 */
function getApiPort() {
    return GO2RTC_API_PORT;
}

module.exports = {
    start,
    stop,
    addStream,
    removeStream,
    getStreams,
    isRunning,
    getApiPort,
};
