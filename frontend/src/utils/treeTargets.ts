import { Card, Group } from '../types';
import { containsBundlePoint } from '../hooks/useBundleGroups';
import { treeNodeId } from './groupRelations';
import { treeNodeCenter, TreeTarget } from './treeNodeGeometry';
export { treeNodeCenter } from './treeNodeGeometry';
export type { TreeTarget } from './treeNodeGeometry';
import { buildOriginGeometries } from './originGeometry';
import { containsOriginPoint } from './originHitTest';

export function findTreeTarget(point: { x: number; y: number }, sourceId: string,
  cards: Card[], groups: Group[]): TreeTarget | null {
  const source = treeNodeId(sourceId, cards, groups);
  const eligible = (id: string) => id !== source;
  for (const card of [...cards].sort((a, b) => b.zIndex - a.zIndex)) {
    if (card.bundleId && groups.some((group) => group.id === card.bundleId && group.kind === 'bundle')) continue;
    if (point.x < card.x || point.x > card.x + card.width || point.y < card.y || point.y > card.y + card.height) continue;
    if (eligible(card.id)) return treeNodeCenter(card.id, cards, groups);
  }
  for (const group of groups.filter((item) => item.kind === 'bundle')) {
    if (containsBundlePoint(group, cards, point) && eligible(group.id)) return treeNodeCenter(group.id, cards, groups);
  }
  const origins = buildOriginGeometries(cards, groups);
  for (const group of groups.filter((item) => item.kind !== 'bundle')) {
    const center = treeNodeCenter(group.id, cards, groups)!;
    if (containsOriginPoint(origins.get(group.id)!, point, 30)
      && eligible(group.id)) return center;
  }
  return null;
}
