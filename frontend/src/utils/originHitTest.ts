import type { Rect } from '../types';
import type { OriginGeometry, OriginPoint } from './originGeometry';

function segmentDistance(point: OriginPoint, a: OriginPoint, b: OriginPoint) {
  const dx = b.x - a.x, dy = b.y - a.y;
  const length = dx * dx + dy * dy;
  const t = length ? Math.max(0, Math.min(1, ((point.x - a.x) * dx + (point.y - a.y) * dy) / length)) : 0;
  return Math.hypot(point.x - a.x - dx * t, point.y - a.y - dy * t);
}

export function containsOriginPoint(geometry: OriginGeometry, point: OriginPoint, tolerance = 0) {
  if (!geometry.vertices.length) return Math.hypot(point.x - geometry.center.x, point.y - geometry.center.y)
    <= geometry.baseRadius + tolerance;
  let inside = false;
  const points = geometry.vertices;
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const a = points[j], b = points[i];
    if (segmentDistance(point, a, b) <= tolerance + 1e-6) return true;
    if ((a.y > point.y) !== (b.y > point.y) && point.x < (b.x - a.x) * (point.y - a.y) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

export function originIntersectsRect(geometry: OriginGeometry, rect: Rect) {
  const left = Math.min(rect.x, rect.x + rect.width), right = Math.max(rect.x, rect.x + rect.width);
  const top = Math.min(rect.y, rect.y + rect.height), bottom = Math.max(rect.y, rect.y + rect.height);
  if (!geometry.vertices.length) return containsOriginPoint(geometry, {
    x: Math.max(left, Math.min(right, geometry.center.x)), y: Math.max(top, Math.min(bottom, geometry.center.y)),
  });
  const points = geometry.vertices;
  if (points.some((p) => p.x >= left && p.x <= right && p.y >= top && p.y <= bottom)) return true;
  if ([{ x: left, y: top }, { x: right, y: top }, { x: right, y: bottom }, { x: left, y: bottom }]
    .some((point) => containsOriginPoint(geometry, point))) return true;
  return points.some((a, i) => {
    const b = points[(i + 1) % points.length];
    for (const x of [left, right]) {
      const t = (x - a.x) / (b.x - a.x);
      if (t >= 0 && t <= 1 && a.y + t * (b.y - a.y) >= top && a.y + t * (b.y - a.y) <= bottom) return true;
    }
    for (const y of [top, bottom]) {
      const t = (y - a.y) / (b.y - a.y);
      if (t >= 0 && t <= 1 && a.x + t * (b.x - a.x) >= left && a.x + t * (b.x - a.x) <= right) return true;
    }
    return false;
  });
}
