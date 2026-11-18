import { Card, Group } from '../types';
import { bundleDisplayOutlinePoints } from './bundleGeometry';
import { buildOriginGeometries, OriginGeometries } from './originGeometry';
import { groupNodeCenter, treeNodeCenter } from './treeNodeGeometry';

export type LinkPoint = { x: number; y: number };
type Shape = { kind: 'polygon'; points: LinkPoint[] } | { kind: 'circle'; center: LinkPoint; radius: number };

export interface LinkLookup {
  cardById?: Map<string, Card>;
  groupById?: Map<string, Group>;
  membersByBundle?: Map<string, Card[]>;
}

const distanceSquared = (a: LinkPoint, b: LinkPoint) => (a.x - b.x) ** 2 + (a.y - b.y) ** 2;
const clamp = (value: number) => Math.max(0, Math.min(1, value));
const edges = (points: LinkPoint[]) => points.map((start, index) => [start, points[(index + 1) % points.length]] as const);

function closestOnSegment(point: LinkPoint, start: LinkPoint, end: LinkPoint): LinkPoint {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const lengthSquared = dx * dx + dy * dy;
  const t = lengthSquared ? clamp(((point.x - start.x) * dx + (point.y - start.y) * dy) / lengthSquared) : 0;
  return { x: start.x + t * dx, y: start.y + t * dy };
}

function closestOnPolygon(point: LinkPoint, points: LinkPoint[]): LinkPoint {
  let best = points[0];
  let distance = Infinity;
  for (const [start, end] of edges(points)) {
    const candidate = closestOnSegment(point, start, end);
    const nextDistance = distanceSquared(point, candidate);
    if (nextDistance < distance) { best = candidate; distance = nextDistance; }
  }
  return best;
}

function circleToward(circle: Extract<Shape, { kind: 'circle' }>, point: LinkPoint): LinkPoint {
  const dx = point.x - circle.center.x || (point.y === circle.center.y ? 1 : 0);
  const dy = point.y - circle.center.y;
  const length = Math.hypot(dx, dy) || 1;
  return { x: circle.center.x + dx / length * circle.radius,
    y: circle.center.y + dy / length * circle.radius };
}

function circlePolygonIntersection(circle: Extract<Shape, { kind: 'circle' }>, points: LinkPoint[]): LinkPoint | null {
  for (const [start, end] of edges(points)) {
    const dx = end.x - start.x;
    const dy = end.y - start.y;
    const ox = start.x - circle.center.x;
    const oy = start.y - circle.center.y;
    const a = dx * dx + dy * dy;
    const b = 2 * (ox * dx + oy * dy);
    const c = ox * ox + oy * oy - circle.radius ** 2;
    const discriminant = b * b - 4 * a * c;
    if (a === 0 || discriminant < 0) continue;
    for (const t of [(-b - Math.sqrt(discriminant)) / (2 * a),
      (-b + Math.sqrt(discriminant)) / (2 * a)]) {
      if (t >= 0 && t <= 1) return { x: start.x + t * dx, y: start.y + t * dy };
    }
  }
  return null;
}

function segmentPair(a: LinkPoint, b: LinkPoint, c: LinkPoint, d: LinkPoint) {
  const ab = { x: b.x - a.x, y: b.y - a.y };
  const cd = { x: d.x - c.x, y: d.y - c.y };
  const cross = ab.x * cd.y - ab.y * cd.x;
  if (Math.abs(cross) > 1e-9) {
    const offset = { x: c.x - a.x, y: c.y - a.y };
    const t = (offset.x * cd.y - offset.y * cd.x) / cross;
    const u = (offset.x * ab.y - offset.y * ab.x) / cross;
    if (t >= 0 && t <= 1 && u >= 0 && u <= 1) {
      const point = { x: a.x + t * ab.x, y: a.y + t * ab.y };
      return { start: point, end: point };
    }
  }
  const candidates = [
    { start: a, end: closestOnSegment(a, c, d) },
    { start: b, end: closestOnSegment(b, c, d) },
    { start: closestOnSegment(c, a, b), end: c },
    { start: closestOnSegment(d, a, b), end: d },
  ];
  return candidates.reduce((best, candidate) => distanceSquared(candidate.start, candidate.end)
    < distanceSquared(best.start, best.end) ? candidate : best);
}

