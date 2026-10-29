import assert from 'node:assert/strict';
import test from 'node:test';
import { downloadOriginalImage, validateImageDownloadSource } from '../src/lib/image-download';

const origin = 'https://images.example';
test('original URLs allow only local image routes or raster data and same-origin blobs', () => {
    assert.equal(validateImageDownloadSource('/api/image/test.png', origin), `${origin}/api/image/test.png`);
    assert.equal(validateImageDownloadSource(`${origin}/api/image/test.webp`, origin), `${origin}/api/image/test.webp`);
    assert.equal(validateImageDownloadSource(`blob:${origin}/fixture`, origin), `blob:${origin}/fixture`);
    assert.equal(validateImageDownloadSource('data:image/png;base64,aGVsbG8=', origin), 'data:image/png;base64,aGVsbG8=');
    for (const source of ['javascript:alert(1)', 'https://evil.example/a.png', '//evil.example/a.png', 'blob:https://evil.example/a', 'data:text/html,hi', 'data:image/svg+xml,<svg/>', '/api/session', '/api/image/a.png?key=secret', '/api/image/../session', '/api/image/a%2fb.png', 'https://user:pass@images.example/api/image/a.png']) {
        assert.throws(() => validateImageDownloadSource(source, origin), { name: 'Error' }, source);
    }
});

test('actual download helper preserves cookies, blocks redirects, cleans anchor and defers revocation', async (t) => {
    const anchor = { href: '', download: '', style: { display: '' }, click: () => { clicks++; }, remove: () => { removed++; } };
    let clicks = 0, removed = 0, fetches = 0;
    let scheduled: (() => void) | undefined;
    let revoked = '';
    const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'document');
    Object.defineProperty(globalThis, 'document', { configurable: true, value: { createElement: () => anchor, body: { appendChild: (a: unknown) => assert.equal(a, anchor) } } });
    t.after(() => { if (descriptor) Object.defineProperty(globalThis, 'document', descriptor); else Reflect.deleteProperty(globalThis, 'document'); });
    t.mock.method(URL, 'createObjectURL', () => 'blob:fixture');
    t.mock.method(URL, 'revokeObjectURL', (value: string) => { revoked = value; });
    t.mock.method(globalThis, 'setTimeout', (callback: () => void, delay: number) => {
        assert.ok(delay >= 30_000);
        scheduled = callback;
        return 1;
    });
    const signal = new AbortController().signal;
    t.mock.method(globalThis, 'fetch', async (url: string, options: RequestInit) => {
        fetches++;
        assert.equal(url, `${origin}/api/image/test.png`);
        assert.equal(options.credentials, 'same-origin');
        assert.equal(options.redirect, 'error');
        assert.equal(options.signal, signal);
        assert.equal(options.headers, undefined);
        return new Response(new Blob(['fixture'], { type: 'image/png' }));
    });
    await assert.rejects(downloadOriginalImage('https://evil.example/a', 'a', { origin }));
    assert.equal(fetches, 0);
    await downloadOriginalImage('/api/image/test.png', '../test.png', { origin, signal });
    assert.equal(clicks, 1);
    assert.equal(removed, 1);
    assert.equal(anchor.download, '.._test.png');
    assert.equal(revoked, '');
    assert.ok(scheduled);
    scheduled();
    assert.equal(revoked, 'blob:fixture');
});

test('actual download helper reports HTTP, invalid MIME and cancellation without saving', async (t) => {
    let response = new Response('denied', { status: 401 });
    t.mock.method(globalThis, 'fetch', async () => response);
    await assert.rejects(downloadOriginalImage('/api/image/test.png', 'test.png', { origin }), /401/);
    for (const type of ['text/html', 'image/svg+xml', 'application/json']) {
        response = new Response('not raster', { headers: { 'content-type': type } });
        await assert.rejects(downloadOriginalImage('/api/image/test.png', 'test.png', { origin }), /supported raster/);
    }
    response = new Response(new Blob(['fixture'], { type: 'image/png' }));
    const controller = new AbortController();
    controller.abort();
    await assert.rejects(downloadOriginalImage('/api/image/test.png', 'test.png', { origin, signal: controller.signal }), /cancelled/);
});
