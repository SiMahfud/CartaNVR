'use strict';

/**
 * port-utils.js
 * 
 * Utilities to detect and kill processes holding a specific port
 * before the server attempts to listen. Prevents EADDRINUSE crash loops
 * on Windows when PM2 restarts leave zombie processes behind.
 */

const { execSync } = require('child_process');

/**
 * Find PID(s) listening on a given port.
 * @param {number} port
 * @returns {number[]} Array of PIDs using the port
 */
function findPidsOnPort(port) {
    const pids = new Set();
    const myPid = process.pid;
    try {
        // Windows: netstat -ano | findstr :PORT
        const cmd = process.platform === 'win32'
            ? `netstat -ano | findstr ":${port} "`
            : `lsof -ti :${port}`;

        const output = execSync(cmd, { encoding: 'utf-8', timeout: 5000 });

        if (process.platform === 'win32') {
            // Parse netstat output lines like:
            //   TCP    0.0.0.0:3000   0.0.0.0:0   LISTENING   12345
            const lines = output.trim().split('\n');
            for (const line of lines) {
                if (/LISTENING/i.test(line)) {
                    const parts = line.trim().split(/\s+/);
                    const pid = parseInt(parts[parts.length - 1], 10);
                    if (pid && pid !== myPid && pid !== 0) {
                        pids.add(pid);
                    }
                }
            }
        } else {
            // Unix: lsof returns PIDs one per line
            const lines = output.trim().split('\n');
            for (const line of lines) {
                const pid = parseInt(line.trim(), 10);
                if (pid && pid !== myPid && pid !== 0) {
                    pids.add(pid);
                }
            }
        }
    } catch {
        // Command failed = no process on that port, or access denied
    }
    return Array.from(pids);
}

/**
 * Kill a process by PID. Returns true if successfully killed.
 * @param {number} pid
 * @returns {boolean}
 */
function killPid(pid) {
    try {
        if (process.platform === 'win32') {
            execSync(`taskkill /F /PID ${pid}`, { timeout: 5000 });
        } else {
            process.kill(pid, 'SIGKILL');
        }
        return true;
    } catch {
        return false;
    }
}

/**
 * Free a port by killing any process using it (except ourselves).
 * Waits briefly after killing for the port to be released.
 * @param {number} port
 * @param {string} [label] Label for logging
 * @returns {Promise<boolean>} true if port is now free
 */
async function freePort(port, label = '') {
    const prefix = label ? `[${label}]` : '[PORT-UTILS]';
    const pids = findPidsOnPort(port);

    if (pids.length === 0) {
        return true; // Port is already free
    }

    console.log(`${prefix} Port ${port} is held by PID(s): ${pids.join(', ')}. Attempting to free...`);

    let killed = 0;
    for (const pid of pids) {
        if (killPid(pid)) {
            console.log(`${prefix} Killed PID ${pid}`);
            killed++;
        } else {
            console.error(`${prefix} Failed to kill PID ${pid}`);
        }
    }

    if (killed > 0) {
        // Wait for OS to fully release the port
        await new Promise(resolve => setTimeout(resolve, 1500));
    }

    // Verify the port is now free
    const remainingPids = findPidsOnPort(port);
    if (remainingPids.length === 0) {
        console.log(`${prefix} Port ${port} is now free.`);
        return true;
    } else {
        console.error(`${prefix} Port ${port} still in use by PID(s): ${remainingPids.join(', ')}`);
        return false;
    }
}

/**
 * Try to listen on a port with retry + auto-free logic.
 * If EADDRINUSE, tries to kill the blocking process and retry.
 * Gives up after maxRetries and calls process.exit(1) so PM2 can handle it cleanly.
 * 
 * @param {import('http').Server|import('net').Server} server
 * @param {number} port 
 * @param {object} [options]
 * @param {string} [options.host] Host to bind to
 * @param {string} [options.label] Label for logging
 * @param {number} [options.maxRetries] Max retry attempts (default: 3)
 * @param {number} [options.retryDelayMs] Delay between retries (default: 2000)
 * @param {Function} [options.onListening] Callback when listening succeeds
 * @returns {Promise<boolean>}
 */
async function listenWithRetry(server, port, options = {}) {
    const {
        host,
        label = 'SERVER',
        maxRetries = 3,
        retryDelayMs = 2000,
        onListening,
    } = options;

    const prefix = `[${label}]`;

    for (let attempt = 1; attempt <= maxRetries + 1; attempt++) {
        // Before each attempt, check and free the port
        const freed = await freePort(port, label);
        if (!freed && attempt > 1) {
            console.error(`${prefix} Could not free port ${port} on attempt ${attempt}.`);
        }

        try {
            await new Promise((resolve, reject) => {
                const onError = (err) => {
                    server.removeListener('listening', onSuccess);
                    reject(err);
                };
                const onSuccess = () => {
                    server.removeListener('error', onError);
                    resolve();
                };

                server.once('error', onError);
                server.once('listening', onSuccess);

                if (host) {
                    server.listen(port, host);
                } else {
                    server.listen(port);
                }
            });

            // Success!
            console.log(`${prefix} Listening on port ${port}`);
            if (onListening) onListening();
            return true;

        } catch (err) {
            if (err.code === 'EADDRINUSE') {
                if (attempt <= maxRetries) {
                    console.error(`${prefix} Port ${port} still in use. Retry ${attempt}/${maxRetries} in ${retryDelayMs}ms...`);
                    // Make sure the server is closed before retrying
                    try { server.close(); } catch { /* ignore */ }
                    await new Promise(r => setTimeout(r, retryDelayMs));
                } else {
                    console.error(`${prefix} Port ${port} in use after ${maxRetries} retries. Exiting to let PM2 handle restart.`);
                    process.exit(1);
                }
            } else {
                // Non-port-conflict error, throw immediately
                throw err;
            }
        }
    }

    return false;
}

module.exports = { findPidsOnPort, killPid, freePort, listenWithRetry };
