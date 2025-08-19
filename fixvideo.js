// fix_videos.js

const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');

const recordingsDir = path.join(__dirname, 'recordings');

// Fungsi untuk mencari semua file .mp4 secara rekursif
function findMp4Files(dir) {
    let results = [];
    const list = fs.readdirSync(dir);
    list.forEach(file => {
        const filePath = path.join(dir, file);
        const stat = fs.statSync(filePath);
        if (stat && stat.isDirectory()) {
            results = results.concat(findMp4Files(filePath));
        } else if (path.extname(filePath) === '.mp4') {
            results.push(filePath);
        }
    });
    return results;
}

// Fungsi untuk memproses satu file
function processFile(filePath) {
    return new Promise((resolve, reject) => {
        console.log(`Processing: ${filePath}`);
        const tempPath = filePath.replace('.mp4', '.temp.mp4');
        
        // Perintah FFmpeg untuk menyalin stream dan menambahkan faststart
        const command = `ffmpeg -i "${filePath}" -c copy -movflags +faststart "${tempPath}"`;

        exec(command, (error, stdout, stderr) => {
            if (error) {
                console.error(`Error processing ${filePath}:`, stderr);
                return reject(error);
            }

            // Ganti file asli dengan file yang sudah diproses
            fs.unlinkSync(filePath); // Hapus file asli
            fs.renameSync(tempPath, filePath); // Ganti nama file temp
            
            console.log(`Successfully fixed: ${filePath}`);
            resolve();
        });
    });
}

async function run() {
    console.log("Starting video fix process...");
    const allFiles = findMp4Files(recordingsDir);
    console.log(`Found ${allFiles.length} MP4 files to process.`);

    // Proses file satu per satu untuk menghindari beban server yang berlebihan
    for (const file of allFiles) {
        try {
            await processFile(file);
        } catch (e) {
            console.error(`Failed to process ${file}. Skipping.`);
        }
    }

    console.log("All files have been processed.");
}

run();