import crypto from 'crypto';
import { NextRequest } from 'next/server';

export function validPasswordHash(value: unknown): boolean {
    if (!process.env.APP_PASSWORD || typeof value !== 'string' || !/^[a-f0-9]{64}$/.test(value)) return false;
    const expected = crypto.createHash('sha256').update(process.env.APP_PASSWORD).digest();
    return crypto.timingSafeEqual(Buffer.from(value, 'hex'), expected);
}

export function imageSessionToken(): string {
    return crypto.createHmac('sha256', process.env.APP_PASSWORD || '').update('image-download-session-v1').digest('hex');
}

export function authorizedImageRequest(request: NextRequest): boolean {
    if (!process.env.APP_PASSWORD) return true;
    const value = request.cookies.get('image-session')?.value;
    return typeof value === 'string' && /^[a-f0-9]{64}$/.test(value) &&
        crypto.timingSafeEqual(Buffer.from(value, 'hex'), Buffer.from(imageSessionToken(), 'hex'));
}
