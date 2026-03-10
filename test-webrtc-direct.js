const http = require('http');

// Test direct connection to go2rtc
const req = http.request({
    hostname: '127.0.0.1',
    port: 1984, // go2rtc native API port
    path: '/api/webrtc?src=cam_1',
    method: 'POST',
    headers: { 'Content-Type': 'application/sdp' }
}, res => {
    console.log('Status Code:', res.statusCode);
    let data = '';
    res.on('data', chunk => data += chunk);
    res.on('end', () => console.log('Response:', data.substring(0, 50) + '...'));
});
req.on('error', err => console.error('Error:', err.message));
req.write('v=0\r\no=- 1 2 IN IP4 127.0.0.1\r\ns=-\r\nc=IN IP4 0.0.0.0\r\nt=0 0\r\nm=video 9 UDP/TLS/RTP/SAVPF 96\r\na=setup:actpass\r\na=mid:0\r\na=sendrecv\r\na=rtcp-mux\r\na=rtpmap:96 H264/90000\r\n');
req.end();
