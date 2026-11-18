import { useEffect, useRef, useState } from 'react';
import type { Card } from '../types';
import { getWorkspaceId, workspaceUrl } from '../utils/workspaceApi';
import { parseTimer } from '../utils/parseTiming';

interface SourceMetadata { title?: string; favicon?: string }
const requests = new Map<string, Promise<SourceMetadata>>();
let activeRequests = 0;
const waiting: (() => void)[] = [];

export function imageSourceTitle(title?: string, url?: string): string {
  const text = title?.trim();
  if (text && text !== url && !/^(https?:\/\/|www\.)/i.test(text)) return text;
  try { return new URL(url || '').hostname.replace(/^www\./, '') || '网页来源'; }
  catch { return '网页来源'; }
}

export function imageSourceLabel(title?: string, url?: string): string {
  const text = title?.trim();
  let host = '';
  try { host = new URL(url || '').hostname.replace(/^www\./, ''); } catch { /* No source. */ }
  const siteTitle = ['xiaohongshu.com', 'xhslink.com'].includes(host)
    && ['小红书', '小红书你的生活兴趣社区'].includes((text || '').replace(/[\s\-–—|]/g, ''));
  return text && !siteTitle && text !== url && text !== host && text !== `www.${host}`
    && !(host && text.startsWith(`${host}/`)) && !/^(https?:\/\/|www\.)/i.test(text)
    ? text : url || imageSourceTitle(title, url);
}

export function needsImageSourceMetadata(card: Card): boolean {
  if (card.type !== 'image' || !card.url || card.fileSource || card.isParsing || !/^https?:\/\//i.test(card.url)) return false;
  try { if (/\.(png|jpe?g|gif|webp|avif|bmp|svg)$/i.test(new URL(card.url).pathname)) return false; }
  catch { return false; }
  return card.sourceTitleUrl !== card.url || imageSourceLabel(card.title, card.url) === card.url;
}

function sourceMetadata(url: string): Promise<SourceMetadata> {
  const existing = requests.get(url);
  if (existing) return existing;
  const pending = requestSourceMetadata(url);
  if (requests.size >= 200) requests.delete(requests.keys().next().value!);
  requests.set(url, pending);
  void pending.then(metadata => { if (!metadata.title && requests.get(url) === pending) requests.delete(url); });
  return pending;
}

async function requestSourceMetadata(url: string): Promise<SourceMetadata> {
  const dequeued = parseTimer('title_queue');
  if (activeRequests >= 2) await new Promise<void>(resolve => waiting.push(resolve));
  dequeued();
  activeRequests++;
  const finished = parseTimer('web_metadata');
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), 30000);
  return fetch(workspaceUrl(`/api/fetch-metadata?url=${encodeURIComponent(url)}&source_only=true`), { signal: controller.signal })
    .then(async response => {
      if (!response.ok) return {};
      const result = await response.json();
      const title = typeof result.title === 'string' ? result.title.trim() : '';
      return {
        ...(title && imageSourceLabel(title, url) !== url ? { title } : {}),
        ...(typeof result.favicon === 'string' && result.favicon.trim() ? { favicon: result.favicon.trim() } : {}),
      };
    }).catch(() => ({})).finally(() => {
      finished();
      window.clearTimeout(timeout);
      activeRequests--;
      waiting.shift()?.();
    });
}

// Fill existing fields through the normal save path; never replace the image,
// card type, URL or user-created floating heading with scraper output.
export function useImageSourceMetadata(card: Card, onUpdate: (id: string, update: Partial<Card>) => void) {
  const latest = useRef({ card, onUpdate });
  latest.current = { card, onUpdate };
  const [completed, setCompleted] = useState('');
  const key = JSON.stringify([card.id, card.url, card.title]);
  const needed = needsImageSourceMetadata(card);
  useEffect(() => {
    if (!needed) return;
    let active = true;
    const workspace = getWorkspaceId();
    const { id, url, title } = card;
    void sourceMetadata(url!).then(metadata => {
      const current = latest.current.card;
      if (!active) return;
      setCompleted(key);
      if (getWorkspaceId() !== workspace || current.id !== id || current.url !== url || current.type !== 'image'
        || current.title !== title || current.fileSource || current.isParsing) return;
      const update: Partial<Card> = {};
      if (metadata.title) { update.title = metadata.title; update.sourceTitleUrl = url; }
      if (metadata.favicon) update.favicon = metadata.favicon;
      if (Object.keys(update).length) latest.current.onUpdate(id, update);
    });
    return () => { active = false; };
  }, [card.id, card.type, card.url, card.title, card.sourceTitleUrl, card.fileSource, card.isParsing]);
  return needed && completed !== key;
}
