const EventEmitter = require('events');
class DatabaseEmitter extends EventEmitter {}
const dbEmitter = new DatabaseEmitter();

module.exports = dbEmitter;
