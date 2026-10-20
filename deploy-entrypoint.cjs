'use strict';
if (!process.env.APP_PASSWORD?.trim()) {
    console.error('APP_PASSWORD must be set in production');
    process.exit(1);
}
process.umask(0o077);
require('./server.js');
