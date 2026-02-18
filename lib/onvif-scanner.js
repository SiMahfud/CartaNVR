const { OnvifDevice } = require('node-onvif');

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

    const devicePromises = ipAddresses.map(async (ip) => {
        try {
            const device = new OnvifDevice({
                xaddr: `http://${ip}:${port || 80}/onvif/device_service`,
                user: user,
                pass: pass,
            });

            await device.init();
            console.log(`Successfully initialized device at ${ip}`);

            return {
                name: device.getInformation()?.Manufacturer || 'Unknown',
                model: device.getInformation()?.Model || 'Unknown',
                serial: device.getInformation()?.SerialNumber || 'Unknown',
                ip_address: ip,
                rtsp_url: device.getUdpStreamUrl()
            };

        } catch (error) {
            // console.error(`Failed to initialize device at ${ip}:`, error.message);
            return null; // Return null for failed initializations
        }
    });

    const results = await Promise.all(devicePromises);
    const foundCameras = results.filter(deviceInfo => deviceInfo !== null);

    console.log(`Scan complete. Found ${foundCameras.length} cameras.`);
    return foundCameras;
}

module.exports = { scan };
