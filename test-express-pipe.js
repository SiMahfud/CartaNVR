const express = require('express');
const app = express();

app.use(express.json());
app.use(express.urlencoded({ extended: false }));

app.post('/test', (req, res) => {
    console.log('Got headers:', req.headers['content-type']);
    let data = '';
    req.on('data', chunk => data += chunk);
    req.on('end', () => {
        console.log('Received body length:', data.length);
        res.send('OK');
    });
});

const server = app.listen(3009, () => {
    const http = require('http');
    const req = http.request({
        hostname: '127.0.0.1',
        port: 3009,
        path: '/test',
        method: 'POST',
        headers: { 'Content-Type': 'application/sdp' }
    }, res => {
        res.on('data', () => { });
        res.on('end', () => {
            server.close();
            console.log('Done');
        });
    });
    req.write('v=0\r\no=jdoe 2890844526...');
    req.end();
});
