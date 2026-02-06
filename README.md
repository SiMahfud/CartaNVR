# Super Simpel NVR

A simple Network Video Recorder (NVR) application.

## Database Configuration

This application supports both SQLite and MySQL/MariaDB.

### SQLite (Default)
By default, the application uses SQLite and stores data in `nvr.db`. No additional configuration is required.

### MySQL / MariaDB
To use MySQL or MariaDB, set the following environment variables:

- `DB_TYPE`: set to `mysql`
- `MYSQL_HOST`: database host (default: `localhost`)
- `MYSQL_USER`: database user (default: `nvr`)
- `MYSQL_PASSWORD`: database password
- `MYSQL_DATABASE`: database name (default: `nvr`)

Example using an environment file or command line:
```bash
DB_TYPE=mysql MYSQL_HOST=192.168.1.10 MYSQL_USER=admin MYSQL_PASSWORD=secret node server.js
```

## Health Check
You can verify the system status by running:
```bash
node -e "const { checkHealth } = require('./lib/healthcheck'); console.log(JSON.stringify(checkHealth(), null, 2))"
```
