'use strict';
for (const name of ['APP_PASSWORD', 'OPENAI_API_KEY', 'OPENAI_API_BASE_URL']) {
    if (!process.env[name]?.trim()) {
        console.error(`${name} must be set in production`);
        process.exit(1);
    }
    if (/^(REPLACE_WITH_|build-placeholder|test-placeholder)/i.test(process.env[name].trim())) {
        console.error(`${name} must not be a placeholder`);
        process.exit(1);
    }
}
if (process.env.OPENAI_API_BASE_URL !== 'https://newapi.aesthmed.cn/v1') {
    console.error('OPENAI_API_BASE_URL must point to the approved NewAPI gateway');
    process.exit(1);
}
process.umask(0o077);
require('./server.js');
