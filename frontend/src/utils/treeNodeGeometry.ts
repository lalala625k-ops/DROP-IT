import type { Card, Group } from '../types';
import { bundleDisplayBounds } from './bundleGeometry';

export interface TreeTarget { id: string; x: number; y: number }

export function groupNodeCenter(group: Group, members: Card[] = []): TreeTarget {
  const bounds = group.kind === 'bundle' ? bundleDisplayBounds(members, group) : group;
  const width = bounds.width;
  const height = bounds.height;
  return { id: group.id, x: bounds.x + width / 2, y: bounds.y + height / 2 };
}

export function treeNodeCenter(id: string, cards: Card[], groups: Group[]): TreeTarget | null {
  const card = cards.find((item) => item.id === id);
  if (card) return { id, x: card.x + card.width / 2, y: card.y + card.height / 2 };
  const group = groups.find((item) => item.id === id);
  if (!group) return null;
  return groupNodeCenter(group, cards.filter((item) => item.bundleId === id));
}
