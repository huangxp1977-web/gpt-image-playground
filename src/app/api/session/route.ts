import { NextRequest, NextResponse } from 'next/server';
import { validPasswordHash, imageSessionToken, SESSION_TTL_SECONDS } from '@/lib/image-session';
import { admitJSON, boundedJSON, requestError } from '@/lib/request-limits';

export async function POST(request: NextRequest) {
    const origin = request.headers.get('origin');
    if (origin && origin !== request.nextUrl.origin) return NextResponse.json({ error: 'Forbidden origin' }, { status: 403 });
    let release;
    try { release = admitJSON(); } catch (error) { return requestError(error); }
    try {
        const body = await boundedJSON(request);
        if (!body || typeof body !== 'object' || Array.isArray(body)) return NextResponse.json({ error: 'Expected JSON object' }, { status: 400 });
        if (!validPasswordHash((body as { passwordHash?: unknown }).passwordHash)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        const response = NextResponse.json({ authenticated: true });
        response.cookies.set('image-session', imageSessionToken(), {
            httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'strict', path: '/api', maxAge: SESSION_TTL_SECONDS
        });
        response.headers.set('Cache-Control', 'no-store');
        return response;
    } catch (error) { return requestError(error); }
    finally { release(); }
}
