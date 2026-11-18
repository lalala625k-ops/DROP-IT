import { pieSectorAt, pieSlotPoint, Point } from './pieMenuGeometry';
import type { RadialItem } from './radialMenuModel';
export const RADIAL_SIZE = 88;
export const RADIAL_RADIUS = 180;
const CHILD_RADIUS = 108;
export interface RadialButton extends RadialItem { point: Point; parent?: string }
export function radialButtons(items: RadialItem[], openBranch: string | null): RadialButton[] {
  const primary = items.map((item) => ({ ...item, point: pieSlotPoint({ x: 0, y: 0 }, RADIAL_RADIUS, item.angle) }));
  const branch = primary.find((item) => item.id === openBranch);
  const children = branch?.children || [];
  const spread = children.length > 3 ? 140 : 110;
  let childRadius = children.length > 1 ? Math.max(CHILD_RADIUS,
    (RADIAL_SIZE + 8) / (2 * Math.sin(spread / (children.length - 1) * Math.PI / 360))) : CHILD_RADIUS;
  const childPoint = (index: number) => pieSlotPoint(branch!.point, childRadius,
    branch!.angle + (children.length < 2 ? 0 : -spread / 2 + index * spread / (children.length - 1)));
  // Keep the fan close, but clear every primary button's actual hit area.
  while (children.some((_, index) => {
    const point = childPoint(index);
    return primary.some(item => Math.hypot(point.x - item.point.x, point.y - item.point.y) < RADIAL_SIZE + 8);
  })) childRadius += 2;
  return [...primary, ...children.map((item, index) => ({ ...item, parent: branch!.id,
    point: childPoint(index) }))];
}
export function radialBounds(buttons: RadialButton[]) {
  const padding = RADIAL_SIZE / 2 + 12;
  return { left: Math.min(0, ...buttons.map((item) => item.point.x)) - padding,
    top: Math.min(0, ...buttons.map((item) => item.point.y)) - padding,
    right: Math.max(0, ...buttons.map((item) => item.point.x)) + padding,
    bottom: Math.max(0, ...buttons.map((item) => item.point.y)) + padding };
}
export function placeRadialMenu(origin: Point, items: RadialItem[], viewport: { width: number; height: number }) {
  const bounds = radialBounds(items.flatMap((item) => radialButtons(items, item.id)));
  const scale = Math.max(0.1, Math.min(0.5, (viewport.width - 24) / (bounds.right - bounds.left),
    (viewport.height - 24) / (bounds.bottom - bounds.top)));
  return { center: { x: Math.max(12 - bounds.left * scale, Math.min(viewport.width - 12 - bounds.right * scale, origin.x)),
    y: Math.max(12 - bounds.top * scale, Math.min(viewport.height - 12 - bounds.bottom * scale, origin.y)) }, scale };
}
export function radialMenuAt(pointer: Point, center: Point, scale: number, items: RadialItem[], openBranch: string | null) {
  const local = { x: (pointer.x - center.x) / scale, y: (pointer.y - center.y) / scale };
  const buttons = radialButtons(items, openBranch);
  // Children own their exact circles; gaps cannot select a neighboring sector.
  const hit = [...buttons].reverse().find((item) => Math.hypot(local.x - item.point.x, local.y - item.point.y) <= RADIAL_SIZE / 2);
  if (hit) return hit.disabled ? null : hit.id;
  if (Math.hypot(local.x, local.y) > RADIAL_RADIUS + RADIAL_SIZE / 2) return null;
  return pieSectorAt(pointer, center, scale, RADIAL_RADIUS, items, 14);
}
export function radialLink(start: Point, end: Point, startRadius = 16) {
  const distance = Math.hypot(end.x - start.x, end.y - start.y);
  const dx = (end.x - start.x) / distance, dy = (end.y - start.y) / distance;
  return { start: { x: start.x + dx * startRadius, y: start.y + dy * startRadius },
    end: { x: end.x - dx * RADIAL_SIZE / 2, y: end.y - dy * RADIAL_SIZE / 2 } };
}
