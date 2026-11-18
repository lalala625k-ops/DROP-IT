import type { Card, Group, Rect } from '../types';
import { groupNodeCenter } from './treeNodeGeometry';
import { originFrame, originVisualBounds, ORIGIN_TITLE_GAP, ORIGIN_TITLE_HEIGHT, ORIGIN_TITLE_WIDTH } from './originFrame';
import { MAX_ORIGIN_SIZE_SCALE, originSizeScale } from './originSizing';

export type OriginPoint = { x: number; y: number };
export type OriginVertex = OriginPoint & { branchId: string; count: number; radius: number; angle: number };
export interface OriginGeometry {
  center: OriginPoint;
  baseRadius: number;
  branches: OriginVertex[];
  sizeScale: number;
  vertices: OriginVertex[];
  bounds: Rect;
  cardCount: number;
}
export type OriginGeometries = Map<string, OriginGeometry>;

export function originBranchRadius(count: number, baseRadius = 60) {
  return baseRadius * (0.5 + (Math.min(30, Math.max(1, count)) - 1) / 29);
}

// The saved 120px frame remains the anchor. Geometry is derived, never persisted.
export function originEnvelope(group: Group, geometry?: OriginGeometry): Rect {
  if (geometry) return originVisualBounds(geometry);
  // Without descendants, reserve the maximum permitted enlargement.
  const radius = (group.width || 120) / 2 * 1.5 * MAX_ORIGIN_SIZE_SCALE;
  const center = { x: group.x + (group.width || 120) / 2, y: group.y + (group.height || 120) / 2 };
  return { x: center.x - radius - ORIGIN_TITLE_WIDTH / 2,
    y: center.y - radius, width: radius * 2 + ORIGIN_TITLE_WIDTH,
    height: radius * 2 + ORIGIN_TITLE_GAP + ORIGIN_TITLE_HEIGHT };
}

export function buildOriginGeometries(cards: Card[], groups: Group[]): OriginGeometries {
  const children = new Map<string, string[]>();
  const cardsById = new Map(cards.map((card) => [card.id, card]));
  const bundles = new Set(groups.filter((group) => group.kind === 'bundle').map((group) => group.id));
  const members = new Map<string, Card[]>();
  const legacyBundleParents = new Map<string, string>();
  for (const card of cards) if (card.bundleId) {
    const items = members.get(card.bundleId) || [];
    items.push(card);
    members.set(card.bundleId, items);
    if (card.groupId && !legacyBundleParents.has(card.bundleId)) legacyBundleParents.set(card.bundleId, card.groupId);
  }
  const centers = new Map<string, OriginPoint>(cards.map((card) => [card.id,
    { x: card.x + card.width / 2, y: card.y + card.height / 2 }]));
  for (const group of groups) centers.set(group.id, groupNodeCenter(group, members.get(group.id)));
  const add = (parent: string | null | undefined, id: string) => {
    if (!parent) return;
    const branch = children.get(parent) || [];
    branch.push(id);
    children.set(parent, branch);
  };
  for (const group of groups) if (bundles.has(group.id)) {
    add(group.parentIds?.[0] || legacyBundleParents.get(group.id), group.id);
  }
  for (const card of cards) add(card.bundleId && bundles.has(card.bundleId) ? card.bundleId : card.groupId, card.id);
  const subtreeCardCounts = new Map<string, number>();
  const counting = new Set<string>();
  const descendantCount = (id: string): number => {
    const cached = subtreeCardCounts.get(id);
    if (cached !== undefined) return cached;
    // Malformed legacy cycles should not make geometry construction recurse
    // forever or multiply the same branch indefinitely.
    if (counting.has(id)) return 0;
    counting.add(id);
    let count = cardsById.has(id) ? 1 : 0;
    for (const childId of children.get(id) || []) count += descendantCount(childId);
    counting.delete(id);
    subtreeCardCounts.set(id, count);
    return count;
  };
  const result: OriginGeometries = new Map();
  for (const group of groups) {
    if (group.kind === 'bundle') continue;
    const baseRadius = (group.width || 120) / 2;
    const center = { x: group.x + baseRadius, y: group.y + (group.height || 120) / 2 };
    let allCardCount = 0;
    const vertex = (angle: number, count: number, branchId: string): OriginVertex => {
      const radius = originBranchRadius(count, baseRadius);
      return { x: center.x + Math.cos(angle) * radius, y: center.y + Math.sin(angle) * radius,
        angle, count, radius, branchId };
    };
    const branches: OriginVertex[] = [];
    for (const id of children.get(group.id) || []) {
      const branch = centers.get(id);
      if (!branch) continue;
      const branchCardCount = descendantCount(id);
      allCardCount += branchCardCount;
      const angle = Math.atan2(branch.y - center.y, branch.x - center.x);
      branches.push(vertex(angle, branchCardCount, id));
    }
    branches.sort((a, b) => a.angle - b.angle);
    const requiredScale = originSizeScale(branches, baseRadius);
    const polygon = Number.isFinite(requiredScale) && requiredScale <= MAX_ORIGIN_SIZE_SCALE;
    const sizeScale = polygon ? requiredScale : 1;
    const vertices = polygon ? branches.map((point) => ({ ...point, radius: point.radius * sizeScale,
      x: center.x + (point.x - center.x) * sizeScale,
      y: center.y + (point.y - center.y) * sizeScale })) : [];
    // Degenerate directions have no area at any finite scale. Keep the existing
    // circular outline instead of generating vertices or an unbounded polygon.
    const displayRadius = polygon ? baseRadius : Math.max(baseRadius, ...branches.map((point) => point.radius));
    const xs = vertices.map((point) => point.x);
    const ys = vertices.map((point) => point.y);
    const bounds = vertices.length
      ? { x: Math.min(...xs), y: Math.min(...ys), width: Math.max(...xs) - Math.min(...xs), height: Math.max(...ys) - Math.min(...ys) }
      : { x: center.x - displayRadius, y: center.y - displayRadius, width: displayRadius * 2, height: displayRadius * 2 };
    const geometry = { center, baseRadius: displayRadius, branches, sizeScale, vertices, bounds, cardCount: allCardCount };
    // Keep the shared 5px width even in concave layouts. If an inset cannot
    // retain a valid hole, use the existing circle instead of thinning edges.
    if (vertices.length && !originFrame(geometry).hasInterior) {
      const radius = Math.max(baseRadius, ...branches.map(point => point.radius));
      geometry.vertices = [];
      geometry.sizeScale = 1;
      geometry.baseRadius = radius;
      geometry.bounds = { x: center.x - radius, y: center.y - radius, width: radius * 2, height: radius * 2 };
    }
    result.set(group.id, geometry);
  }
  return result;
}

export const originPoints = (geometry: OriginGeometry) => geometry.vertices.map((point) => `${point.x},${point.y}`).join(' ');
