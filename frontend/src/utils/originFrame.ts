import type { Rect } from '../types';
import type { OriginGeometry, OriginPoint } from './originGeometry';
import { containsOriginPoint } from './originHitTest';
import { ORIGIN_STROKE_WIDTH } from './originStroke';

export const ORIGIN_TITLE_WIDTH = 144;
export const ORIGIN_TITLE_GAP = 12;
export const ORIGIN_TITLE_HEIGHT = 76;

const cross = (a: OriginPoint, b: OriginPoint) => a.x * b.y - a.y * b.x;
const pos = (p: OriginPoint) => `${p.x} ${p.y}`;
const polygonPath = (points: OriginPoint[]) => `M ${points.map(pos).join(' L ')} Z`;
const relative = (p: OriginPoint, anchor: OriginPoint) => ({ x: p.x - anchor.x, y: p.y - anchor.y });
const area = (points: OriginPoint[]) => points.reduce((sum, p, i) => sum +
  cross(relative(p, points[0]), relative(points[(i + 1) % points.length], points[0])), 0) / 2;

export function polygonCenter(points: OriginPoint[]): OriginPoint {
  if (!points.length) return { x: 0, y: 0 };
  const anchor = points[0];
  let twiceArea = 0, x = 0, y = 0;
  points.forEach((p, i) => {
    const a = relative(p, anchor), b = relative(points[(i + 1) % points.length], anchor), weight = cross(a, b);
    twiceArea += weight; x += (a.x + b.x) * weight; y += (a.y + b.y) * weight;
  });
  return Math.abs(twiceArea) < 1e-8
    ? { x: points.reduce((sum, p) => sum + p.x, 0) / points.length,
      y: points.reduce((sum, p) => sum + p.y, 0) / points.length }
    : { x: anchor.x + x / (3 * twiceArea), y: anchor.y + y / (3 * twiceArea) };
}

function hasCrossingEdges(points: OriginPoint[]) {
  const side = (a: OriginPoint, b: OriginPoint, p: OriginPoint) => cross(relative(b, a), relative(p, a));
  return points.some((a, i) => points.some((c, j) => {
    if (j <= i + 1 || (i === 0 && j === points.length - 1)) return false;
    const b = points[(i + 1) % points.length], d = points[(j + 1) % points.length];
    return side(a, b, c) * side(a, b, d) < -1e-8 && side(c, d, a) * side(c, d, b) < -1e-8;
  }));
}

function insetPolygon(points: OriginPoint[], thickness: number) {
  const sign = Math.sign(area(points)) || 1;
  const convex = points.every((p, i) => sign * cross(relative(points[(i + 1) % points.length], p),
    relative(points[(i + 2) % points.length], points[(i + 1) % points.length])) >= -1e-8);
  if (convex) {
    // Clip offset half-planes instead of intersecting adjacent lines: tiny
    // edges disappear naturally instead of turning the inner contour inside out.
    let inner = points;
    for (let i = 0; i < points.length && inner.length; i++) {
      const a = points[i], direction = relative(points[(i + 1) % points.length], a);
      const length = Math.hypot(direction.x, direction.y);
      const distance = (p: OriginPoint) => sign * cross(direction, relative(p, a)) / length - thickness;
      const clipped: OriginPoint[] = [];
      inner.forEach((p, j) => {
        const next = inner[(j + 1) % inner.length], start = distance(p), end = distance(next);
        if (start >= -1e-8) clipped.push(p);
        if ((start >= 0) !== (end >= 0)) {
          const t = start / (start - end);
          clipped.push({ x: p.x + (next.x - p.x) * t, y: p.y + (next.y - p.y) * t });
        }
      });
      inner = clipped;
    }
    return inner;
  }
  const sides = points.map((a, i) => {
    const b = points[(i + 1) % points.length], length = Math.hypot(b.x - a.x, b.y - a.y) || 1;
    const direction = { x: (b.x - a.x) / length, y: (b.y - a.y) / length };
    return { start: { x: a.x - sign * direction.y * thickness, y: a.y + sign * direction.x * thickness }, direction };
  });
  return points.map((_, i) => {
    const previous = sides[(i + sides.length - 1) % sides.length], next = sides[i];
    const divisor = cross(previous.direction, next.direction);
    if (Math.abs(divisor) < 1e-8) return next.start;
    const offset = { x: next.start.x - previous.start.x, y: next.start.y - previous.start.y };
    const t = cross(offset, next.direction) / divisor;
    return { x: previous.start.x + previous.direction.x * t, y: previous.start.y + previous.direction.y * t };
  });
}