function closestPair(source: Shape, target: Shape): { start: LinkPoint; end: LinkPoint } {
  if (source.kind === 'circle' && target.kind === 'circle') {
    return { start: circleToward(source, target.center), end: circleToward(target, source.center) };
  }
  if (source.kind === 'circle' && target.kind === 'polygon') {
    const intersection = circlePolygonIntersection(source, target.points);
    if (intersection) return { start: intersection, end: intersection };
    const end = closestOnPolygon(source.center, target.points);
    return { start: circleToward(source, end), end };
  }
  if (source.kind === 'polygon' && target.kind === 'circle') {
    const intersection = circlePolygonIntersection(target, source.points);
    if (intersection) return { start: intersection, end: intersection };
    const start = closestOnPolygon(target.center, source.points);
    return { start, end: circleToward(target, start) };
  }
  const a = source as Extract<Shape, { kind: 'polygon' }>;
  const b = target as Extract<Shape, { kind: 'polygon' }>;
  let best: { start: LinkPoint; end: LinkPoint } | null = null;
  for (const [aStart, aEnd] of edges(a.points)) {
    for (const [bStart, bEnd] of edges(b.points)) {
      const candidate = segmentPair(aStart, aEnd, bStart, bEnd);
      if (!best || distanceSquared(candidate.start, candidate.end) < distanceSquared(best.start, best.end)) best = candidate;
    }
  }
  return best!;
}

function rectangle(x: number, y: number, width: number, height: number): Shape {
  return { kind: 'polygon', points: [
    { x, y }, { x: x + width, y }, { x: x + width, y: y + height }, { x, y: y + height },
  ] };
}

function nodeShape(id: string, cards: Card[], groups: Group[], origins: OriginGeometries, lookup?: LinkLookup): Shape | null {
  const card = lookup?.cardById?.get(id) || cards.find((item) => item.id === id);
  if (card) return rectangle(card.x, card.y, card.width, card.height);
  const group = lookup?.groupById?.get(id) || groups.find((item) => item.id === id);
  if (!group) return null;
  if (group.kind !== 'bundle') {
    const geometry = origins.get(id)!;
    return geometry.vertices.length ? { kind: 'polygon', points: geometry.vertices }
      : { kind: 'circle', center: geometry.center, radius: geometry.baseRadius };
  }
  const members = lookup?.membersByBundle?.get(id) || cards.filter((item) => item.bundleId === id);
  return { kind: 'polygon', points: bundleDisplayOutlinePoints(members, group)
    .map((point) => ({ x: group.x + point.x, y: group.y + point.y })) };
}

// Intersect the branch axis with the child's outline so the trunk and vertex align.
function outlineToward(shape: Shape, center: LinkPoint, toward: LinkPoint) {
  if (shape.kind === 'circle') return circleToward(shape, toward);
  const dx = toward.x - center.x, dy = toward.y - center.y;
  let best: LinkPoint | null = null, nearest = Infinity;
  for (const [a, b] of edges(shape.points)) {
    const ex = b.x - a.x, ey = b.y - a.y;
    const cross = dx * ey - dy * ex;
    if (Math.abs(cross) < 1e-9) continue;
    const ax = a.x - center.x, ay = a.y - center.y;
    const t = (ax * ey - ay * ex) / cross;
    const u = (ax * dy - ay * dx) / cross;
    if (t >= 0 && u >= 0 && u <= 1 && t < nearest) {
      nearest = t;
      best = { x: center.x + t * dx, y: center.y + t * dy };
    }
  }
  return best || closestOnPolygon(toward, shape.points);
}

export function linkEndpoints(sourceId: string, targetId: string, cards: Card[], groups: Group[],
  origins = buildOriginGeometries(cards, groups), lookup?: LinkLookup) {
  const source = nodeShape(sourceId, cards, groups, origins, lookup);
  const target = nodeShape(targetId, cards, groups, origins, lookup);
  const originId = origins.has(sourceId) ? sourceId : origins.has(targetId) ? targetId : null;
  if (source && target && originId) {
    const reverse = originId === targetId;
    const geometry = origins.get(originId)!;
    const childId = reverse ? sourceId : targetId;
    const childCard = lookup?.cardById?.get(childId) || cards.find((item) => item.id === childId);
    const childGroup = lookup?.groupById?.get(childId) || groups.find((item) => item.id === childId);
    const childMembers = lookup?.membersByBundle?.get(childId) || cards.filter((item) => item.bundleId === childId);
    const childCenter = childCard
      ? { id: childId, x: childCard.x + childCard.width / 2, y: childCard.y + childCard.height / 2 }
      : childGroup ? groupNodeCenter(childGroup, childMembers) : treeNodeCenter(childId, cards, groups);
    if (!childCenter) return null;
    const childShape = reverse ? source : target;
    const originShape = reverse ? target : source;
    const start = geometry.vertices.find((point) => point.branchId === childId)
      || outlineToward(originShape, geometry.center, childCenter);
    const end = outlineToward(childShape, childCenter, geometry.center);
    return reverse ? { start: end, end: start } : { start, end };
  }
  return source && target ? closestPair(source, target) : null;
}

export function linkStartTowardPoint(sourceId: string, point: LinkPoint, cards: Card[], groups: Group[]) {
  const source = nodeShape(sourceId, cards, groups, buildOriginGeometries(cards, groups));
  if (!source) return null;
  return source.kind === 'circle' ? circleToward(source, point) : closestOnPolygon(point, source.points);
}
