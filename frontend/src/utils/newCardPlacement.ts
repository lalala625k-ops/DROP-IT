import type { Card, Group, Rect } from '../types';
import { cardVisualBounds } from './cardBounds';
import { bundleDisplayBounds } from './bundleGeometry';
import { buildOriginGeometries, originEnvelope } from './originGeometry';

/** Find the closest free top-left position without moving existing objects. */
export function nearestFreePosition(rect: Rect, obstacles: Rect[], gap = 5) {
  // Each obstacle forbids an open rectangle of possible top-left positions.
  // The nearest free point has either the original x or an obstacle boundary x.
  const blocked = obstacles.filter(item => item.width > 0 && item.height > 0).map(item => ({
    left: item.x - rect.width - gap, right: item.x + item.width + gap,
    top: item.y - rect.height - gap, bottom: item.y + item.height + gap,
  }));
  const xs = [...new Set([rect.x, ...blocked.flatMap(item => [item.left, item.right])])]
    .sort((a, b) => Math.abs(a - rect.x) - Math.abs(b - rect.x));
  let best = { x: rect.x, y: rect.y };
  let distance = Infinity;
  for (const x of xs) {
    const dx = (x - rect.x) ** 2;
    if (dx > distance) break;
    const intervals = blocked.filter(item => x > item.left && x < item.right)
      .map(item => [item.top, item.bottom])
      .sort((a, b) => a[0] - b[0]);
    const merged: number[][] = [];
    for (const interval of intervals) {
      const last = merged[merged.length - 1];
      // Touching open intervals leave a valid point with exactly the given gap.
      if (last && interval[0] < last[1]) last[1] = Math.max(last[1], interval[1]);
      else merged.push(interval);
    }
    let y = rect.y;
    const collision = merged.find(([top, bottom]) => y > top && y < bottom);
    if (collision) {
      const [top, bottom] = collision;
      y = rect.y - top < bottom - rect.y ? top : bottom;
    }
    const candidateDistance = dx + (y - rect.y) ** 2;
    if (candidateDistance < distance) {
      best = { x, y };
      distance = candidateDistance;
      if (distance === 0) break;
    }
  }
  return best;
}

export function newCardPosition(rect: Rect, cards: Card[], groups: Group[]) {
  const members = new Map<string, Card[]>();
  for (const card of cards) if (card.bundleId) {
    const list = members.get(card.bundleId) || [];
    list.push(card);
    members.set(card.bundleId, list);
  }
  const bundles = new Set(groups.filter(group => group.kind === 'bundle').map(group => group.id));
  const origins = buildOriginGeometries(cards, groups);
  const obstacles = [
    ...cards.filter(card => !card.bundleId || !bundles.has(card.bundleId)).map(cardVisualBounds),
    ...groups.map(group => group.kind === 'bundle'
      ? bundleDisplayBounds(members.get(group.id) || [], group)
      : originEnvelope(group, origins.get(group.id))),
  ];
  return nearestFreePosition(rect, obstacles);
}
