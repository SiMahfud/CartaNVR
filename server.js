// server.js (cuplikan yang perlu ditambah/ubah)
const express = require('express');
const http = require('http');
const path = require('path');
// const { spawn } = require('child_process'); // tetap dipakai utk fitur lain jika perlu
const database = require('./lib/database');
const onvifScanner = require('./lib/onvif-scanner');
const fs = require('fs');
const { spawn } = require('child_process');

const app = express();
const server = http.createServer(app);
// const expressWs = require('express-ws')(app, server); // TIDAK DIPERLUKAN jika WS streaming dihapus

const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ===> penting: pastikan HLS bisa diakses dari browser
app.use('/hls', express.static(path.join(__dirname, 'public', 'hls'), {
  setHeaders: (res, filePath) => {
    // Untuk m3u8 & ts pastikan MIME benar
    if (filePath.endsWith('.m3u8')) {
      res.setHeader('Content-Type', 'application/vnd.apple.mpegurl');
    } else if (filePath.endsWith('.ts')) {
      res.setHeader('Content-Type', 'video/mp2t');
    }
  }
}));

// ... route pages & APIs kamu tetap sama ...
// Page routes
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.get('/manage-cameras', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'manage-cameras.html'));
});

// API routes
app.post('/api/scan', async (req, res) => {
  try {
    const { ipRange } = req.body;
    if (!ipRange) {
      return res.status(400).json({ error: 'ipRange is required' });
    }
    const devices = await onvifScanner.scan(ipRange);
    res.json(devices);
  } catch (error) {
    console.error('Scan failed:', error);
    res.status(500).json({ error: 'Failed to scan for devices' });
  }
});

app.get('/api/cameras', async (req, res) => {
  try {
    const cameras = await database.getAllCameras();
    res.json(cameras);
  } catch (error) {
    res.status(500).json({ error: 'Failed to retrieve cameras' });
  }
});

app.post('/api/cameras', async (req, res) => {
  try {
    const newCamera = await database.addCamera(req.body);
    res.status(201).json(newCamera);
  } catch (error) {
    res.status(500).json({ error: 'Failed to add camera' });
  }
});

app.put('/api/cameras/:id', async (req, res) => {
  try {
    const updatedCamera = await database.updateCamera(req.params.id, req.body);
    res.json(updatedCamera);
  } catch (error) {
    console.error('Update failed:', error);
    res.status(500).json({ error: 'Failed to update camera' });
  }
});

app.delete('/api/cameras/:id', async (req, res) => {
  try {
    await database.deleteCamera(req.params.id);
    res.status(204).send();
  } catch (error) {
    console.error('Delete failed:', error);
    res.status(500).json({ error: 'Failed to delete camera' });
  }
});

// API Endpoint UTAMA untuk mengambil segmen video dari DATABASE
app.get('/api/playback/:cameraId', async (req, res) => {
  try {
    const cameraId = req.params.cameraId.replace('cam_', '');
    
    // Ambil rentang waktu dari query, atau default ke 24 jam terakhir
    const now = new Date();
    const defaultStart = new Date(now.getTime() - (24 * 60 * 60 * 1000)); // 24 jam lalu

    const startTime = req.query.start ? new Date(req.query.start).getTime() : defaultStart.getTime();
    const endTime = req.query.end ? new Date(req.query.end).getTime() : now.getTime();

    if (isNaN(startTime) || isNaN(endTime)) {
      return res.status(400).json({ error: 'Invalid date format for start or end time.' });
    }

    const segments = await database.getRecordings(cameraId, startTime, endTime);
    res.json(segments);

  } catch (err) {
    console.error("Server error fetching playback from DB:", err);
    res.status(500).json({ error: 'Failed to read recordings from database' });
  }
});


// supaya file rekaman bisa diakses langsung
app.use('/recordings', express.static(path.join(__dirname, 'recordings')));

// (Opsional) Hapus/komentari route WS berikut (tak diperlukan)
// app.ws('/stream/:id', async (ws, req) => { ... });

// ===> Mulai recorder (1 FFmpeg per kamera: record + HLS)
const recorder = require('./recorder');

server.listen(PORT, () => {
  console.log(`Server is running on http://localhost:${PORT}`);
  recorder.startAllRecordings();
});
