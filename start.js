'use strict';

const { exec } = require('child_process');
const config = require('./lib/config');

const serviceName = config.pm2_service_name || 'nvr';

console.log(`Checking for PM2 service: ${serviceName}...`);

// Command to check if the service exists
const describeCommand = `pm2 describe ${serviceName}`;

exec(describeCommand, (error, stdout, stderr) => {
  // If stderr contains "does not exist", the service is not running
  if (error || (stderr && stderr.includes('does not exist'))) {
    console.log(`Service "${serviceName}" not found. Starting it...`);
    
    const startCommand = `pm2 start server.js --name "${serviceName}"`;

    exec(startCommand, (startError, startStdout, startStderr) => {
      if (startError) {
        console.error(`Failed to start service "${serviceName}":`, startError);
        console.error(startStderr);
        return;
      }
      console.log(`Service "${serviceName}" started successfully.`);
      console.log(startStdout);
    });
  } else {
    console.log(`Service "${serviceName}" is already running.`);
    // If stdout has content, it means the describe command was successful
    if (stdout) {
        console.log('--- Service Info ---');
        console.log(stdout);
    }
  }
});
