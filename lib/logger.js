const database = require('./database');
const dbEmitter = require('./db-events');

/**
 * Centralized logging utility that filters terminal output based on cached settings.
 * Settings are cached in memory and updated via database events to avoid
 * performing a DB query on every log call.
 */

// In-memory cache for log settings
const settingsCache = new Map();
let cacheInitialized = false;

// Listen for setting changes and update cache
dbEmitter.on('settingChanged', (key, value) => {
    if (key.startsWith('log_terminal_')) {
        settingsCache.set(key, value);
    }
});

// Initialize cache from database (called once)
async function initCache() {
    if (cacheInitialized) return;
    try {
        const settings = await database.getAllSettings();
        for (const [key, value] of Object.entries(settings)) {
            if (key.startsWith('log_terminal_')) {
                settingsCache.set(key, value);
            }
        }
        cacheInitialized = true;
    } catch {
        // Database might not be initialized yet
    }
}

const logger = {
    /**
     * Logs a message to the terminal if the corresponding category is enabled in settings.
     * @param {string} category - The logging category ('general', 'recorder', 'storage').
     * @param {...any} args - The messages or objects to log.
     */
    async log(category, ...args) {
        try {
            // Lazy init cache on first log call
            if (!cacheInitialized) {
                await initCache();
            }

            const settingKey = `log_terminal_${category}`;
            const isEnabled = settingsCache.get(settingKey);

            // Allow '1', 'true' (string), or true (boolean)
            if (isEnabled === '1' || isEnabled === 'true' || isEnabled === true) {
                const timestamp = new Date().toISOString();
                console.log(`[${timestamp}] [${category.toUpperCase()}]`, ...args);
            }
        } catch (error) {
            // Fallback to console.log if anything fails
            console.log('[LOGGER-ERROR]', ...args);
        }
    }
};

module.exports = logger;
