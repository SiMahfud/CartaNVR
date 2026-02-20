const database = require('./lib/database');
(async () => {
    try {
        await database.init();
        const cameras = await database.getAllCameras();
        console.log('ID | Name | Method | HEVC | Enabled');
        console.log('-----------------------------------');
        cameras.forEach(c => {
            console.log(`${c.id} | ${c.name} | ${c.stream_method} | ${c.is_hevc} | ${c.enabled}`);
        });
        await database.close();
        process.exit(0);
    } catch (err) {
        console.error(err);
        process.exit(1);
    }
})();
