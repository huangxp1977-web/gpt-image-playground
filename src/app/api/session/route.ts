import { NextRequest, NextResponse } from 'next/server';
import { validPasswordHash, imageSessionToken } from '@/lib/image-session';

export async function POST(request: NextRequest) {
    const origin = request.headers.get('origin');
    if (origin && origin !== request.nextUrl.origin && origin !== 'https://image.aesthmed.cn') {
        return NextResponse.json({ error: 'Forbidden origin' }, { status: 403 });
    }
    let body;
    try { body = await request.json(); } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }
    if (!validPasswordHash(body.passwordHash)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    const response = NextResponse.json({ authenticated: true });
    response.cookies.set('image-session', imageSessionToken(), {
        httpOnly: true, secure: true, sameSite: 'strict', path: '/api/image', maxAge: 86400
    });
    response.headers.set('Cache-Control', 'no-store');
    return response;
}
