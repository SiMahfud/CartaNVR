const streamRelay = require('../lib/stream-relay');

module.exports = (app) => {
    // JSMpeg WebSocket Stream
    app.ws('/api/stream/:camId', (ws, req) => {
        const camId = req.params.camId;
        // Note: auth could be added here if needed via passport session
        streamRelay.addClient(camId, ws);
    });
};
