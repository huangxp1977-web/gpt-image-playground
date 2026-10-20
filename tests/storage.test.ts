import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { NextRequest } from 'next/server';

// Runs in its own test process; all files stay in the configured scratch directory.
process.env.IMAGE_STORAGE_DIR = path.join(os.tmpdir(), `image-playground-regression-${process.pid}`);
process.env.APP_PASSWORD = 'local-test-only';
const { outputDir }: { outputDir: string } = require('../src/lib/image-storage');
const { imageSessionToken } = require('../src/lib/image-session');
const { GET } = require('../src/app/api/image/[filename]/route');
const { POST } = require('../src/app/api/image-delete/route');
test('explicit persistent storage is shared by download/delete and ignores cwd', async () => {
    assert.equal(outputDir, process.env.IMAGE_STORAGE_DIR);
    await fs.mkdir(outputDir, { mode: 0o700 });
    try {
        await fs.writeFile(path.join(outputDir, '123-0.png'), 'test-png-bytes', { mode: 0o600 });
        const headers = { cookie: `image-session=${imageSessionToken()}` };
        const response = await GET(new NextRequest('https://localhost/api/image/123-0.png', { headers }), { params: Promise.resolve({ filename: '123-0.png' }) });
        assert.equal(response.status, 200); assert.equal(await response.text(), 'test-png-bytes');
        const deleted = await POST(new NextRequest('https://localhost/api/image-delete', { method: 'POST', headers, body: JSON.stringify({ filenames: ['123-0.png'] }) }));
        assert.equal(deleted.status, 200);
        await assert.rejects(fs.access(path.join(outputDir, '123-0.png')));
    } finally { await fs.rm(outputDir, { recursive: true, force: true }); }
});