export interface OriginFrame {
  path: string;
  innerPoints: OriginPoint[];
  countCenter: OriginPoint;
  hasInterior: boolean;
}

export function originFrame(geometry: OriginGeometry, thickness = ORIGIN_STROKE_WIDTH): OriginFrame {
  // Multiple branches can share a vertex. Zero-length edges break the inset
  // normals, so omit those edges while retaining all branch IDs in geometry.
  const points = geometry.vertices.filter((point, i, all) => {
    const previous = all[(i + all.length - 1) % all.length];
    return Math.hypot(point.x - previous.x, point.y - previous.y) > 1e-6;
  });
  if (!points.length) {
    const { x, y } = geometry.center, outer = geometry.baseRadius, inner = Math.max(1, outer - thickness);
    const circle = (r: number) => `M ${x - r} ${y} A ${r} ${r} 0 1 0 ${x + r} ${y} A ${r} ${r} 0 1 0 ${x - r} ${y} Z`;
    return { path: `${circle(outer)} ${circle(inner)}`, innerPoints: [], countCenter: geometry.center, hasInterior: true };
  }
  const outerPath = polygonPath(points), countCenter = polygonCenter(points);
  const innerPoints = insetPolygon(points, thickness);
  const fits = (inner: OriginPoint[]) => inner.length >= 3 && !hasCrossingEdges(inner) &&
    Math.sign(area(inner)) === Math.sign(area(points)) && inner.every((p, i) => {
    const next = inner[(i + 1) % inner.length];
    return [0, 0.25, 0.5, 0.75].every(t => containsOriginPoint(geometry,
      { x: p.x + (next.x - p.x) * t, y: p.y + (next.y - p.y) * t }));
  });
  if (!fits(innerPoints)) return { path: outerPath, innerPoints: [], countCenter, hasInterior: false };
  let center = polygonCenter(innerPoints);
  const hole = { ...geometry, vertices: innerPoints as OriginGeometry['vertices'] };
  if (!containsOriginPoint(hole, center)) {
    // A concave hole's area centroid can sit outside its empty region.
    let best = -Infinity;
    const { bounds } = geometry;
    for (let row = 0; row < 24; row++) for (let col = 0; col < 24; col++) {
      const candidate = { x: bounds.x + bounds.width * (col + 0.5) / 24,
        y: bounds.y + bounds.height * (row + 0.5) / 24 };
      if (!containsOriginPoint(hole, candidate)) continue;
      const distance = Math.min(...innerPoints.map((p, i) => {
        const next = innerPoints[(i + 1) % innerPoints.length], dx = next.x - p.x, dy = next.y - p.y;
        const t = Math.max(0, Math.min(1, ((candidate.x - p.x) * dx + (candidate.y - p.y) * dy) / (dx * dx + dy * dy || 1)));
        return Math.hypot(candidate.x - p.x - dx * t, candidate.y - p.y - dy * t);
      }));
      if (distance > best) { best = distance; center = candidate; }
    }
  }
  return { path: `${outerPath} ${polygonPath(innerPoints)}`, innerPoints, countCenter: center, hasInterior: true };
}

export function originVisualBounds(geometry: OriginGeometry): Rect {
  const { bounds } = geometry, { countCenter } = originFrame(geometry);
  const x = Math.min(bounds.x, countCenter.x - ORIGIN_TITLE_WIDTH / 2);
  const right = Math.max(bounds.x + bounds.width, countCenter.x + ORIGIN_TITLE_WIDTH / 2);
  return { x, y: bounds.y, width: right - x, height: bounds.height + ORIGIN_TITLE_GAP + ORIGIN_TITLE_HEIGHT };
}
