'use strict';

const { createServer } = require('./dashboard/server');

const port = parseInt(process.env.PORT || '8080', 10);
createServer(port);
