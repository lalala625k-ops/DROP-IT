import type { Card, Group } from '../types';
import { cardHeaderReserve } from './cardBounds';
import { bundleTitleLayout } from './bundleStack';

const PAD = 18;
export function bundleDisplayBounds(members: Card[], group: Group) {
  if (!group.collapsed) return bundleBoundsFromMembers(members, group);
  return bundleTitleLayout(members, group).bounds;
}

export function bundleDisplayOutlinePoints(members: Card[], group: Group) {
  if (!group.collapsed) return bundleOutlinePoints(members, group);
  const layout = bundleTitleLayout(members, group);
  const pad = group.outlinePadding ?? PAD;
  const points = layout.pages.flatMap((page) => {
    const left = page.x - pad - group.x;
    const top = page.y - pad - group.y;
    const right = page.x + page.width + pad - group.x;
    const bottom = page.y + page.height + pad - group.y;
    return [{ x: left, y: top }, { x: right, y: top }, { x: right, y: bottom }, { x: left, y: bottom }];
  });
  if (points.length < 3) return [{ x: 0, y: 0 }, { x: group.width, y: 0 }, { x: group.width, y: group.height }, { x: 0, y: group.height }];
  const cross = (a: typeof points[number], b: typeof points[number], c: typeof points[number]) =>
    (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
  const sorted = [...points].sort((a, b) => a.x - b.x || a.y - b.y);
  const lower: typeof points = [];
  for (const point of sorted) { while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], point) <= 0) lower.pop(); lower.push(point); }
  const upper: typeof points = [];
  for (const point of [...sorted].reverse()) { while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], point) <= 0) upper.pop(); upper.push(point); }
  return [...lower.slice(0, -1), ...upper.slice(0, -1)];
}

export function bundleOutlinePoints(members: Card[], group: Group) {
  const pad = group.outlinePadding ?? PAD;
  const points = members.flatMap((card) => {
    const left = card.x - pad - group.x;
    const top = card.y - cardHeaderReserve(card) - pad - group.y;
    const right = card.x + card.width + pad - group.x;
    const bottom = card.y + card.height + pad - group.y;
    return [{ x: left, y: top }, { x: right, y: top }, { x: right, y: bottom }, { x: left, y: bottom }];
  }).sort((a, b) => a.x - b.x || a.y - b.y);
  if (points.length < 3) return [
    { x: 0, y: 0 }, { x: group.width, y: 0 },
    { x: group.width, y: group.height }, { x: 0, y: group.height },
  ];
  const cross = (a: typeof points[number], b: typeof points[number], c: typeof points[number]) =>
    (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
  const lower: typeof points = [];
  for (const point of points) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], point) <= 0) lower.pop();
    lower.push(point);
  }
  const upper: typeof points = [];
  for (const point of [...points].reverse()) {
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], point) <= 0) upper.pop();
    upper.push(point);
  }
  return [...lower.slice(0, -1), ...upper.slice(0, -1)];
}


export function bundleBoundsFromMembers(members: Card[], fallback: Group) {
  if (!members.length) return fallback;
  const left = Math.min(...members.map((card) => card.x));
  const top = Math.min(...members.map((card) => card.y - cardHeaderReserve(card)));
  const right = Math.max(...members.map((card) => card.x + card.width));
  const bottom = Math.max(...members.map((card) => card.y + card.height));
  const pad = fallback.outlinePadding ?? PAD;
  return {
    ...fallback,
    x: left - pad,
    y: top - pad,
    width: right - left + pad * 2,
    height: bottom - top + pad * 2,
  };
}
