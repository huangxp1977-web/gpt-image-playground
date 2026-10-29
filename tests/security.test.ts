import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { NextRequest } from 'next/server';
import { imageSessionToken, validSessionToken, SESSION_TTL_SECONDS, authorizedImageRequest } from '../src/lib/image-session';
import { boundedBody, createAdmissionLimit, releaseWithResponse, IMAGE_BODY_LIMIT } from '../src/lib/request-limits';
import { assertRuntimeConfig } from '../src/lib/runtime-config';
import { hasUnsavedMask } from '../src/lib/mask-state';
import ts from 'typescript';

process.env.APP_PASSWORD = 'test-only-not-a-deployment-secret';
process.env.OPENAI_API_KEY = 'test-placeholder';
process.env.NEXT_PUBLIC_IMAGE_STORAGE_MODE = 'indexeddb';
const { POST: images } = require('../src/app/api/images/route');
const { POST: remove } = require('../src/app/api/image-delete/route');
const { POST: session } = require('../src/app/api/session/route');
function request(body?: BodyInit | null, cookie = true, headers: Record<string, string> = {}) {
    return new NextRequest('https://localhost/api/images', { method: 'POST', body,
        // Node requires duplex for streaming request bodies.
        ...{ duplex: 'half' }, headers: { ...(cookie ? { cookie: `image-session=${imageSessionToken()}` } : {}), ...headers } });
}
test('images and delete reject unauthenticated before touching any body parser/stream', async () => {
    for (const route of [images, remove]) {
        let reads = 0;
        const req = request(new ReadableStream({ pull() { reads++; throw Error('body read'); } }, { highWaterMark: 0 }), false);
        Object.defineProperty(req, 'formData', { value: () => { throw Error('formData called'); } });
        Object.defineProperty(req, 'json', { value: () => { throw Error('json called'); } });
        const result = await route(req);
        assert.equal(result.status, 401); assert.equal(reads, 0);
    }
});
test('image route preserves mixed-case multipart boundaries', async () => {
    const boundary = 'TestBoundaryAbCdEf';
    const body = [
        `--${boundary}\r\nContent-Disposition: form-data; name="mode"\r\n\r\ngenerate\r\n`,
        `--${boundary}\r\nContent-Disposition: form-data; name="prompt"\r\n\r\nhello\r\n`,
        `--${boundary}\r\nContent-Disposition: form-data; name="model"\r\n\r\ninvalid-test-model\r\n`,
        `--${boundary}--\r\n`
    ].join('');
    const response = await images(request(body, true, { 'content-type': `multipart/form-data; boundary=${boundary}` }));
    assert.equal(response.status, 400); assert.deepEqual(await response.json(), { error: 'Unsupported model: invalid-test-model' });
});
test('image route rejects a file above 10 MiB even within the total body bound', async () => {
    const form = new FormData();
    form.set('image_0', new File([new Uint8Array(10 * 1024 * 1024 + 1)], 'big.png', { type: 'image/png' }));
    assert.equal((await images(request(form))).status, 413);
});
test('JSON admission caps readers at four and recovers after parsing', async () => {
    const finish: (() => void)[] = [];
    const pending = Array.from({ length: 4 }, () => session(request(new ReadableStream({ start(c) { finish.push(() => c.close()); } }))));
    assert.equal((await session(request('null'))).status, 429);
    finish.forEach((close) => close());
    for (const response of await Promise.all(pending)) assert.equal(response.status, 400);
    assert.equal((await session(request('null'))).status, 400);
});
test('signed session expiry, tampering, password rotation, and malformed tokens', () => {
    const now = 1800000000000;
    const token = imageSessionToken(now);
    assert(validSessionToken(token, now));
    assert(!validSessionToken(token, now + SESSION_TTL_SECONDS * 1000));
    assert(!validSessionToken(token.replace('v2.', 'v2.1'), now));
    assert(!validSessionToken(token.slice(0, -1) + (token.endsWith('0') ? '1' : '0'), now));
    for (const bad of [null, '', 'abc', 'f'.repeat(64)]) assert(!validSessionToken(bad, now));
    const old = process.env.APP_PASSWORD; process.env.APP_PASSWORD = 'rotated';
    assert(!validSessionToken(token, now)); process.env.APP_PASSWORD = old;
});
test('bounded reads count actual bytes with missing, chunked, and lying Content-Length; cancel at limit', async () => {
    for (const headers of [{}, { 'transfer-encoding': 'chunked' }, { 'content-length': '1' }] as Record<string, string>[]) {
        let cancelled = false;
        const req = request(new ReadableStream({ pull(c) { c.enqueue(new Uint8Array(5)); }, cancel() { cancelled = true; } }, { highWaterMark: 0 }), true, headers);
        await assert.rejects(boundedBody(req, 8), { status: 413 }); assert(cancelled);
    }
    const body = await boundedBody(request('12345678'), 8); assert.equal(body.size, 8);
    await assert.rejects(boundedBody(request('123456789', true, { 'content-length': '9' }), 8), { status: 413 });
    await assert.rejects(boundedBody(request(new ReadableStream({})), 8, 10), { status: 408 });
});
test('real image route enforces 12 MiB actual stream cap and returns 413', async () => {
    const req = request(new ReadableStream({ pull(c) { c.enqueue(new Uint8Array(1024 * 1024)); } }, { highWaterMark: 0 }), true, { 'content-type': 'multipart/form-data; boundary=x' });
    assert.equal((await images(req)).status, 413);
    assert.equal(IMAGE_BODY_LIMIT, 12 * 1024 * 1024);
});
test('image admission rejects second request before reading it and frees slot on malformed body', async () => {
    let finish!: () => void;
    let started!: () => void;
    const ready = new Promise<void>((resolve) => { started = resolve; });
    const first = images(request(new ReadableStream({ start(c) { finish = () => c.close(); started(); } }), true, { 'content-type': 'multipart/form-data; boundary=x' }));
    await ready;
    let reads = 0;
    const second = await images(request(new ReadableStream({ pull() { reads++; } }, { highWaterMark: 0 })));
    assert.equal(second.status, 429); assert.equal(reads, 0);
    finish(); assert.equal((await first).status, 400);
    assert.equal((await images(request('invalid'))).status, 400);
});
test('SSE admission stays held until body finishes or cancels; release idempotent', async () => {
    for (const cancel of [false, true]) {
        const acquire = createAdmissionLimit(1); const release = acquire();
        let close!: () => void;
        const wrapped = releaseWithResponse(new Response(new ReadableStream({ start(c) { close = () => c.close(); } }), { headers: { 'content-type': 'text/event-stream' } }), release);
        assert.throws(acquire, { status: 429 });
        if (cancel) await wrapped.body!.cancel(); else { close(); await wrapped.text(); }
        release(); const next = acquire(); assert.throws(acquire); next();
    }
});
test('session and delete null/invalid JSON return 400; bounded JSON 413', async () => {
    for (const route of [session, remove]) {
        for (const body of ['null', '[]', '{']) assert.equal((await route(request(body))).status, 400);
        assert.equal((await route(request('x'.repeat(16385)))).status, 413);
    }
    const hash = crypto.createHash('sha256').update(process.env.APP_PASSWORD!).digest('hex');
    const response = await session(request(JSON.stringify({ passwordHash: hash })));
    assert.equal(response.status, 200);
    assert.match(response.headers.get('set-cookie')!, /Path=\/api;/);
    assert.match(response.headers.get('set-cookie')!, /HttpOnly/);
});
test('Docker entrypoint exits before listening when password is absent', () => {
    const result = spawnSync(process.execPath, ['deploy-entrypoint.cjs'], { env: { ...process.env, NODE_ENV: 'production', APP_PASSWORD: '' }, encoding: 'utf8' });
    assert.equal(result.status, 1); assert.match(result.stderr, /APP_PASSWORD must be set/);
});
test('production config fails closed both at startup and authorization', () => {
    const oldNode = process.env.NODE_ENV, oldPassword = process.env.APP_PASSWORD;
    Object.assign(process.env, { NODE_ENV: 'production', APP_PASSWORD: '' });
    assert.throws(assertRuntimeConfig, /APP_PASSWORD/);
    assert.equal(authorizedImageRequest(request(null, false)), false);
    Object.assign(process.env, { APP_PASSWORD: ' ' }); assert.throws(assertRuntimeConfig);
    Object.assign(process.env, { NODE_ENV: oldNode, APP_PASSWORD: oldPassword });
});
// Execute actual component handlers, extracted by the TypeScript AST, without requiring a browser canvas.
const component = readFileSync('src/components/editing-form.tsx', 'utf8');
const ast = ts.createSourceFile('editing-form.tsx', component, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
function handler(name: string) {
    let text = '';
    function visit(node: ts.Node) {
        if (ts.isVariableDeclaration(node) && node.name.getText(ast) === name && node.initializer) text = node.initializer.getText(ast);
        ts.forEachChild(node, visit);
    }
    visit(ast); assert(text, name);
    return ts.transpile(`const handler = ${text}`, { target: ts.ScriptTarget.ES2022 });
}
test('Save Mask then draw again invalidates file and blocks submit even with stale file', () => {
    const state: Record<string, unknown> = { file: { name: 'old.png' }, saved: true, points: [], preview: 'old' };
    const revision = { current: 0 };
    const add = new Function('setEditDrawnPoints', 'editBrushSize', 'maskRevision', 'setEditGeneratedMaskFile', 'setEditIsMaskSaved', 'setEditMaskPreviewUrl', handler('addPoint') + '; return handler;')(
        (fn: (points: unknown[]) => unknown[]) => state.points = fn(state.points as unknown[]), [10], revision,
        (file: unknown) => state.file = file, (saved: boolean) => state.saved = saved, (url: unknown) => state.preview = url);
    add(1, 2); assert.equal(state.file, null); assert.equal(state.saved, false); assert.equal(revision.current, 1);
    let submits = 0, alerts = 0;
    const submit = new Function('imageFiles', 'editDrawnPoints', 'editGeneratedMaskFile', 'editIsMaskSaved', 'hasUnsavedMask', 'alert', 'onSubmit', handler('handleSubmit') + '; return handler;')(
        [{}], state.points, { name: 'stale.png' }, false, hasUnsavedMask, () => alerts++, () => submits++);
    submit({ preventDefault() {} }); assert.equal(submits, 0); assert.equal(alerts, 1);
    assert.equal(hasUnsavedMask(1, true), false); assert.equal(hasUnsavedMask(0, false), false);
});
