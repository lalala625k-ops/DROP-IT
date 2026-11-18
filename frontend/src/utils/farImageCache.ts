export interface FarImageRequest {
  source: string;
  fallback?: string;
  edge: number;
}

export type FarImageBitmap = HTMLCanvasElement & { sourceWidth: number; sourceHeight: number };

interface Entry {
  request: FarImageRequest;
  bitmap?: FarImageBitmap;
  loading?: HTMLImageElement;
  failed?: boolean;
  triedFallback?: boolean;
  cancel?: () => void;
}

export const FAR_IMAGE_PIXEL_BUDGET = 4 * 1024 * 1024;
export const farImageKey = ({ source, fallback }: FarImageRequest) => JSON.stringify([source, fallback]);

// Display-only cache. Never changes a card's stored image, thumbnail or source.
// Keep every active image at a bounded resolution rather than evicting active
// tiles: an LRU smaller than the viewport would endlessly decode the same set.
export class FarImageCache {
  private entries = new Map<string, Entry>();
  private queue: Entry[] = [];
  private active = 0;
  private paused = false;
  private disposed = false;
  private timer: ReturnType<typeof setTimeout> | undefined;

  constructor(private readonly onReady: () => void) {}

  get(request: FarImageRequest) { return this.entries.get(farImageKey(request))?.bitmap; }

  update(requests: FarImageRequest[]) {
    const desired = new Map<string, FarImageRequest>();
    for (const request of requests) {
      const key = farImageKey(request);
      const previous = desired.get(key);
      if (!previous || previous.edge < request.edge) desired.set(key, request);
    }
    const cap = Math.max(1, Math.min(128, Math.floor(Math.sqrt(FAR_IMAGE_PIXEL_BUDGET / Math.max(1, desired.size)))));
    for (const [key, entry] of this.entries) {
      if (!desired.has(key)) { this.release(entry); this.entries.delete(key); }
    }
    this.queue = [];
    for (const [key, request] of desired) {
      let entry = this.entries.get(key);
      const edge = Math.max(1, Math.min(cap, Math.ceil(request.edge)));
      if (!entry) {
        entry = { request: { ...request, edge } };
        this.entries.set(key, entry);
      } else {
        entry.request.edge = edge;
        // Shrink retained tiles when the active set exceeds the pixel budget.
        // Retain smaller tiles on zoom-in; far mode intentionally stays low-res.
        if (entry.bitmap && Math.max(entry.bitmap.width, entry.bitmap.height) > cap) {
          const old = entry.bitmap;
          entry.bitmap = this.rasterize(old, old.sourceWidth, old.sourceHeight, cap);
          old.width = old.height = 0;
        }
      }
      if (!entry.bitmap && !entry.loading && !entry.failed) this.queue.push(entry);
    }
    this.schedule();
  }

  setPaused(paused: boolean) {
    this.paused = paused;
    if (paused) { clearTimeout(this.timer); this.timer = undefined; }
    else this.schedule();
  }

  dispose() {
    this.disposed = true;
    clearTimeout(this.timer);
    this.queue = [];
    for (const entry of this.entries.values()) this.release(entry);
    this.entries.clear();
  }

  private release(entry: Entry) {
    entry.cancel?.();
    if (entry.bitmap) entry.bitmap.width = entry.bitmap.height = 0;
  }

  private rasterize(image: CanvasImageSource, width: number, height: number, edge: number) {
    const scale = Math.min(1, edge / Math.max(width, height));
    const tile = document.createElement('canvas');
    tile.width = Math.max(1, Math.floor(width * scale));
    tile.height = Math.max(1, Math.floor(height * scale));
    const context = tile.getContext('2d');
    if (!context) throw new Error('Canvas unavailable');
    context.drawImage(image, 0, 0, tile.width, tile.height);
    return Object.assign(tile, { sourceWidth: width, sourceHeight: height });
  }

  private schedule() {
    if (this.disposed || this.paused || this.timer !== undefined || this.active >= 2 || !this.queue.length) return;
    this.timer = setTimeout(() => {
      this.timer = undefined;
      while (!this.paused && this.active < 2 && this.queue.length) {
        const entry = this.queue.shift()!;
        if (this.entries.get(farImageKey(entry.request)) !== entry) continue;
        void this.load(entry);
      }
    }, 16);
  }

  private async load(entry: Entry) {
    this.active++;
    const image = new Image();
    image.decoding = 'async';
    image.referrerPolicy = 'no-referrer';
    entry.loading = image;
    let timeout: ReturnType<typeof setTimeout> | undefined;
    let cancelled = false;
    const cancelledOrTimedOut = new Promise<never>((_, reject) => {
      entry.cancel = () => { cancelled = true; image.src = ''; reject(new Error('Cancelled')); };
      timeout = setTimeout(() => reject(new Error('Image timeout')), 15000);
    });
    try {
      image.src = entry.triedFallback ? entry.request.fallback! : entry.request.source;
      await Promise.race([image.decode(), cancelledOrTimedOut]);
      if (!this.disposed && !cancelled && this.entries.get(farImageKey(entry.request)) === entry) {
        entry.bitmap = this.rasterize(image, image.naturalWidth, image.naturalHeight, entry.request.edge);
        this.onReady();
      }
    } catch {
      if (!cancelled && !this.disposed && entry.request.fallback && !entry.triedFallback) {
        entry.triedFallback = true;
        this.queue.push(entry);
      } else entry.failed = true;
    }
    finally {
      clearTimeout(timeout);
      image.src = '';
      entry.loading = undefined;
      entry.cancel = undefined;
      this.active--;
      this.schedule();
    }
  }
}
