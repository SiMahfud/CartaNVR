const http = require('http');
const app = require('./app');
const database = require('./lib/database');
const logger = require('./lib/logger');
const config = require('./lib/config');
const recorder = require('./recorder');

const server = http.createServer(app);
const PORT = process.env.PORT || 3000;

async function initialize() {
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
    // Pindahkan start recording ke sini agar admin user sudah siap
    recorder.startAllRecordings();
  });
}

initialize();