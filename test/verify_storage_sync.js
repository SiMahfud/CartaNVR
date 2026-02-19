const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const database = require('../lib/database');
const { syncExistingFilesOnce } = require('../lib/storage');

async function testStorageSync() {
    console.log('[TEST] Starting Storage Sync & Quarantine Test...');

    await database.init();

    const testDir = path.join(__dirname, 'test_storage_sync');

    // Mock storage and camera in DB
    await database.runUpdate('DELETE FROM storages WHERE name = ?', ['Sync Test Storage']);
    const storage = await database.addStorage({
        name: 'Sync Test Storage',
        path: testDir,
        max_gb: 1
    });

    await database.runUpdate('DELETE FROM cameras WHERE name = ?', ['Sync Test Cam']);
    const addedCam = await database.addCamera({
        name: 'Sync Test Cam',
        ip_address: '127.0.0.1',
        rtsp_url: 'rtsp://127.0.0.1/test',
        storage_id: storage.id,
        is_hevc: 0,
        enabled: 1
    });
    const camId = addedCam.id;
    const camDir = path.join(testDir, `cam_${camId}`);
    if (!fs.existsSync(camDir)) fs.mkdirSync(camDir, { recursive: true });

    const corruptFile = path.join(camDir, '2026-02-19_12-00-00.mp4');
    await fsp.writeFile(corruptFile, 'this is not a valid mp4 file');

    const validFile = path.join(camDir, '2026-02-19_12-05-00.mp4');
    // We need a real-ish MP4 or a file that ffprobe can handle, 
    // but for testing the "fail" case, we'll just check if it moves to corrupt.

    console.log(`[TEST] Running syncExistingFilesOnce for cam ${camId}...`);
    const start = Date.now();
    await syncExistingFilesOnce(camId);
    const end = Date.now();
    console.log(`[TEST] Sync finished in ${end - start}ms`);

    // Check if corrupt file was moved
    const quarantinedPath = path.join(camDir, 'corrupt', '2026-02-19_12-00-00.mp4');
    if (fs.existsSync(quarantinedPath)) {
        console.log('[TEST] SUCCESS: Corrupt file was quarantined.');
    } else {
        console.error('[TEST] FAILURE: Corrupt file was not quarantined!');
        // List directory to see what happened
        const files = await fsp.readdir(camDir);
        console.log('[TEST] Files in camDir:', files);
        process.exit(1);
    }

    // Cleanup
    await fsp.rm(testDir, { recursive: true, force: true });
    await database.runUpdate('DELETE FROM cameras WHERE id = 998');
    console.log('[TEST] Cleanup complete.');
    process.exit(0);
}

testStorageSync().catch(err => {
    console.error('[TEST] Error:', err);
    process.exit(1);
});
