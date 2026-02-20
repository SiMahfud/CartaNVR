const http = require('http');
const app = require('./app');
const setupWizard = require('./lib/setup-wizard');

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

  const server = http.createServer(app);
  // Ensure express-ws is tied to the actual http server for upgrade handling
  require('express-ws')(app, server);

  // Initialize Stream Relay
  const streamRelay = require('./lib/stream-relay');
  streamRelay.init();

  // Initialize WebSocket Routes
  require('./routes/websocket')(app);


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

  server.listen(PORT, () => {
    logger.log('general', `Server is running on http://localhost:${PORT}`);

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

  console.log(`\n[SERVER] Received ${signal}. Shutting down gracefully...`);
  logger.log('general', `[SERVER] Received ${signal}. Shutting down gracefully...`);

  const streamRelay = require('./lib/stream-relay');
  streamRelay.close();

  recorder.stopAllRecordings()
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