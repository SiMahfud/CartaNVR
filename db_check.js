const database = require('./lib/database');
const config = require('./lib/config');

async function test() {
    await database.init();
    const cameras = await database.getAllCameras();
    console.log(JSON.stringify(cameras, null, 2));
    process.exit(0);
}

test();
