const http = require('http');

function apiRequest(method, targetPath) {
    return new Promise((resolve, reject) => {
        const options = {
            hostname: '127.0.0.1',
            port: 1984,
            path: targetPath,
            method,
            headers: {}
        };

        const req = http.request(options, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                console.log(`[${method} ${targetPath}] -> ${res.statusCode}`);
                console.log(data);
                resolve();
            });
        });
        req.on('error', reject);
        req.end();
    });
}

async function test() {
    console.log("1. Get current streams");
    await apiRequest('GET', '/api/streams');

    console.log("\n2. Register stream with src and name");
    await apiRequest('PUT', '/api/streams?name=test_cam&src=rtsp://test');

    console.log("\n3. Get current streams");
    await apiRequest('GET', '/api/streams');

    console.log("\n4. Register stream with src only and body");
    const options2 = {
        hostname: '127.0.0.1',
        port: 1984,
        path: '/api/streams?src=test_cam2',
        method: 'PUT',
    };
    await new Promise(r => {
        const req = http.request(options2, res => {
            console.log(`[PUT /api/streams?src=test_cam2] -> ${res.statusCode}`);
            res.on('data', d => console.log(d.toString()));
            res.on('end', r);
        });
        req.write('rtsp://test2');
        req.end();
    });

    console.log("\n5. Get current streams");
    await apiRequest('GET', '/api/streams');
}

test();
