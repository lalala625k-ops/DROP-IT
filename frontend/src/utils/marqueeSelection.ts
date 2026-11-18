import type { CanvasPin, Card, Group, Rect } from '../types';
import { rectsIntersect } from './canvas';
import { cardVisualBounds } from './cardBounds';
import { pinBounds } from './canvasPinGeometry';
import { bundleBounds } from '../hooks/useBundleGroups';
import { bundleDisplayBounds } from './bundleGeometry';
import { buildOriginGeometries } from './originGeometry';
import { originIntersectsRect } from './originHitTest';

const contains = (outer: Rect, inner: Rect) => outer.x <= inner.x && outer.y <= inner.y &&
  outer.x + outer.width >= inner.x + inner.width && outer.y + outer.height >= inner.y + inner.height;

export function marqueeSelection(rect: Rect, cards: Card[], groups: Group[], pins: CanvasPin[] = [], isCtrl = false, zoom = 1) {
  const groupIds = new Set<string>();
  const origins = buildOriginGeometries(cards, groups);
  const collapsed = new Set(groups.filter((group) => group.kind === 'bundle' && group.collapsed).map((group) => group.id));
  for (const group of groups) {
    if (group.kind !== 'bundle') {
      if (originIntersectsRect(origins.get(group.id)!, rect)) groupIds.add(group.id);
      continue;
    }
    const bounds = group.kind === 'bundle' && !group.collapsed ? bundleBounds(cards, group.id, group)
      : group.kind === 'bundle' ? bundleDisplayBounds(cards.filter(card => card.bundleId === group.id), group) : group;
    const visual = group.kind === 'bundle' && group.collapsed
      ? bounds
      : bounds;
    // A marquee inside an expanded Group selects its individual notes. Crossing
    // the outline or enclosing the Group selects the container and its members.
    if (rectsIntersect(rect, visual) && (isCtrl || group.kind !== 'bundle' || group.collapsed ||
      !contains(visual, rect) || contains(rect, visual))) groupIds.add(group.id);
  }
  const cardIds = new Set(cards.filter((card) => (!card.bundleId || !collapsed.has(card.bundleId)) &&
    (!isCtrl || !card.bundleId || !groupIds.has(card.bundleId)) && rectsIntersect(rect, cardVisualBounds(card))).map((card) => card.id));
  const pinIds = new Set(pins.filter((pin) => rectsIntersect(rect, pinBounds(pin, zoom))).map((pin) => pin.id));
  return { cardIds, groupIds, pinIds };
}
