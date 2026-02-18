const database = require('./database');

/**
 * Centralized logging utility that filters terminal output based on database settings.
 */
const logger = {
    /**
     * Logs a message to the terminal if the corresponding category is enabled in settings.
     * @param {string} category - The logging category ('general', 'recorder', 'storage').
     * @param {...any} args - The messages or objects to log.
     */
    async log(category, ...args) {
        try {
            const settingKey = `log_terminal_${category}`;
            const isEnabled = await database.getSetting(settingKey);

            // Allow '1', 'true' (string), or true (boolean)
            if (isEnabled === '1' || isEnabled === 'true' || isEnabled === true) {
                const timestamp = new Date().toISOString();
                console.log(`[${timestamp}] [${category.toUpperCase()}]`, ...args);
            }
        } catch (error) {
            // Fallback to console.log if database fails, to ensure we don't lose critical info
            // but prefix it so we know it's a fallback
            console.log('[LOGGER-ERROR]', ...args);
        }
    }
};

module.exports = logger;
