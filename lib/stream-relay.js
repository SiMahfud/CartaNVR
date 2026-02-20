'use strict';

const http = require('http');
const WebSocket = require('ws');
const dbEmitter = require('./db-events');

class StreamRelay {
    constructor() {
        this.streams = new Map(); // camId -> Set of WebSockets
        this.server = null;
        this.port = 9999;
    }

    init() {
        if (this.server) return;

        this.server = http.createServer((req, res) => {
            const parts = req.url.split('/');
            const camId = parts[parts.length - 1];

            if (parts[1] === 'input' && camId) {
                console.log(`[RELAY] Receive stream input for cam ${camId}`);
                res.connection.setTimeout(0);

                req.on('data', (data) => {
                    this.broadcast(camId, data);
                });

                req.on('end', () => {
                    console.log(`[RELAY] Stream input ended for cam ${camId}`);
                });
            } else {
                res.end();
            }
        });

        this.server.on('error', (err) => {
            console.error(`[RELAY] Server error:`, err);
        });

        this.server.listen(this.port, '127.0.0.1', () => {
            console.log(`[RELAY] JSMpeg relay listening for FFmpeg on http://127.0.0.1:${this.port}`);
        });
    }

    close() {
        if (this.server) {
            console.log('[RELAY] Closing JSMpeg relay server...');
            this.server.close();
            this.server = null;
        }
    }

    addClient(camId, ws) {
        if (!this.streams.has(camId)) {
            this.streams.set(camId, new Set());
        }
        const clients = this.streams.get(camId);
        clients.add(ws);

        console.log(`[RELAY] Client connected to cam ${camId}. Total: ${clients.size}`);

        ws.on('error', (err) => {
            console.error(`[RELAY] WebSocket error for cam ${camId}:`, err);
            clients.delete(ws);
        });

        ws.on('close', () => {
            clients.delete(ws);
            console.log(`[RELAY] Client disconnected from cam ${camId}. Remaining: ${clients.size}`);
            if (clients.size === 0) {
                this.streams.delete(camId);
            }
        });
    }

    broadcast(camId, data) {
        const clients = this.streams.get(camId);
        if (clients) {
            clients.forEach(ws => {
                if (ws.readyState === WebSocket.OPEN) {
                    ws.send(data);
                }
            });
        }
    }
}

module.exports = new StreamRelay();
