import type { Card, Group } from '../types';
import { bundleDisplayBounds, bundleDisplayOutlinePoints } from './bundleGeometry';

export function bundlePreviewShape(members: Card[], group: Group) {
  const bounds = bundleDisplayBounds(members, group);
  const outline = `M ${bundleDisplayOutlinePoints(members, bounds)
    .map((point) => `${point.x} ${point.y}`).join(' L ')} Z`;
  return { bounds, outline };
}

export function createBundleDragPreviews(cards: Card[], groups: Group[],
  previewIds: ReadonlySet<string>, movingCardIds: ReadonlySet<string>) {
  const membersByBundle = new Map<string, Card[]>();
  for (const card of cards) if (card.bundleId && previewIds.has(card.bundleId)) {
    const members = membersByBundle.get(card.bundleId) || [];
    members.push(card);
    membersByBundle.set(card.bundleId, members);
  }
  const result = new Map<string, {
    group: Group; members: Card[]; movingIds: ReadonlySet<string>; rigid: boolean;
    base: ReturnType<typeof bundlePreviewShape>;
  }>();
  for (const group of groups) {
    if (group.kind !== 'bundle' || !previewIds.has(group.id)) continue;
    const members = membersByBundle.get(group.id) || [];
    const movingIds = new Set(members.filter((card) => movingCardIds.has(card.id)).map((card) => card.id));
    // Empty and isolated Groups keep the existing group-offset path.
    if (!movingIds.size) continue;
    result.set(group.id, { group, members, movingIds, rigid: movingIds.size === members.length,
      base: bundlePreviewShape(members, group) });
  }
  return result;
}

export type BundleDragPreview = ReturnType<typeof createBundleDragPreviews> extends Map<string, infer T> ? T : never;

export function projectBundleDragPreview(preview: BundleDragPreview, dx: number, dy: number) {
  // Every moving card receives the same gesture delta. Translation preserves
  // expanded hulls and all four collapsed anchors, so do no geometry work here.
  if (preview.rigid) return { kind: 'translate' as const, dx, dy };
  const members = preview.members.map((card) => preview.movingIds.has(card.id)
    ? { ...card, x: card.x + dx, y: card.y + dy } : card);
  return { kind: 'geometry' as const, ...bundlePreviewShape(members, preview.group) };
}

export interface BundlePreviewTarget {
  element: HTMLElement;
  svg: SVGSVGElement | null;
  paths: SVGPathElement[];
}

export function writeBundlePreviewShape(target: BundlePreviewTarget,
  shape: ReturnType<typeof bundlePreviewShape>) {
  const { element, svg, paths } = target;
  const { bounds, outline } = shape;
  element.style.left = `${bounds.x}px`;
  element.style.top = `${bounds.y}px`;
  element.style.width = `${bounds.width}px`;
  element.style.height = `${bounds.height}px`;
  element.style.removeProperty('transform');
  svg?.setAttribute('viewBox', `0 0 ${bounds.width} ${bounds.height}`);
  for (const path of paths) path.setAttribute('d', outline);
}

export function resolveDragReleasePointer(pending: { clientX: number; clientY: number } | null,
  processed: { clientX: number; clientY: number } | null, start: { screenX: number; screenY: number }) {
  return pending || processed || { clientX: start.screenX, clientY: start.screenY };
}
