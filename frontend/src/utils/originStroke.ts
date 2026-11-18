import type { OriginGeometry, OriginPoint } from './originGeometry';

export const ORIGIN_STROKE_WIDTH = 5;

const cross = (a: OriginPoint, b: OriginPoint, c: OriginPoint) =>
  (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);

function convexHull(points: OriginPoint[]) {
  const sorted = points.sort((a, b) => a.x - b.x || a.y - b.y);
  const half = (items: OriginPoint[]) => {
    const result: OriginPoint[] = [];
    for (const point of items) {
      while (result.length > 1 && cross(result[result.length - 2], result[result.length - 1], point) <= 0)
        result.pop();
      result.push(point);
    }
    return result.slice(0, -1);
  };
  return [...half(sorted), ...half([...sorted].reverse())];
}

// Join the full line cap to the adjacent frame edges. Ending a butt cap at
// the outer vertex alone leaves a notch on either side of an angled branch.
export function originLineJoin(geometry: OriginGeometry, anchor: OriginPoint,
  toward: OriginPoint, lineWidth: number): OriginPoint[] {
  const dx = toward.x - anchor.x, dy = toward.y - anchor.y;
  const length = Math.hypot(dx, dy);
  if (length < 1e-8) return [];
  const normal = { x: -dy / length * lineWidth / 2, y: dx / length * lineWidth / 2 };
  const points = [anchor,
    { x: anchor.x + normal.x, y: anchor.y + normal.y },
    { x: anchor.x - normal.x, y: anchor.y - normal.y }];
  const along = (point: OriginPoint) => {
    const ex = point.x - anchor.x, ey = point.y - anchor.y;
    const distance = Math.hypot(ex, ey);
    if (distance < 1e-8) return;
    const scale = Math.min(ORIGIN_STROKE_WIDTH / 2, distance) / distance;
    points.push({ x: anchor.x + ex * scale, y: anchor.y + ey * scale });
  };
  if (!geometry.vertices.length) {
    along(geometry.center);
  } else {
    // Also handle an interactive wire landing along an edge, and repeated
    // branch vertices, without creating dots or covering the hollow interior.
    geometry.vertices.forEach((a, i) => {
      const b = geometry.vertices[(i + 1) % geometry.vertices.length];
      const ex = b.x - a.x, ey = b.y - a.y, squared = ex * ex + ey * ey;
      if (!squared) return;
      const t = Math.max(0, Math.min(1, ((anchor.x - a.x) * ex + (anchor.y - a.y) * ey) / squared));
      if (Math.hypot(anchor.x - a.x - t * ex, anchor.y - a.y - t * ey) < 1e-6) {
        along(a); along(b);
      }
    });
  }
  return convexHull(points);
}

export const originJoinPath = (points: OriginPoint[]) => points.length >= 3
  ? `M ${points.map(point => `${point.x} ${point.y}`).join(' L ')} Z` : '';

export function originLineAttachment(geometry: OriginGeometry, anchor: OriginPoint,
  toward: OriginPoint, lineWidth: number): { start: OriginPoint; points: OriginPoint[] } {
  const fallback = () => ({ start: anchor, points: originLineJoin(geometry, anchor, toward, lineWidth) });
  const length = Math.hypot(toward.x - anchor.x, toward.y - anchor.y);
  if (!geometry.vertices.length || length < 1e-8) return fallback();
  const direction = { x: (toward.x - anchor.x) / length, y: (toward.y - anchor.y) / length };
  const normal = { x: -direction.y * lineWidth / 2, y: direction.x * lineWidth / 2 };
  const vertices = geometry.vertices.filter((point, i, all) =>
    Math.hypot(point.x - all[(i + all.length - 1) % all.length].x,
      point.y - all[(i + all.length - 1) % all.length].y) > 1e-6);
  const vertexIndex = vertices.findIndex(point => Math.hypot(point.x - anchor.x, point.y - anchor.y) < 1e-6);
  // Edge landings and nearly parallel edges retain the bounded bevel join.
  if (vertexIndex < 0) return fallback();
  const sign = Math.sign(vertices.reduce((sum, point, i) =>
    sum + cross(anchor, point, vertices[(i + 1) % vertices.length]), 0)) || 1;
  const intersection = (point: OriginPoint, side: number) => {
    const ex = point.x - anchor.x, ey = point.y - anchor.y;
    const divisor = ex * direction.y - ey * direction.x;
    if (Math.abs(divisor) < 1e-8) return null;
    const t = side * (normal.x * direction.y - normal.y * direction.x) / divisor;
    if (t > 1 || Math.hypot(ex * t, ey * t) > ORIGIN_STROKE_WIDTH * 4) return null;
    return { x: anchor.x + ex * t, y: anchor.y + ey * t };
  };
  const previous = intersection(vertices[(vertexIndex + vertices.length - 1) % vertices.length], -sign);
  const next = intersection(vertices[(vertexIndex + 1) % vertices.length], sign);
  if (!previous || !next) return fallback();
  const distance = Math.max(0, ...[previous, next].map(point =>
    (point.x - anchor.x) * direction.x + (point.y - anchor.y) * direction.y));
  if (distance >= length) return fallback();
  const start = { x: anchor.x + direction.x * distance, y: anchor.y + direction.y * distance };
  // Move the butt cap beyond the edge intersections, then join those edges
  // to both sides of the line. This removes the cap's small projecting corner.
  const overlap = Math.min(0.25, (length - distance) / 2);
  const cap = { x: start.x + direction.x * overlap, y: start.y + direction.y * overlap };
  const edgeOverlap = (point: OriginPoint) => {
    const dx = point.x - anchor.x, dy = point.y - anchor.y;
    const scale = Math.min(ORIGIN_STROKE_WIDTH / 2, Math.hypot(dx, dy)) / Math.hypot(dx, dy);
    return { x: anchor.x + dx * scale, y: anchor.y + dy * scale };
  };
  return { start, points: convexHull([anchor, previous, next,
    edgeOverlap(vertices[(vertexIndex + vertices.length - 1) % vertices.length]),
    edgeOverlap(vertices[(vertexIndex + 1) % vertices.length]),
    { x: cap.x + normal.x, y: cap.y + normal.y },
    { x: cap.x - normal.x, y: cap.y - normal.y }]) };
}
