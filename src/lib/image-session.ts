import crypto from 'crypto';
import type { NextRequest } from 'next/server';

export const SESSION_TTL_SECONDS = 86400;
export function validPasswordHash(value: unknown): boolean {
    if (!process.env.APP_PASSWORD || typeof value !== 'string' || !/^[a-f0-9]{64}$/.test(value)) return false;
    const expected = crypto.createHash('sha256').update(process.env.APP_PASSWORD).digest();
    return crypto.timingSafeEqual(Buffer.from(value, 'hex'), expected);
}
export function imageSessionToken(now = Date.now()): string {
    if (!process.env.APP_PASSWORD) throw new Error('APP_PASSWORD is required to issue sessions');
    const payload = `v2.${Math.floor(now / 1000) + SESSION_TTL_SECONDS}.${crypto.randomBytes(16).toString('hex')}`;
    return `${payload}.${crypto.createHmac('sha256', process.env.APP_PASSWORD).update(payload).digest('hex')}`;
}
export function validSessionToken(value: unknown, now = Date.now()): boolean {
    if (!process.env.APP_PASSWORD || typeof value !== 'string') return false;
    const match = /^(v2\.(\d{10})\.[a-f0-9]{32})\.([a-f0-9]{64})$/.exec(value);
    if (!match) return false;
    const expected = crypto.createHmac('sha256', process.env.APP_PASSWORD).update(match[1]).digest();
    const validSignature = crypto.timingSafeEqual(Buffer.from(match[3], 'hex'), expected);
    const seconds = Math.floor(now / 1000);
    return validSignature && Number(match[2]) > seconds && Number(match[2]) <= seconds + SESSION_TTL_SECONDS;
}
export function authorizedImageRequest(request: NextRequest): boolean {
    if (!process.env.APP_PASSWORD) return process.env.NODE_ENV !== 'production';
    return validSessionToken(request.cookies.get('image-session')?.value);
}
