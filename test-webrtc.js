const http = require('http');

const options = {
    hostname: '127.0.0.1',
    port: 3000,
    path: '/api/go2rtc/webrtc?src=cam_1',
    method: 'POST',
    headers: {
        'Content-Type': 'application/sdp',
        // In local, no auth might return 401, but let's see what it returns
    }
};

const req = http.request(options, (res) => {
    console.log('Status Code:', res.statusCode);
    let data = '';
    res.on('data', chunk => data += chunk);
    res.on('end', () => {
        console.log('Response:', data);
    });
});
req.on('error', err => console.error(err));
req.write('v=0\r\no=- 1 2 IN IP4 127.0.0.1\r\ns=-\r\nc=IN IP4 0.0.0.0\r\nt=0 0\r\nm=video 9 UDP/TLS/RTP/SAVPF 96\r\na=setup:actpass\r\na=mid:0\r\na=sendrecv\r\na=rtcp-mux\r\na=rtpmap:96 H264/90000\r\n');
req.end();
