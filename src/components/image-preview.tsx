'use client';

import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { downloadOriginalImage, validateImageDownloadSource } from '@/lib/image-download';
import { cn } from '@/lib/utils';
import { Download, Expand, Loader2 } from 'lucide-react';
import Image from 'next/image';
import * as React from 'react';

type ImagePreviewProps = {
    src: string;
    filename: string;
    alt: string;
    children?: React.ReactNode;
    className?: string;
};

export function ImagePreview(props: ImagePreviewProps) {
    return <ImagePreviewInstance key={props.src} {...props} />;
}

function ImagePreviewInstance({ src, filename, alt, children, className }: ImagePreviewProps) {
    const [open, setOpen] = React.useState(false);
    const [busy, setBusy] = React.useState(false);
    const [error, setError] = React.useState<string | null>(null);
    const mounted = React.useRef(false);
    const pending = React.useRef<AbortController | null>(null);
    const busyRef = React.useRef(false);
    React.useEffect(() => {
        mounted.current = true;
        return () => {
            mounted.current = false;
            pending.current?.abort();
            pending.current = null;
            busyRef.current = false;
        };
    }, []);

    let safeSource: string | null = null;
    if (typeof window !== 'undefined') {
        try { safeSource = validateImageDownloadSource(src); } catch { /* Report on activation, never load invalid URLs. */ }
    }
    function changeOpen(next: boolean) {
        if (!next) { setOpen(false); return; }
        try {
            validateImageDownloadSource(src);
            setError(null);
            setOpen(true);
        } catch (cause) {
            setError(cause instanceof Error ? cause.message : 'Invalid image URL.');
            setOpen(false);
        }
    }
    async function download() {
        if (busyRef.current) return;
        busyRef.current = true;
        const controller = new AbortController();
        pending.current = controller;
        const isCurrent = () => mounted.current && pending.current === controller;
        setBusy(true);
        setError(null);
        try {
            await downloadOriginalImage(src, filename, { signal: controller.signal });
        } catch (cause) {
            if (isCurrent() && !controller.signal.aborted) setError(cause instanceof Error ? cause.message : 'Image download failed.');
        } finally {
            if (isCurrent()) {
                pending.current = null;
                busyRef.current = false;
                setBusy(false);
            }
        }
    }
    const hasChildren = children !== undefined && children !== null;
    return (
        <div className={cn('relative min-h-0 min-w-0', className)}>
            {children}
            <Dialog open={open && !!safeSource} onOpenChange={changeOpen}>
                <DialogTrigger asChild>
                    <Button type='button' variant='ghost' aria-label={`Preview ${filename}`}
                        className={hasChildren ? 'absolute inset-0 z-10 h-full w-full rounded-[inherit] p-0 focus-visible:ring-inset' : 'h-auto max-w-full justify-start gap-2 whitespace-normal text-left text-white'}>
                        {hasChildren ? <span className='absolute right-2 bottom-2 rounded-md bg-black/70 p-2 text-white'><Expand className='h-4 w-4' aria-hidden='true' /></span>
                            : <><Expand className='h-4 w-4 shrink-0' aria-hidden='true' /><span className='break-all'>Preview / download {filename}</span></>}
                    </Button>
                </DialogTrigger>
                <DialogContent className='max-h-[95dvh] w-[95vw] overflow-y-auto border-neutral-700 bg-neutral-900 text-white sm:max-w-[90vw]'>
                    <DialogHeader>
                        <DialogTitle>Full-size preview</DialogTitle>
                        <DialogDescription className='break-all text-neutral-400'>{filename}</DialogDescription>
                    </DialogHeader>
                    {open && safeSource && <Image src={safeSource} alt={alt} width={2048} height={2048} unoptimized className='h-[65dvh] w-full object-contain' onError={() => setError('Unable to load the original image.')} />}
                    <Button type='button' variant='secondary' onClick={download} disabled={busy} aria-busy={busy}>
                        {busy ? <Loader2 className='mr-2 h-4 w-4 animate-spin' aria-hidden='true' /> : <Download className='mr-2 h-4 w-4' aria-hidden='true' />}
                        {busy ? 'Downloading original…' : 'Download original'}
                    </Button>
                    {error && <p role='alert' className='break-words text-sm text-red-400'>{error}</p>}
                </DialogContent>
            </Dialog>
            {error && !open && <p role='alert' className={cn('break-words text-sm text-red-400', hasChildren && 'absolute inset-x-0 bottom-0 z-20 bg-black/95 p-2')}>{error}</p>}
        </div>
    );
}
