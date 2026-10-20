// Conservative per-process admission for the small deployment host, not a memory-safety guarantee.
export const IMAGE_BODY_LIMIT = 12 * 1024 * 1024;
export const IMAGE_FILE_LIMIT = 10 * 1024 * 1024;
export const JSON_BODY_LIMIT = 16 * 1024;
export class RequestLimitError extends Error {
    constructor(message: string, public status: number) { super(message); }
}
export function createAdmissionLimit(max: number) {
    let active = 0;
    return () => {
        if (active >= max) throw new RequestLimitError('Server busy; retry after the active request finishes.', 429);
        active++;
        let released = false;
        return () => { if (!released) { released = true; active--; } };
    };
}
export const admitImage = createAdmissionLimit(1);
export const admitJSON = createAdmissionLimit(4);
export async function boundedBody(request: Request, limit: number, timeoutMs = 15000): Promise<Blob> {
    const declared = request.headers.get('content-length');
    if (declared && (!/^\d+$/.test(declared) || Number(declared) > limit)) {
        void request.body?.cancel().catch(() => {});
        throw new RequestLimitError(`Request body exceeds ${limit} bytes or has invalid Content-Length.`, 413);
    }
    if (!request.body) return new Blob([]);
    const reader = request.body.getReader();
    const chunks: Uint8Array<ArrayBuffer>[] = [];
    let size = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const deadline = new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
            reject(new RequestLimitError('Request body timed out.', 408));
            void reader.cancel().catch(() => {});
        }, timeoutMs);
    });
    try {
        while (true) {
            const { done, value } = await Promise.race([reader.read(), deadline]);
            if (done) break;
            size += value.byteLength;
            if (size > limit) throw new RequestLimitError(`Request body exceeds ${limit} bytes.`, 413);
            chunks.push(new Uint8Array(value));
        }
        return new Blob(chunks, { type: request.headers.get('content-type') || '' });
    } catch (error) {
        void reader.cancel().catch(() => {});
        throw error;
    } finally {
        clearTimeout(timer);
        reader.releaseLock();
    }
}
export async function boundedJSON(request: Request): Promise<unknown> {
    try { return JSON.parse(await (await boundedBody(request, JSON_BODY_LIMIT)).text()); }
    catch (error) {
        if (error instanceof RequestLimitError) throw error;
        throw new RequestLimitError('Invalid JSON body.', 400);
    }
}
export function requestError(error: unknown): Response {
    return Response.json({ error: error instanceof RequestLimitError ? error.message : 'Invalid request body.' },
        { status: error instanceof RequestLimitError ? error.status : 400 });
}
// Keep the slot until SSE completion/cancellation, not merely until response headers exist.
export function releaseWithResponse(response: Response, release: () => void): Response {
    if (!response.body || !response.headers.get('content-type')?.includes('text/event-stream')) {
        release(); return response;
    }
    const reader = response.body.getReader();
    return new Response(new ReadableStream({
        async pull(controller) {
            try {
                const result = await reader.read();
                if (result.done) { release(); controller.close(); }
                else controller.enqueue(result.value);
            } catch (error) { release(); controller.error(error); }
        },
        async cancel(reason) { try { await reader.cancel(reason); } finally { release(); } }
    }), { status: response.status, headers: response.headers });
}
