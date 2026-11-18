import { useEffect, useRef } from 'react';
import type { Card } from '../types';
import { fetchLinkMetadata, type LinkMetadata } from '../utils/linkMetadata';
import { linkCardDetail, videoCardPlatform } from '../utils/linkCardDetail';
import { getWorkspaceId } from '../utils/workspaceApi';

const requests = new Map<string, Promise<LinkMetadata>>();
const waiting: (() => void)[] = [];
let activeRequests = 0;

export function needsVideoCardDetails(card: Card) {
  return card.type === 'web' && !!videoCardPlatform(card.url) && !card.isParsing
    && (!card.author?.trim() || !linkCardDetail(card).tooltip);
}

async function requestDetails(url: string) {
  if (activeRequests >= 2) await new Promise<void>(resolve => waiting.push(resolve));
  activeRequests++;
  try { return await fetchLinkMetadata(url, () => {}); }
  catch { return {}; }
  finally { activeRequests--; waiting.shift()?.(); }
}

function details(workspace: string, url: string) {
  const key = JSON.stringify([workspace, url]);
  const existing = requests.get(key);
  if (existing) return existing;
  const pending = requestDetails(url);
  // Keep failures too: remounting a card must not cause a retry loop.
  if (requests.size >= 200) requests.delete(requests.keys().next().value!);
  requests.set(key, pending);
  return pending;
}

export function videoCardDetailUpdates(current: Card, original: Card, metadata: LinkMetadata): Partial<Card> {
  if (current.id !== original.id || current.type !== 'web' || current.url !== original.url || current.isParsing) return {};
  const updates: Partial<Card> = {};
  const author = metadata.author?.trim();
  const description = metadata.description?.trim();
  if (!current.author?.trim() && author) updates.author = author;
  if (!linkCardDetail(current).tooltip && current.description === original.description && description
    && linkCardDetail({ ...current, description }).tooltip) updates.description = description;
  return updates;
}

// Upgrade old video cards through their normal save callback. This only fills
// missing author/synopsis fields and never changes a title, cover or geometry.
export function useVideoCardDetails(card: Card, onUpdate: (id: string, update: Partial<Card>) => void) {
  const latest = useRef({ card, onUpdate });
  latest.current = { card, onUpdate };
  const needed = needsVideoCardDetails(card);
  useEffect(() => {
    if (!needed || !card.url) return;
    let active = true;
    const workspace = getWorkspaceId();
    void details(workspace, card.url).then(metadata => {
      if (!active || getWorkspaceId() !== workspace) return;
      const updates = videoCardDetailUpdates(latest.current.card, card, metadata);
      if (Object.keys(updates).length) latest.current.onUpdate(card.id, updates);
    });
    return () => { active = false; };
  }, [card.id, card.type, card.url, card.isParsing, needed]);
}
