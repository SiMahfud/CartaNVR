# Super Simpel NVR

A simple Network Video Recorder (NVR) application.

## Database Configuration

This application supports both SQLite and MySQL/MariaDB. 

### Interactive Setup (Recommended)
When you start the application for the first time without a `.env` file, it will automatically launch an **Interactive Setup Wizard** in your terminal to guide you through the configuration.

```bash
npm start
```

The wizard will:
1. Ask you to choose between SQLite and MySQL.
2. If MySQL is selected, prompt for connection details.
3. **Verify the connection** to ensure your settings are correct.
4. Save the configuration to a `.env` file for future runs.

### Manual Configuration
You can also manually configure the database by creating a `.env` file in the root directory:

#### SQLite
```env
DB_TYPE=sqlite
```

#### MySQL / MariaDB
```env
DB_TYPE=mysql
MYSQL_HOST=localhost
MYSQL_USER=your_user
MYSQL_PASSWORD=your_password
MYSQL_DATABASE=nvr
```

## Health Check
You can verify the system status by running:
```bash
node -e "require('./lib/healthcheck').checkHealth().then(h => console.log(JSON.stringify(h, null, 2)))"
```
