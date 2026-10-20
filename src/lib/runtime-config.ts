export function assertRuntimeConfig() {
    if (process.env.NODE_ENV === 'production' && !process.env.APP_PASSWORD?.trim()) {
        throw new Error('APP_PASSWORD must be set in production');
    }
}
