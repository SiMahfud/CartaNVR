'use strict';

const { exec } = require('child_process');
const config = require('./lib/config');

const serviceName = config.pm2_service_name || 'nvr';

console.log(`Attempting to restart PM2 service: ${serviceName}...`);

const restartCommand = `pm2 restart ${serviceName}`;

exec(restartCommand, (error, stdout, stderr) => {
  if (error) {
    console.error(`Failed to restart service "${serviceName}":`, error);
    console.error(stderr);
    return;
  }
  console.log(`Service "${serviceName}" restarted successfully.`);
  console.log(stdout);
});
