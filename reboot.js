'use strict';

const { exec } = require('child_process');
const config = require('./lib/config');

const serviceName = config.pm2_service_name || 'nvr';

console.log(`Attempting to stop PM2 service: ${serviceName}...`);

exec(`pm2 stop ${serviceName}`, (stopError, stopStdout, stopStderr) => {
  // We ignore the error if the process was not running
  if (stopError && !stopStderr.includes('is not running') && !stopStderr.includes('not found')) {
    console.error(`Failed to stop service "${serviceName}":`, stopError);
    console.error(stopStderr);
    // Even if stopping fails, we'll try to start it, as it might be in a weird state. ok
  }
  
  console.log(`Service "${serviceName}" stopped. Now starting...`);
  console.log(stopStdout);

  exec(`pm2 start ${serviceName}`, (startError, startStdout, startStderr) => {
    if (startError) {
      console.error(`Failed to start service "${serviceName}":`, startError);
      console.error(startStderr);
      return;
    }
    console.log(`Service "${serviceName}" started successfully.`);
    console.log(startStdout);
  });
});