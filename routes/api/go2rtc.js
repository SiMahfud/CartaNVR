'use strict';

/**
 * go2rtc.js — API proxy routes
 *
 * Proxies requests from the browser to the internal go2rtc process.
 * This keeps all traffic flowing through Express (port 3000),
 * so no additional ports need to be exposed — compatible with Cloudflare Tunnel.
 */

const express = require('express');
const http = require('http');
const router = express.Router();
const { isAuthenticated } = require('../../lib/middleware');
const go2rtcManager = require('../../lib/go2rtc-manager');

/**
 * Proxy a request to go2rtc's internal API
 */
function proxyToGo2rtc(req, res, targetPath) {
    if (!go2rtcManager.isRunning()) {
        return res.status(503).json({ error: 'go2rtc is not running' });
    }

    const port = go2rtcManager.getApiPort();

    const options = {
        hostname: '127.0.0.1',
        port,
        path: targetPath,
        method: req.method,
        headers: {
            ...req.headers,
            host: `127.0.0.1:${port}`,
        },
        timeout: 30000,
    };

    // Remove browser-specific headers that might interfere
    delete options.headers['cookie'];
    delete options.headers['origin'];
    delete options.headers['referer'];

    const proxyReq = http.request(options, (proxyRes) => {
        // Merge no-cache headers to prevent Cloudflare/CDN caching of live streams
        const headers = { ...proxyRes.headers };
        headers['cache-control'] = 'no-store, no-cache, must-revalidate, proxy-revalidate';
        headers['pragma'] = 'no-cache';
        headers['expires'] = '0';
        headers['cdn-cache-control'] = 'no-store';
        headers['cloudflare-cdn-cache-control'] = 'no-store';
        res.writeHead(proxyRes.statusCode, headers);
        proxyRes.pipe(res);
    });

    proxyReq.on('timeout', () => {
        proxyReq.destroy();
        if (!res.headersSent) {
            res.status(504).json({ error: 'go2rtc proxy timeout' });
        }
    });

    proxyReq.on('error', (err) => {
        if (!res.headersSent) {
            res.status(502).json({ error: `go2rtc proxy error: ${err.message}` });
        }
    });

    // Pipe request body for POST/PUT
    if (req.method === 'POST' || req.method === 'PUT') {
        // If body-parser has already parsed the body, req.body might exist
        if (req.body && Object.keys(req.body).length > 0) {
            const bodyStr = typeof req.body === 'string' ? req.body : JSON.stringify(req.body);
            proxyReq.write(bodyStr);
            proxyReq.end();
        } else if (req.body && typeof req.body === 'string') {
            proxyReq.write(req.body);
            proxyReq.end();
        } else {
            // Fallback for raw streams if body is somehow not parsed
            req.pipe(proxyReq);
        }
    } else {
        proxyReq.end();
    }
}

// GET /api/go2rtc/streams — List all streams
router.get('/streams', isAuthenticated, (req, res) => {
    proxyToGo2rtc(req, res, '/api/streams');
});

// POST /api/go2rtc/webrtc — WebRTC SDP exchange
// Requires parsing application/sdp into string text
router.post('/webrtc', isAuthenticated, express.text({ type: 'application/sdp' }), (req, res) => {
    const src = req.query.src;
    if (!src) return res.status(400).json({ error: 'src parameter required' });
    const query = new URLSearchParams({ src }).toString();
    proxyToGo2rtc(req, res, `/api/webrtc?${query}`);
});

// GET /api/go2rtc/stream.mp4 — MSE stream
router.get('/stream.mp4', isAuthenticated, (req, res) => {
    const src = req.query.src;
    if (!src) return res.status(400).json({ error: 'src parameter required' });
    const query = new URLSearchParams({ src }).toString();
    proxyToGo2rtc(req, res, `/api/stream.mp4?${query}`);
});

// GET /api/go2rtc/stream.m3u8 — HLS playlist
router.get('/stream.m3u8', isAuthenticated, (req, res) => {
    const src = req.query.src;
    if (!src) return res.status(400).json({ error: 'src parameter required' });
    const query = new URLSearchParams({ src }).toString();
    proxyToGo2rtc(req, res, `/api/stream.m3u8?${query}`);
});

// GET /api/go2rtc/stream.ts — HLS segments
router.get('/stream.ts', isAuthenticated, (req, res) => {
    const src = req.query.src;
    if (!src) return res.status(400).json({ error: 'src parameter required' });
    const query = new URLSearchParams(req.query).toString();
    proxyToGo2rtc(req, res, `/api/stream.ts?${query}`);
});

// GET /api/go2rtc/ws — WebSocket proxy for MSE
// This needs special handling because it's a WebSocket upgrade
router.get('/status', isAuthenticated, (req, res) => {
    res.json({
        running: go2rtcManager.isRunning(),
        port: go2rtcManager.getApiPort(),
    });
});

module.exports = router;
