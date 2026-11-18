import type { Card, Group, Rect } from '../types';
import { IMAGE_SOURCE_HEIGHT } from './cardLayout';
import { memberFrame } from './bundleCollapseAnchor';

export function bundleStackMembers(members: Card[], group: Group): Card[] {
  const byId = new Map(members.map(card => [card.id, card]));
  const ordered: Card[] = [];
  for (const id of group.collapsedCardOrder || []) {
    const card = byId.get(id);
    if (card) { ordered.push(card); byId.delete(id); }
  }
  ordered.push(...[...byId.values()].sort((a, b) => b.zIndex - a.zIndex));
  return ordered;
}

export function bringBundleCardToFront(members: Card[], group: Group, cardId: string) {
  const ordered = bundleStackMembers(members, group);
  if (!ordered.some(card => card.id === cardId)) return group.collapsedCardOrder || [];
  return [cardId, ...ordered.filter(card => card.id !== cardId).map(card => card.id)];
}

export function bundleStackLayout(members: Card[], group: Group) {
  const ordered = bundleStackMembers(members, group);
  const scale = (group.outlinePadding ?? 18) / 18;
  const titleHeight = IMAGE_SOURCE_HEIGHT * scale;
  const stepX = titleHeight / 3;
  const pad = group.outlinePadding ?? 18;
  const right = group.x + group.width - pad;
  const bottom = group.y + group.height - pad;
  const layers = Math.max(0, ordered.length - 1);
  // Preserve each member's dimensions; only its bottom/right edges advance.
  const pages = ordered.map((card, index) => ({
    card,
    x: right - card.width - (layers - index) * stepX,
    y: bottom - card.height - (layers - index) * titleHeight,
    width: card.width,
    height: card.height,
  }));
  const left = pages.length ? Math.min(...pages.map(page => page.x)) - pad : group.x;
  const top = pages.length ? Math.min(...pages.map(page => page.y)) - pad : group.y;
  const bounds: Rect = { x: left, y: top,
    width: group.x + group.width - left, height: group.y + group.height - top };
  return { pages, bounds, titleHeight, scale };
}

/** Compact original rows/columns without changing stored card geometry. */
export function bundleTitleLayout(members: Card[], group: Group) {
  const scale = (group.outlinePadding ?? 18) / 18;
  const titleHeight = IMAGE_SOURCE_HEIGHT * scale;
  const pad = group.outlinePadding ?? 18;
  const gap = 4 * scale;
  const ys = [...new Set(members.map(card => card.y))].sort((a, b) => a - b);
  const compactX = new Map<number, number>();
  // Remove only empty horizontal bands. Overlapping horizontal spans carry
  // intentional offsets (e.g. a lower-left card and an upper-right card);
  // ranking their left edges would incorrectly flatten them into one column.
  let occupiedRight: number | undefined;
  let removedSpace = 0;
  for (const card of [...members].sort((a, b) => a.x - b.x || b.width - a.width)) {
    if (occupiedRight !== undefined && card.x > occupiedRight) {
      removedSpace += Math.max(0, card.x - occupiedRight - gap);
    }
    compactX.set(card.x, card.x - removedSpace);
    occupiedRight = Math.max(occupiedRight ?? card.x, card.x + card.width);
  }
  const compactY = new Map(ys.map((y, index) => [y, ys[0] + index * (titleHeight + gap)]));
  const pages = members.map((card) => ({
    card,
    x: compactX.get(card.x)!,
    y: compactY.get(card.y)!,
    width: card.width,
    height: titleHeight,
  }));
  if (!pages.length) return { pages, bounds: { ...group }, titleHeight, scale };
  const frame = memberFrame(members, group);
  const anchor = group.collapsedAnchor ?? 'nw';
  const dx = anchor.endsWith('e')
    ? frame.x + frame.width - Math.max(...pages.map(page => page.x + page.width))
    : frame.x - Math.min(...pages.map(page => page.x));
  const dy = anchor.startsWith('s')
    ? frame.y + frame.height - Math.max(...pages.map(page => page.y + page.height))
    : frame.y - Math.min(...pages.map(page => page.y));
  for (const page of pages) { page.x += dx; page.y += dy; }
  const left = Math.min(...pages.map(page => page.x)) - pad;
  const top = Math.min(...pages.map(page => page.y)) - pad;
  const right = Math.max(...pages.map(page => page.x + page.width)) + pad;
  const bottom = Math.max(...pages.map(page => page.y + page.height)) + pad;
  return { pages, bounds: { ...group, x: left, y: top, width: right - left, height: bottom - top }, titleHeight, scale };
}
