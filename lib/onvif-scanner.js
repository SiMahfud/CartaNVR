const onvif = require('node-onvif');
const { OnvifDevice } = onvif;
const net = require('net');

async function checkPortOpen(ip, port, timeout = 1500) {
    return new Promise((resolve) => {
        const socket = new net.Socket();
        socket.setTimeout(timeout);
        socket.once('connect', () => {
            socket.destroy();
            resolve(true);
        });
        socket.once('timeout', () => {
            socket.destroy();
            resolve(false);
        });
        socket.once('error', () => {
            resolve(false);
        });
        socket.connect(port, ip);
    });
}
// Helper function to parse IP range string into an array of IP addresses
function parseIpRange(ipRange) {
    const ipAddresses = [];

    if (!ipRange) return ipAddresses;

    // Handle single IP address
    if (!ipRange.includes('-') && !ipRange.includes('/')) {
        if (/^(\d{1,3}\.){3}\d{1,3}$/.test(ipRange)) {
            ipAddresses.push(ipRange);
        }
        return ipAddresses;
    }

    // Handle IP range (e.g., "192.168.1.10-192.168.1.20" or "192.168.1.10-20")
    if (ipRange.includes('-')) {
        const [start, end] = ipRange.split('-');
        const startParts = start.split('.').map(num => parseInt(num, 10));
        const endPartsRaw = end.split('.').map(num => parseInt(num, 10));

        if (endPartsRaw.length === 1 && startParts.length === 4) {
            const [o1, o2, o3] = startParts.slice(0, 3);
            const startLastOctet = startParts[3];
            const endLastOctet = endPartsRaw[0];

            if (startLastOctet <= endLastOctet) {
                for (let i = startLastOctet; i <= endLastOctet; i++) {
                    ipAddresses.push(`${o1}.${o2}.${o3}.${i}`);
                }
            }
        } else if (startParts.length === 4 && endPartsRaw.length === 4) {
            if (startParts.slice(0, 3).join('.') === endPartsRaw.slice(0, 3).join('.')) {
                const [o1, o2, o3] = startParts.slice(0, 3);
                const startLastOctet = startParts[3];
                const endLastOctet = endPartsRaw[3];

                if (startLastOctet <= endLastOctet) {
                    for (let i = startLastOctet; i <= endLastOctet; i++) {
                        ipAddresses.push(`${o1}.${o2}.${o3}.${i}`);
                    }
                }
            }
        }
        return ipAddresses;
    }

    // Handle CIDR notation (e.g., "192.168.1.0/24")
    if (ipRange.includes('/')) {
        const [ip, cidrStr] = ipRange.split('/');
        const cidr = parseInt(cidrStr, 10);
        let [a, b, c, d] = ip.split('.').map(Number);

        if (cidr < 0 || cidr > 32) return ipAddresses;

        const mask = (0xFFFFFFFF << (32 - cidr)) >>> 0;
        const startIp = ((a << 24) | (b << 16) | (c << 8) | d) & mask;
        const endIp = startIp | (~mask >>> 0);

        for (let i = startIp + 1; i < endIp; i++) {
            ipAddresses.push(
                `${(i >>> 24) & 0xFF}.${(i >>> 16) & 0xFF}.${(i >>> 8) & 0xFF}.${i & 0xFF}`
            );
        }
        return ipAddresses;
    }

    return ipAddresses;
}


// Main scanning function
async function scan(ipRange, port, user, pass) {
    const ipAddresses = parseIpRange(ipRange);
    if (ipAddresses.length === 0) {
        return [];
    }

    console.log(`Scanning ${ipAddresses.length} IP addresses...`);

    const portsToCheck = port ? [parseInt(port, 10)] : [80, 8080, 5000, 8899, 8888, 8000, 10080, 8001];

    const tasks = [];
    for (const ip of ipAddresses) {
        for (const targetPort of portsToCheck) {
            tasks.push({ ip, targetPort });
        }
    }

    const BATCH_SIZE = 300; // Limit concurrent socket connections
    const foundCameras = [];

    for (let i = 0; i < tasks.length; i += BATCH_SIZE) {
        const batch = tasks.slice(i, i + BATCH_SIZE);

        const batchPromises = batch.map(async ({ ip, targetPort }) => {
            // Check if port is open first to avoid hanging HTTP requests on dead IPs
            const isOpen = await checkPortOpen(ip, targetPort);
            if (!isOpen) return null;

            // If it's open but no credentials, just return as potential
            if (!user || !pass) {
                return {
                    name: 'Potential Camera',
                    ip_address: ip,
                    port: targetPort,
                    rtsp_url: null,
                    requires_auth: true
                };
            }

            try {
                const device = new OnvifDevice({
                    xaddr: `http://${ip}:${targetPort}/onvif/device_service`,
                    user: user,
                    pass: pass,
                });

                await device.init();
                console.log(`Successfully initialized device at ${ip}:${targetPort}`);

                let rtsp_url = device.getUdpStreamUrl();
                if (rtsp_url) {
                    const urlParts = rtsp_url.split('://');
                    if (urlParts.length > 1) {
                        rtsp_url = `${urlParts[0]}://${user}:${pass}@${urlParts[1]}`;
                    }
                }

                return {
                    name: device.getInformation()?.Manufacturer || 'Unknown',
                    model: device.getInformation()?.Model || 'Unknown',
                    serial: device.getInformation()?.SerialNumber || 'Unknown',
                    ip_address: ip,
                    port: targetPort,
                    rtsp_url: rtsp_url,
                    requires_auth: false
                };

            } catch (error) {
                // Port is open but ONVIF init failed (maybe wrong credentials or not ONVIF)
                return {
                    name: 'Potential Camera',
                    ip_address: ip,
                    port: targetPort,
                    rtsp_url: null,
                    requires_auth: true
                };
            }
        });

        const batchResults = await Promise.all(batchPromises);
        const validResults = batchResults.filter(deviceInfo => deviceInfo !== null);
        foundCameras.push(...validResults);
    }

    console.log(`Scan complete. Found ${foundCameras.length} cameras.`);
    return foundCameras;
}

// Network discovery function
async function discover() {
    console.log('Starting local network ONVIF discovery...');
    try {
        const device_info_list = await onvif.startProbe();
        console.log(`Discovery complete. Found ${device_info_list.length} devices.`);

        const discovered = device_info_list.map(info => {
            // xaddrs Usually looks like: http://192.168.1.100:80/onvif/device_service
            let ip = '';
            let port = 80;
            if (info.xaddrs && info.xaddrs.length > 0) {
                const urlMatch = info.xaddrs[0].match(/http:\/\/([^:]+):?(\d+)?\//);
                if (urlMatch) {
                    ip = urlMatch[1];
                    port = urlMatch[2] ? parseInt(urlMatch[2], 10) : 80;
                }
            }

            return {
                name: info.name || 'Unknown',
                urn: info.urn,
                ip: ip,
                port: port,
                xaddrs: info.xaddrs
            };
        });

        return discovered;
    } catch (error) {
        console.error('Discovery failed:', error);
        throw error;
    }
}

module.exports = { scan, discover };
