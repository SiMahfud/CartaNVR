'use strict';

/**
 * start.js — Helper CLI untuk menjalankan NVR dengan PM2
 * 
 * Usage:
 *   node start.js              → Start NVR (atau restart jika sudah jalan)
 *   node start.js stop         → Stop NVR
 *   node start.js restart      → Restart NVR
 *   node start.js logs         → Lihat logs (follow mode)
 *   node start.js status       → Cek status NVR
 *   node start.js delete       → Hapus NVR dari PM2
 * 
 * Script ini otomatis:
 *   1. Membersihkan port yang masih ditahan proses zombie
 *   2. Menghentikan instance PM2 lama jika ada
 *   3. Memulai NVR dengan ecosystem.config.js
 */

const { execSync, spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

// Baca .env manual untuk mendapatkan port config
const dotenvPath = path.join(__dirname, '.env');
const envConfig = {};
try {
    const envContent = fs.readFileSync(dotenvPath, 'utf-8');
    for (const line of envContent.split('\n')) {
        const trimmed = line.trim();
        if (trimmed && !trimmed.startsWith('#')) {
            const eqIdx = trimmed.indexOf('=');
            if (eqIdx > 0) {
                envConfig[trimmed.slice(0, eqIdx).trim()] = trimmed.slice(eqIdx + 1).trim();
            }
        }
    }
} catch { /* .env tidak ada, pakai defaults */ }

const APP_NAME = 'nvr';
const CWD = __dirname;

// Port-port yang dipakai NVR
const PORTS = [
    parseInt(process.env.PORT || '3000', 10),                         // Express server
    9999,                                                              // Stream Relay
    parseInt(envConfig.GO2RTC_API_PORT || '1984', 10),                // go2rtc API
    parseInt(envConfig.GO2RTC_WEBRTC_PORT || '8555', 10),             // go2rtc WebRTC
    parseInt(envConfig.GO2RTC_RTSP_PORT || '8554', 10),               // go2rtc RTSP
];

// ─── Utilities ───────────────────────────────────────────────────────

function log(msg) {
    const ts = new Date().toLocaleTimeString('id-ID');
    console.log(`[${ts}] ${msg}`);
}

function logOk(msg)   { console.log(`  ✅ ${msg}`); }
function logWarn(msg)  { console.log(`  ⚠️  ${msg}`); }
function logErr(msg)   { console.error(`  ❌ ${msg}`); }
function logInfo(msg)  { console.log(`  ℹ️  ${msg}`); }

function exec(cmd, opts = {}) {
    try {
        return execSync(cmd, {
            encoding: 'utf-8',
            timeout: 10000,
            windowsHide: true,
            stdio: 'pipe',
            ...opts,
        }).trim();
    } catch {
        return '';
    }
}

function isProcessRunning(name) {
    const output = exec(`pm2 describe ${name}`);
    return output && !output.includes('doesn\'t exist');
}

function getProcessStatus(name) {
    try {
        const output = exec(`pm2 jlist`);
        if (!output) return null;
        const list = JSON.parse(output);
        return list.find(p => p.name === name) || null;
    } catch {
        return null;
    }
}

/**
 * Mencari dan membunuh proses yang menahan port (kecuali PID kita sendiri)
 */
function killProcessOnPort(port) {
    const myPid = process.pid;
    
    if (process.platform !== 'win32') {
        const pids = exec(`lsof -ti :${port}`);
        if (pids) {
            for (const pid of pids.split('\n').map(p => parseInt(p.trim(), 10)).filter(p => p && p !== myPid)) {
                try { process.kill(pid, 'SIGKILL'); } catch { /* ignore */ }
            }
        }
        return;
    }

    // Windows: parse netstat
    const output = exec(`netstat -ano | findstr ":${port} "`);
    if (!output) return;

    const pids = new Set();
    for (const line of output.split('\n')) {
        if (/LISTENING/i.test(line)) {
            const parts = line.trim().split(/\s+/);
            const pid = parseInt(parts[parts.length - 1], 10);
            if (pid && pid !== myPid && pid !== 0 && pid !== 4) {
                pids.add(pid);
            }
        }
    }

    for (const pid of pids) {
        try {
            execSync(`taskkill /F /PID ${pid}`, { timeout: 5000, windowsHide: true, stdio: 'pipe' });
            logInfo(`Killed PID ${pid} (port ${port})`);
        } catch { /* gagal kill, mungkin sudah mati */ }
    }
}

/**
 * Bersihkan semua port yang dipakai NVR
 */
function cleanupPorts() {
    log('Membersihkan port yang masih ditahan...');
    let cleaned = 0;
    for (const port of PORTS) {
        const beforePids = exec(
            process.platform === 'win32'
                ? `netstat -ano | findstr ":${port} " | findstr LISTENING`
                : `lsof -ti :${port}`
        );
        if (beforePids) {
            killProcessOnPort(port);
            cleaned++;
        }
    }
    if (cleaned === 0) {
        logOk('Semua port sudah bersih.');
    } else {
        logOk(`${cleaned} port dibersihkan.`);
    }
}

// ─── Commands ────────────────────────────────────────────────────────

async function cmdStart() {
    console.log('');
    console.log('╔══════════════════════════════════════╗');
    console.log('║        CartaNVR — PM2 Launcher       ║');
    console.log('╚══════════════════════════════════════╝');
    console.log('');

    // 1. Cek apakah PM2 tersedia
    const pm2Version = exec('pm2 --version');
    if (!pm2Version) {
        logErr('PM2 tidak ditemukan! Install dulu: npm install -g pm2');
        process.exit(1);
    }
    logOk(`PM2 v${pm2Version} ditemukan.`);

    // 2. Buat folder logs jika belum ada
    const logsDir = path.join(CWD, 'logs');
    if (!fs.existsSync(logsDir)) {
        fs.mkdirSync(logsDir, { recursive: true });
        logInfo('Folder logs dibuat.');
    }

    // 3. Cek apakah NVR sudah jalan di PM2
    const status = getProcessStatus(APP_NAME);
    if (status) {
        log(`NVR sudah terdaftar di PM2 (status: ${status.pm2_env?.status || 'unknown'})`);
        log('Menghentikan instance lama...');
        exec(`pm2 stop ${APP_NAME}`);
        
        // Tunggu sebentar agar graceful shutdown selesai
        await sleep(3000);
        
        exec(`pm2 delete ${APP_NAME}`);
        logOk('Instance lama dihapus.');
    }

    // 4. Bersihkan port zombie
    cleanupPorts();

    // Tunggu sebentar agar OS release port
    await sleep(2000);

    // 5. Start dengan ecosystem config
    log('Memulai NVR...');
    const ecosystemFile = path.join(CWD, 'ecosystem.config.js');
    
    if (!fs.existsSync(ecosystemFile)) {
        logErr('ecosystem.config.js tidak ditemukan!');
        process.exit(1);
    }

    const result = exec(`pm2 start "${ecosystemFile}"`, { cwd: CWD });
    if (result) {
        console.log(result);
    }

    // 6. Verifikasi
    await sleep(3000);
    const newStatus = getProcessStatus(APP_NAME);
    
    if (newStatus && newStatus.pm2_env?.status === 'online') {
        console.log('');
        logOk('NVR berhasil dijalankan! 🎉');
        console.log('');
        console.log('  📋 Perintah berguna:');
        console.log('     pm2 logs nvr          → Lihat logs');
        console.log('     pm2 restart nvr       → Restart');
        console.log('     pm2 stop nvr          → Stop');
        console.log('     pm2 monit             → Monitor realtime');
        console.log('     node start.js status   → Cek status');
        console.log('');
    } else {
        logWarn('NVR mungkin belum sepenuhnya jalan. Cek dengan: pm2 logs nvr');
    }

    // 7. Auto-save PM2 state
    exec('pm2 save');
    logInfo('PM2 state tersimpan (auto-start saat boot).');
}

function cmdStop() {
    log('Menghentikan NVR...');
    
    if (!isProcessRunning(APP_NAME)) {
        logWarn('NVR tidak sedang jalan di PM2.');
        cleanupPorts(); // Tetap bersihkan port zombie
        return;
    }

    exec(`pm2 stop ${APP_NAME}`);
    logOk('NVR dihentikan.');

    // Bersihkan port zombie setelah stop
    setTimeout(() => {
        cleanupPorts();
        exec('pm2 save');
    }, 3000);
}

function cmdRestart() {
    log('Restart NVR...');

    if (!isProcessRunning(APP_NAME)) {
        logWarn('NVR belum terdaftar di PM2. Menjalankan start...');
        cmdStart();
        return;
    }

    // Stop dulu, bersihkan port, lalu start
    exec(`pm2 stop ${APP_NAME}`);
    logInfo('Menunggu proses berhenti...');

    setTimeout(() => {
        cleanupPorts();
        setTimeout(() => {
            exec(`pm2 restart ${APP_NAME}`);
            logOk('NVR di-restart.');
            exec('pm2 save');
        }, 2000);
    }, 3000);
}

function cmdLogs() {
    log('Menampilkan logs NVR (Ctrl+C untuk keluar)...');
    console.log('');
    
    const child = spawn('pm2', ['logs', APP_NAME, '--lines', '50'], {
        cwd: CWD,
        stdio: 'inherit',
        shell: true,
    });

    child.on('error', (err) => {
        logErr(`Gagal menampilkan logs: ${err.message}`);
    });
}

function cmdStatus() {
    const status = getProcessStatus(APP_NAME);
    
    if (!status) {
        logWarn('NVR tidak terdaftar di PM2.');
        return;
    }

    const env = status.pm2_env || {};
    const mem = status.monit?.memory 
        ? `${(status.monit.memory / 1024 / 1024).toFixed(1)} MB` 
        : 'N/A';

    console.log('');
    console.log('╔══════════════════════════════════════╗');
    console.log('║          CartaNVR — Status            ║');
    console.log('╚══════════════════════════════════════╝');
    console.log('');
    console.log(`  📌 Nama         : ${status.name}`);
    console.log(`  🔄 Status       : ${env.status || 'unknown'}`);
    console.log(`  🆔 PID          : ${status.pid || 'N/A'}`);
    console.log(`  💾 Memory       : ${mem}`);
    console.log(`  🔁 Restarts     : ${env.restart_time || 0}`);
    console.log(`  ⏱️  Uptime       : ${env.pm_uptime ? formatUptime(Date.now() - env.pm_uptime) : 'N/A'}`);
    console.log(`  📂 CWD          : ${env.pm_cwd || CWD}`);
    console.log('');
    console.log('  🌐 Port Info:');
    for (const port of PORTS) {
        const inUse = exec(
            process.platform === 'win32'
                ? `netstat -ano | findstr ":${port} " | findstr LISTENING`
                : `lsof -ti :${port}`
        );
        const status = inUse ? '🟢 In Use' : '⚫ Free';
        console.log(`     Port ${port}: ${status}`);
    }
    console.log('');
}

function cmdDelete() {
    log('Menghapus NVR dari PM2...');
    exec(`pm2 stop ${APP_NAME}`);
    
    setTimeout(() => {
        cleanupPorts();
        exec(`pm2 delete ${APP_NAME}`);
        exec('pm2 save');
        logOk('NVR dihapus dari PM2.');
    }, 3000);
}

// ─── Helpers ─────────────────────────────────────────────────────────

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

function formatUptime(ms) {
    const seconds = Math.floor(ms / 1000);
    const days = Math.floor(seconds / 86400);
    const hours = Math.floor((seconds % 86400) / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    
    const parts = [];
    if (days > 0) parts.push(`${days}d`);
    if (hours > 0) parts.push(`${hours}h`);
    if (minutes > 0) parts.push(`${minutes}m`);
    if (parts.length === 0) parts.push(`${seconds}s`);
    
    return parts.join(' ');
}

// ─── Main ────────────────────────────────────────────────────────────

const command = (process.argv[2] || 'start').toLowerCase();

const commands = {
    start: cmdStart,
    stop: cmdStop,
    restart: cmdRestart,
    logs: cmdLogs,
    log: cmdLogs,
    status: cmdStatus,
    info: cmdStatus,
    delete: cmdDelete,
    remove: cmdDelete,
};

if (commands[command]) {
    Promise.resolve(commands[command]()).catch(err => {
        logErr(`Error: ${err.message}`);
        process.exit(1);
    });
} else {
    console.log('');
    console.log('CartaNVR — PM2 Helper');
    console.log('');
    console.log('Usage: node start.js [command]');
    console.log('');
    console.log('Commands:');
    console.log('  start     Jalankan NVR (default)');
    console.log('  stop      Hentikan NVR');
    console.log('  restart   Restart NVR');
    console.log('  logs      Lihat logs (realtime)');
    console.log('  status    Cek status NVR');
    console.log('  delete    Hapus NVR dari PM2');
    console.log('');
    process.exit(1);
}
