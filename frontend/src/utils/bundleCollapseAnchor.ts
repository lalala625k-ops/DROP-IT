import type { Card, Group, Rect } from '../types';
import { cardHeaderReserve } from './cardBounds';

export type BundleCollapseAnchor = 'nw' | 'ne' | 'sw' | 'se';

export function memberFrame(members: Card[], fallback: Rect): Rect {
  if (!members.length) return fallback;
  const x = Math.min(...members.map(card => card.x));
  const y = Math.min(...members.map(card => card.y - cardHeaderReserve(card)));
  return { x, y, width: Math.max(...members.map(card => card.x + card.width)) - x,
    height: Math.max(...members.map(card => card.y + card.height)) - y };
}

/** Choose the original frame's two edges facing its direct parent. */
export function bundleCollapseAnchor(group: Group, cards: Card[], groups: Group[]): BundleCollapseAnchor {
  const members = cards.filter(card => card.bundleId === group.id);
  const parentId = group.parentIds !== undefined ? group.parentIds[0] : members.find(card => card.groupId)?.groupId;
  const parent = groups.find(item => item.id === parentId) || cards.find(item => item.id === parentId);
  if (!parent || parent.id === group.id) return 'nw';
  const frame = memberFrame(members, group);
  const parentFrame = 'kind' in parent && parent.kind === 'bundle'
    ? memberFrame(cards.filter(card => card.bundleId === parent.id), parent) : parent;
  const right = parentFrame.x + parentFrame.width / 2 > frame.x + frame.width / 2;
  const bottom = parentFrame.y + parentFrame.height / 2 > frame.y + frame.height / 2;
  return bottom ? right ? 'se' : 'sw' : right ? 'ne' : 'nw';
}
