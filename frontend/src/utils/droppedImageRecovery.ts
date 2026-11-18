// Only recover the exact image carried by a drag. The webpage is never queried.
const MAX_BYTES = 12 * 1024 * 1024;

export async function readDroppedImageFile(source: string): Promise<File | null> {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), 8000);
  try {
    const response = await fetch(source, { signal: controller.signal, credentials: 'omit', referrerPolicy: 'no-referrer' });
    if (!response.ok || Number(response.headers.get('content-length')) > MAX_BYTES) return null;
    const reader = response.body?.getReader();
    if (!reader) return null;
    const chunks: ArrayBuffer[] = [];
    let size = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_BYTES) { await reader.cancel(); return null; }
      chunks.push(new Uint8Array(value).buffer);
    }
    if (!size) return null;
    const type = response.headers.get('content-type')?.split(';')[0] || 'application/octet-stream';
    return new File(chunks, 'dragged-image', { type });
  } catch {
    // CORS can block reading bytes even when the browser can display the image.
    return null;
  } finally {
    controller.abort();
    window.clearTimeout(timer);
  }
}

export function readableDroppedImage(source: string): Promise<{ width: number; height: number } | null> {
  return new Promise(resolve => {
    const image = new Image();
    const finish = (size: { width: number; height: number } | null) => {
      window.clearTimeout(timer);
      image.onload = image.onerror = null;
      resolve(size);
    };
    const timer = window.setTimeout(() => finish(null), 8000);
    image.referrerPolicy = 'no-referrer';
    image.onload = () => finish(image.naturalWidth && image.naturalHeight
      ? { width: image.naturalWidth, height: image.naturalHeight } : null);
    image.onerror = () => finish(null);
    image.src = source;
  });
}
