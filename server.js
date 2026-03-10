const http = require('http');
const app = require('./app');
const setupWizard = require('./lib/setup-wizard');

let httpServer = null;

async function checkConfig() {
  if (!process.env.DB_TYPE) {
    const config = await setupWizard.runWizard();
    await setupWizard.verifyConnection(config);
    await setupWizard.saveConfig(config);
    // Reload environment variables after saving
    require('dotenv').config({ override: true });
  }
}

async function initialize() {
  await checkConfig();

  const database = require('./lib/database');
  await database.init();

  const config = require('./lib/config');
  if (config.syncWithDatabase) {
    await config.syncWithDatabase();
  }

  const logger = require('./lib/logger');
  const recorder = require('./recorder');
  const go2rtcManager = require('./lib/go2rtc-manager');

  const server = http.createServer(app);
  // Ensure express-ws is tied to the actual http server for upgrade handling
  require('express-ws')(app, server);

  // Initialize Stream Relay
  const streamRelay = require('./lib/stream-relay');
  streamRelay.init();

  // Initialize WebSocket Routes
  require('./routes/websocket')(app);

  // Initialize go2rtc streaming proxy
  if (config.GO2RTC_ENABLED) {
    try {
      await go2rtcManager.start();
      // Register all enabled cameras that use go2rtc
      const cameras = await database.getAllCameras();
      for (const cam of cameras) {
        if (cam.enabled !== false && cam.stream_method === 'go2rtc' && cam.rtsp_url) {
          await go2rtcManager.addStream(cam.id, cam.rtsp_url);
        }
      }

      // Periodic re-sync: re-register missing streams every 60s
      setInterval(async () => {
        if (!go2rtcManager.isRunning()) return;
        try {
          const cams = await database.getAllCameras();
          // Get currently registered streams from go2rtc
          let registered = {};
          try {
            registered = await go2rtcManager.getStreams() || {};
          } catch { /* go2rtc might be restarting */ return; }

          for (const cam of cams) {
            if (cam.enabled !== false && cam.stream_method === 'go2rtc' && cam.rtsp_url) {
              const streamName = `cam_${cam.id}`;
              if (!registered[streamName]) {
                logger.log('general', `[GO2RTC-SYNC] Re-registering missing stream: ${streamName}`);
                await go2rtcManager.addStream(cam.id, cam.rtsp_url).catch(() => { });
              }
            }
          }
        } catch (err) {
          // Silent fail — will retry next interval
        }
      }, 60000);
    } catch (err) {
      logger.log('general', `[GO2RTC] Failed to initialize: ${err.message}`);
    }
  }

  const PORT = process.env.PORT || 3000;

  // Buat user admin default jika belum ada
  try {
    const admin = await database.findUserByUsername(config.defaultAdminUser);
    if (!admin) {
      logger.log('general', `Creating default admin user '${config.defaultAdminUser}'...`);
      await database.createUser({ username: config.defaultAdminUser, password: config.defaultAdminPassword });
      logger.log('general', `Default admin user '${config.defaultAdminUser}' created with the default password.`);
      logger.log('general', 'Please change this password after your first login!');
    }
  } catch (err) {
    console.error('Error creating default admin:', err);
  }

  httpServer = server;

  server.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
      console.error(`[SERVER] Port ${PORT} is already in use. Retrying in 1s...`);
      setTimeout(() => {
        server.close();
        server.listen(PORT);
      }, 1000);
    } else {
      console.error(`[SERVER] Server error:`, err);
    }
  });

  server.listen(PORT, () => {
    logger.log('general', `Server is running on http://127.0.0.1:${PORT}`);

    // Start discovery advertisement
    try {
      const discovery = require('./lib/discovery');
      discovery.startAdvertising(process.env.NVR_NAME || 'My NVR', PORT);
    } catch (err) {
      console.error('Failed to start discovery advertisement:', err);
    }

    // Pindahkan start recording ke sini agar admin user sudah siap
    recorder.startAllRecordings();
  });
}

function gracefulShutdown(signal) {
  const logger = require('./lib/logger');
  const recorder = require('./recorder');
  const go2rtcManager = require('./lib/go2rtc-manager');

  console.log(`\n[SERVER] Received ${signal}. Shutting down gracefully...`);
  logger.log('general', `[SERVER] Received ${signal}. Shutting down gracefully...`);

  const streamRelay = require('./lib/stream-relay');
  streamRelay.close();

  Promise.all([
    new Promise(resolve => {
      if (httpServer) {
        httpServer.close(resolve);
      } else {
        resolve();
      }
    }),
    recorder.stopAllRecordings(),
    go2rtcManager.stop(),
  ])
    .then(() => {
      console.log('[SERVER] All recordings and processes stopped. Exiting.');
      process.exit(0);
    })
    .catch((err) => {
      console.error('[SERVER] Error during shutdown:', err);
      process.exit(1);
    });
}

process.on('SIGINT', () => gracefulShutdown('SIGINT'));
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));

initialize();