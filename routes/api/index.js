const express = require('express');
const router = express.Router();

const camerasRouter = require('./cameras');
const storagesRouter = require('./storages');
const maintenanceRouter = require('./maintenance');
const systemRouter = require('./system'); // Contains /scan, /config, etc.
const recordingsRouter = require('./recordings');

// Resource-specific routes
router.use('/cameras', camerasRouter);
router.use('/storages', storagesRouter);
router.use('/maintenance', maintenanceRouter);
router.use('/recordings', recordingsRouter);

// Other general API routes
router.use('/', systemRouter);

module.exports = router;
