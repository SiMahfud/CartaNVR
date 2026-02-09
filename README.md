# Super Simpel NVR

A simple Network Video Recorder (NVR) application designed for ease of use and flexibility.

## Getting Started

Setting up Super Simpel NVR is designed to be as automated as possible. Follow these steps to get up and running:

1.  **Clone the Repository:**
    ```bash
    git clone https://github.com/your-repo/nvr.git
    cd nvr
    ```
2.  **Install Dependencies:**
    ```bash
    npm install
    ```
3.  **Launch the Setup Wizard:**
    Simply run the start command. If no configuration is found, the system will automatically launch the interactive setup.
    ```bash
    npm start
    ```

## Database Configuration

The application supports both SQLite (default) and MySQL/MariaDB for more advanced setups.

### Database Selection Guide

| Feature | SQLite | MySQL / MariaDB |
| :--- | :--- | :--- |
| **Setup Complexity** | Zero-config (Self-contained file) | Requires a database server |
| **Performance** | Excellent for small/medium installs | Optimized for high-throughput & scale |
| **Portability** | Very High (Single `.db` file) | Standard SQL export/import |
| **Multi-Server** | Not recommended | **Recommended** for Federation |
| **Best For** | Home use, single-server setups | Large systems, enterprise, federation |

### Interactive Setup (Recommended)
When you start the application without a `.env` file, the **Interactive Setup Wizard** will guide you:

1.  **Choose Database Type:** Select between SQLite and MySQL.
2.  **Connection Details:** If MySQL is chosen, provide host, user, and password.
3.  **Connectivity Test:** The wizard automatically verifies the connection before saving.
4.  **Persistence:** Your choices are saved to a `.env` file automatically.

### Manual Configuration
Create a `.env` file in the root directory to bypass the wizard:

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
