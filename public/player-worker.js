// TRIK FINAL: Buat lingkungan palsu yang mirip browser untuk JSMpeg.
self.window = self;
self.document = {
    addEventListener: function(event, callback) {}
};

// Import script JSMpeg dari file lokal
importScripts('jsmpeg.min.js');

let player = null;

self.onmessage = (event) => {
    const data = event.data;

    switch (data.action) {
        case 'start':
            if (player) {
                player.destroy();
            }
            console.log(`Worker: Starting player for ${data.wsUrl}`);
            
            // Buat player dengan opsi untuk secara paksa menonaktifkan audio
            player = new JSMpeg.Player(data.wsUrl, {
                video: false, // Kita handle video secara manual via onVideoDecode
                audio: false,
                disableWebAudio: true, // PENTING: Nonaktifkan modul Web Audio
                onVideoDecode: (decoder, time) => {
                    self.postMessage({
                        type: 'frame',
                        y: decoder.y,
                        u: decoder.u,
                        v: decoder.v,
                        width: decoder.width,
                        height: decoder.height
                    }, [decoder.y.bytes, decoder.u.bytes, decoder.v.bytes]);
                }
            });
            break;

        case 'stop':
            console.log('Worker: Stopping player.');
            if (player) {
                player.destroy();
                player = null;
            }
            break;
    }
};