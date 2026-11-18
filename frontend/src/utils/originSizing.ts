import type { OriginPoint } from './originGeometry';

export const MAX_ORIGIN_SIZE_SCALE = 4;

// Uniform scaling preserves every branch axis and the relative weighted radii.
// Width/height alone miss diagonal slivers, so also protect area and thickness.
export function originSizeScale(points: OriginPoint[], baseRadius: number) {
  if (points.length < 3) return Infinity;
  const anchor = points[0];
  let twiceArea = 0, perimeter = 0;
  let left = Infinity, top = Infinity, right = -Infinity, bottom = -Infinity;
  points.forEach((p, i) => {
    const next = points[(i + 1) % points.length];
    twiceArea += (p.x - anchor.x) * (next.y - anchor.y) - (next.x - anchor.x) * (p.y - anchor.y);
    perimeter += Math.hypot(next.x - p.x, next.y - p.y);
    left = Math.min(left, p.x); right = Math.max(right, p.x);
    top = Math.min(top, p.y); bottom = Math.max(bottom, p.y);
  });
  const area = Math.abs(twiceArea) / 2;
  if (!area || !perimeter) return Infinity;
  return Math.max(1, baseRadius * 0.5 / (right - left), baseRadius * 0.5 / (bottom - top),
    Math.sqrt(baseRadius ** 2 * 0.25 / area), baseRadius * 0.2 / (2 * area / perimeter));
}
