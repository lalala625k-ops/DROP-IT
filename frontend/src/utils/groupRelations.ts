import { Card, Group } from '../types';
export { normalizeTreeData } from './normalizeTreeData';

export function getBundleParentIds(cards: Card[], bundle: Group): string[] {
  const parentId = bundle.parentIds !== undefined ? bundle.parentIds[0]
    : cards.find((card) => card.bundleId === bundle.id && card.groupId)?.groupId;
  return parentId ? [parentId] : [];
}

// A bundle is one visible tree node. Its members and descendants follow the same branch.
export function getParentLinkage(cards: Card[], parentId: string, groups: Group[] = []) {
  // All bundle nodes classify membership; only reachable descendants belong
  // in the returned branch used for highlighting and movement.
  const knownBundleIds = new Set<string>();
  const bundleIds = new Set<string>();
  const cardIds = new Set<string>();
  const bundlesByParent = new Map<string, Group[]>();
  const cardsByParent = new Map<string, Card[]>();
  const membersByBundle = new Map<string, Card[]>();
  const legacyBundleParents = new Map<string, string>();
  for (const group of groups) if (group.kind === 'bundle') knownBundleIds.add(group.id);
  for (const card of cards) {
    if (card.bundleId) {
      const members = membersByBundle.get(card.bundleId) || [];
      members.push(card);
      membersByBundle.set(card.bundleId, members);
      if (card.groupId && !legacyBundleParents.has(card.bundleId)) legacyBundleParents.set(card.bundleId, card.groupId);
    }
  }
  for (const group of groups) {
    if (group.kind !== 'bundle') continue;
    const parent = group.parentIds !== undefined ? group.parentIds[0] : legacyBundleParents.get(group.id);
    if (!parent) continue;
    const children = bundlesByParent.get(parent) || [];
    children.push(group);
    bundlesByParent.set(parent, children);
  }
  for (const card of cards) {
    if (card.bundleId && knownBundleIds.has(card.bundleId)) continue;
    if (!card.groupId) continue;
    const children = cardsByParent.get(card.groupId) || [];
    children.push(card);
    cardsByParent.set(card.groupId, children);
  }
  const queue = [parentId];
  const visited = new Set<string>(queue);
  while (queue.length) {
    const id = queue.shift()!;
    for (const bundle of bundlesByParent.get(id) || []) {
      if (visited.has(bundle.id)) continue;
      visited.add(bundle.id);
      bundleIds.add(bundle.id);
      queue.push(bundle.id);
    }
    for (const card of cardsByParent.get(id) || []) {
      if (visited.has(card.id)) continue;
      visited.add(card.id);
      cardIds.add(card.id);
      queue.push(card.id);
    }
    if (knownBundleIds.has(id)) {
      for (const member of membersByBundle.get(id) || []) {
        cardIds.add(member.id);
        if (!visited.has(member.id)) { visited.add(member.id); queue.push(member.id); }
      }
    }
  }
  return { cardIds, bundleIds };
}

export function treeParentId(id: string, cards: Card[], groups: Group[]): string | null {
  const card = cards.find((item) => item.id === id);
  if (card) return card.bundleId && groups.some((group) => group.id === card.bundleId && group.kind === 'bundle')
    ? card.bundleId : card.groupId || null;
  const group = groups.find((item) => item.id === id);
  return group?.kind === 'bundle' ? getBundleParentIds(cards, group)[0] || null : null;
}

export function treeNodeId(id: string, cards: Card[], groups: Group[]): string {
  const card = cards.find((item) => item.id === id);
  return card?.bundleId && groups.some((group) => group.id === card.bundleId && group.kind === 'bundle')
    ? card.bundleId : id;
}

export function canAttachTreeNode(sourceId: string, targetId: string, cards: Card[], groups: Group[]): boolean {
  const source = treeNodeId(sourceId, cards, groups);
  let current: string | null = treeNodeId(targetId, cards, groups);
  if (!cards.some((card) => card.id === source) && !groups.some((group) => group.id === source && group.kind === 'bundle')) return false;
  const seen = new Set<string>();
  while (current) {
    if (current === source || seen.has(current)) return false;
    seen.add(current);
    current = treeParentId(current, cards, groups);
  }
  return true;
}
