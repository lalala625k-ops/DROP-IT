import { workspaceUrl } from './workspaceApi';
import type { Card } from '../types';
import { parseTimer } from './parseTiming';

export interface CachedImage {
  image: string;
  thumbnail?: string;
  width?: number;
  height?: number;
}

export function isRemoteImageUrl(source?: string): source is string {
  if (!source || isLocalImageUrl(source) || !/^(https?:\/\/|\/\/)/i.test(source)) return false;
  try {
    const url = new URL(source, window.location.href);
    return /^https?:$/.test(url.protocol);
  } catch {
    return false;
  }
}

export function isLocalImageUrl(source?: string): boolean {
  if (!source) return false;
  try {
    const url = new URL(source, window.location.href);
    return url.origin === window.location.origin && /^\/api\/(assets|screenshots|thumbnails)\//.test(url.pathname);
  } catch {
    return false;
  }
}

export async function cacheRemoteImage(source: string, referer?: string): Promise<CachedImage | null> {
  if (isLocalImageUrl(source)) return { image: workspaceUrl(source) };
  if (!isRemoteImageUrl(source)) return null;
  const endpoint = workspaceUrl('/api/cache-remote-image');
  const url = new URL(source, window.location.href).href;
  const key = JSON.stringify([endpoint, url, referer]);
  const pending = inFlight.get(key);
  if (pending) return pending;
  const operation = downloadImage(endpoint, url, referer);
  inFlight.set(key, operation);
  try { return await operation; }
  finally { inFlight.delete(key); }
}

const inFlight = new Map<string, Promise<CachedImage | null>>();
let active = 0;
const queue: (() => void)[] = [];

async function downloadImage(endpoint: string, source: string, referer?: string): Promise<CachedImage | null> {
  const dequeued = parseTimer('image_queue');
  if (active >= 2) await new Promise<void>(resolve => queue.push(resolve));
  dequeued();
  active++;
  const finished = parseTimer('image_download');
  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: source, referer }),
      signal: AbortSignal.timeout(20000),
    });
    if (!response.ok) {
      console.warn('[image-cache]', { host: new URL(source).hostname, stage: 'response', status: response.status });
      return null;
    }
    const asset = await response.json();
    if (!asset.success || typeof asset.url !== 'string' || !asset.url.startsWith('/api/assets/')) return null;
    return {
      // The API scopes URLs to the owning board before returning them.
      image: workspaceUrl(asset.url),
      thumbnail: typeof asset.thumbnail_url === 'string' ? workspaceUrl(asset.thumbnail_url) : undefined,
      width: typeof asset.width === 'number' ? asset.width : undefined,
      height: typeof asset.height === 'number' ? asset.height : undefined,
    };
  } catch (error) {
    console.warn('[image-cache]', { host: new URL(source).hostname, stage: 'request',
      error: error instanceof Error ? error.name : 'UnknownError' });
    return null;
  } finally {
    finished();
    active--;
    queue.shift()?.();
  }
}

export async function migrateRemoteImageCards(cards: Card[]): Promise<Map<string, CachedImage>> {
  const updates = new Map<string, CachedImage>();
  const candidates = cards.filter((card) => isRemoteImageUrl(card.image));
  const results = await Promise.all(candidates.map(async (card) => ({
    id: card.id,
    image: await cacheRemoteImage(card.image!, card.url),
  })));
  results.forEach(({ id, image }) => { if (image) updates.set(id, image); });
  return updates;
}
