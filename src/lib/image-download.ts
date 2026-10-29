export function validateImageDownloadSource(source: string, origin: string = window.location.origin): string {
    if (!source || source !== source.trim() || /[\u0000-\u0020\u007f\\]/.test(source)) throw new Error('Invalid image URL.');
    const base = new URL(origin);
    if (!/^https?:$/.test(base.protocol)) throw new Error('Invalid application origin.');
    if (source.startsWith('data:')) {
        if (!/^data:image\/(?:png|jpeg|webp|gif|avif);base64,[A-Za-z0-9+/]+={0,2}$/.test(source)) throw new Error('Unsupported image data URL.');
        return source;
    }
    const url = new URL(source, base.origin);
    if (url.username || url.password || source.includes('?') || source.includes('#')) throw new Error('Image URL must not contain credentials, queries, or fragments.');
    if (url.protocol === 'blob:') {
        const inner = new URL(source.slice(5));
        if (url.origin !== base.origin || inner.origin !== base.origin || inner.username || inner.password || !/^https?:$/.test(inner.protocol) || !inner.pathname || inner.pathname === '/') throw new Error('Invalid image blob URL.');
        return url.href;
    }
    if (!/^https?:$/.test(url.protocol) || url.origin !== base.origin) throw new Error('Image URL must be same-origin.');
    // Inspect the original path before URL normalization can remove dot segments.
    const rawPath = source.startsWith('/') && !source.startsWith('//')
        ? source
        : source.startsWith(`${base.origin}/`) ? source.slice(base.origin.length) : '';
    const match = /^\/api\/image\/([^/]+)$/.exec(rawPath);
    if (!match) throw new Error('Invalid image endpoint.');
    let filename: string;
    try { filename = decodeURIComponent(match[1]); } catch { throw new Error('Invalid image filename.'); }
    if (!filename || /[/%\\\u0000-\u001f\u007f]/.test(filename) || filename.includes('..') || filename === '.') throw new Error('Invalid image filename.');
    return url.href;
}

export async function downloadOriginalImage(
    source: string,
    filename: string,
    options: { signal?: AbortSignal; origin?: string } = {}
): Promise<void> {
    const url = validateImageDownloadSource(source, options.origin ?? window.location.origin);
    const response = await fetch(url, { credentials: 'same-origin', redirect: 'error', signal: options.signal });
    if (!response.ok) throw new Error(`Image download failed (${response.status}).`);
    const mime = response.headers.get('content-type')?.split(';')[0].trim().toLowerCase();
    if (!mime || !/^image\/(png|jpeg|webp|gif|avif)$/.test(mime)) throw new Error('The response is not a supported raster image.');
    const blob = await response.blob();
    if (options.signal?.aborted) throw new DOMException('Download cancelled.', 'AbortError');
    const objectURL = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    try {
        anchor.href = objectURL;
        anchor.download = filename.replace(/[\\/\u0000-\u001f\u007f]/g, '_') || 'image';
        anchor.style.display = 'none';
        document.body.appendChild(anchor);
        anchor.click();
    } finally {
        anchor.remove();
        setTimeout(() => URL.revokeObjectURL(objectURL), 60_000);
    }
}
