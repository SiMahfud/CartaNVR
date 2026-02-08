/**
 * lib/discovery.js
 * 
 * Handles mDNS/Bonjour service advertisement and discovery.
 */

const { Bonjour } = require('bonjour-service');
const bonjour = new Bonjour();

let ad;
let browser;

/**
 * Advertises this NVR instance on the local network.
 * @param {string} name The display name of this NVR.
 * @param {number} port The port this NVR is running on.
 */
function startAdvertising(name, port) {
    if (ad) stopAdvertising();
    
    ad = bonjour.publish({
        name: name,
        type: 'nvr-federation',
        port: port,
        protocol: 'tcp'
    });

    console.log(`[DISCOVERY] Advertising NVR as "${name}" on port ${port}`);
}

/**
 * Stops advertising this instance.
 */
function stopAdvertising() {
    if (ad) {
        ad.stop();
        ad = null;
    }
}

/**
 * Scans for other NVR instances on the local network.
 * @param {Function} onFound Callback when an instance is found.
 */
function scan(onFound) {
    if (browser) stopScanning();

    browser = bonjour.find({ type: 'nvr-federation' });
    browser.on('up', (service) => {
        console.log(`[DISCOVERY] Found NVR: ${service.name} at ${service.referer.address}:${service.port}`);
        onFound({
            name: service.name,
            port: service.port,
            address: service.referer.address,
            url: `http://${service.referer.address}:${service.port}`
        });
    });
}

/**
 * Stops scanning for other instances.
 */
function stopScanning() {
    if (browser) {
        browser.stop();
        browser = null;
    }
}

/**
 * Completely shuts down the discovery service.
 */
function destroy() {
    stopAdvertising();
    stopScanning();
    bonjour.destroy();
}

module.exports = {
    startAdvertising,
    stopAdvertising,
    scan,
    stopScanning,
    destroy
};
