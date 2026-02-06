const sqlite3 = require('sqlite3').verbose();

function dumpSchema(dbFile) {
    console.log(`--- Schema for ${dbFile} ---`);
    const db = new sqlite3.Database(dbFile);
    db.all("SELECT name FROM sqlite_master WHERE type='table'", (err, rows) => {
        if (err) {
            console.error(err);
            return;
        }
        if (rows.length === 0) console.log("No tables found.");
        rows.forEach(r => {
            db.get(`SELECT COUNT(*) as count FROM ${r.name}`, (err, countRow) => {
                console.log(`Table: ${r.name}, Rows: ${countRow ? countRow.count : 'err'}`);
            });
        });
        // We'll leave it open for a bit to allow counts to finish
        setTimeout(() => db.close(), 1000);
    });
}

dumpSchema('cctv.db');
dumpSchema('nvr.db');
