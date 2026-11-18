import React, { useEffect, useRef, useState } from 'react';

type ImageProps = Omit<React.ImgHTMLAttributes<HTMLImageElement>, 'src' | 'onError'> & {
  src: string;
  onError?: () => void;
};

// Each keyed node owns its decode lifecycle. A late decode from an old source
// must never hide the fallback belonging to a newer source.
function DecodedImage({ src, onLoad, onError, onReady, style, ...props }: ImageProps & { onReady?: () => void }) {
  const imageRef = useRef<HTMLImageElement>(null);
  const generation = useRef(0);
  const [status, setStatus] = useState<'loading' | 'ready' | 'failed'>('loading');
  useEffect(() => () => { generation.current++; }, []);
  const failed = () => {
    generation.current++;
    setStatus('failed');
    onError?.();
  };
  const loaded = (event: React.SyntheticEvent<HTMLImageElement>) => {
    const image = event.currentTarget;
    const version = ++generation.current;
    onLoad?.(event);
    // `load` means the browser has a usable decoded frame. Waiting for a
    // second decode promise can hang for lazy cross-origin covers on their
    // first request, leaving the card transparent until a refresh warms the
    // browser cache. Promote immediately; decode remains a best-effort warmup.
    if (generation.current !== version || imageRef.current !== image) return;
    setStatus('ready');
    onReady?.();
    void Promise.resolve().then(() => image.decode?.()).catch(() => { /* load already produced a usable frame */ });
  };
  return <img {...props} ref={imageRef} src={src} data-canvas-image
    data-image-ready={status === 'ready' ? 'true' : undefined}
    data-image-terminal={status === 'failed' ? 'true' : undefined}
    style={{ backgroundColor: '#fffefa', ...style, ...(status !== 'ready' ? { opacity: 0 } : {}) }}
    onLoad={loaded} onError={failed} />;
}

// Preserve the actual thumbnail node when promoting to the original, rather
// than changing its src and mounting a fresh copy as a fallback.
export function StableImage({ fallbackSrc, src, alt = '', loading = 'lazy', decoding = 'async',
  draggable = false, style, onLoad, onError, ...props }: ImageProps & { fallbackSrc?: string }) {
  const fallback = fallbackSrc && fallbackSrc !== src ? fallbackSrc : undefined;
  const [promotion, setPromotion] = useState({ src, fallback, ready: false });
  useEffect(() => {
    setPromotion(previous => previous.src === src && previous.fallback === fallback
      ? previous : { src, fallback, ready: false });
  }, [src, fallback]);
  const current = promotion.src === src && promotion.fallback === fallback;
  const promoted = current && promotion.ready;
  const common = { ...props, loading, decoding, draggable };
  return <>
    <DecodedImage {...common} key={fallback || src} src={fallback || src}
      alt={fallback ? '' : alt} aria-hidden={fallback ? true : undefined}
      style={{ ...style, ...(fallback && promoted ? { opacity: 0 } : {}) }}
      onLoad={fallback ? undefined : onLoad} onError={fallback ? undefined : onError} />
    {fallback && <DecodedImage {...common} key={src} src={src} alt={alt}
      style={{ ...style, opacity: promoted ? 1 : 0 }} onLoad={onLoad} onError={onError}
      onReady={() => setPromotion({ src, fallback, ready: true })} />}
  </>;
}
