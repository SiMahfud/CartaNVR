const database = require('./lib/database');

async function test() {
    await database.init();
    await database.updateCamera(1, {
        name: "XII 1",
        rtsp_url: "rtsp://admin:smart999@192.168.16.141:554/Streaming/Channels/101?transportmode=unicast&profile=Profile_1",
        storage_id: 1,
        is_hevc: false,
        enabled: true,
        stream_method: "jsmpeg"
    });
    console.log("Updated camera 1 to jsmpeg");
    process.exit(0);
}

test();
