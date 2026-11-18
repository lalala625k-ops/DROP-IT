import type { Card, Group } from '../types';
import { bundleCollapseAnchor } from './bundleCollapseAnchor';

/** Normalize relations without replacing cards whose content/position is unchanged. */
export function normalizeTreeData(cards: Card[], groups: Group[]) {
  const cardIndices = new Map<string, number>();
  const groupIndices = new Map<string, number>();
  const bundles = new Set<string>();
  const legacyParents = new Map<string, string>();
  cards.forEach((card, index) => {
    if (!cardIndices.has(card.id)) cardIndices.set(card.id, index);
    if (card.bundleId != null && card.groupId && !legacyParents.has(card.bundleId)) legacyParents.set(card.bundleId, card.groupId);
  });
  groups.forEach((group, index) => {
    if (!groupIndices.has(group.id)) groupIndices.set(group.id, index);
    if (group.kind === 'bundle') bundles.add(group.id);
  });
  const validIds = new Set([...cardIndices.keys(), ...groupIndices.keys()]);
  const nodeId = (id: string) => {
    const index = cardIndices.get(id);
    const bundleId = index === undefined ? null : cards[index].bundleId;
    return bundleId && bundles.has(bundleId) ? bundleId : id;
  };
  let nextCards = cards;
  let nextGroups = groups;
  let changed = false;
  const updateCard = (index: number, patch: Partial<Card>) => {
    if (nextCards === cards) nextCards = cards.slice();
    nextCards[index] = { ...nextCards[index], ...patch };
    changed = true;
  };
  const updateGroup = (index: number, patch: Partial<Group>) => {
    if (nextGroups === groups) nextGroups = groups.slice();
    nextGroups[index] = { ...nextGroups[index], ...patch };
    changed = true;
  };
  groups.forEach((group, index) => {
    if (group.kind !== 'bundle') return;
    const legacyParent = group.parentIds === undefined ? legacyParents.get(group.id) : undefined;
    const candidate = group.parentIds?.find(id => validIds.has(id)) || legacyParent;
    const parentId = candidate && validIds.has(candidate) ? nodeId(candidate) : null;
    const parentIds = parentId ? [parentId] : [];
    if (group.parentIds?.length !== parentIds.length || group.parentIds?.[0] !== parentIds[0]) updateGroup(index, { parentIds });
  });
  cards.forEach((card, index) => {
    const candidate = card.bundleId && bundles.has(card.bundleId) ? null : card.groupId;
    const parentId = candidate && validIds.has(candidate) ? nodeId(candidate) : null;
    if ((card.groupId || null) !== parentId) updateCard(index, { groupId: parentId });
  });
  const parentOf = (id: string): string | null => {
    const cardIndex = cardIndices.get(id);
    if (cardIndex !== undefined) {
      const card = nextCards[cardIndex];
      return card.bundleId && bundles.has(card.bundleId) ? card.bundleId : card.groupId || null;
    }
    const groupIndex = groupIndices.get(id);
    const group = groupIndex === undefined ? undefined : nextGroups[groupIndex];
    return group?.kind === 'bundle' ? group.parentIds?.[0] || null : null;
  };
  const children = new Map<string, string[]>();
  const unsafe = new Set(validIds);
  const roots: string[] = [];
  for (const id of validIds) {
    const parent = parentOf(id);
    if (!id || !parent) roots.push(id);
    else {
      const siblings = children.get(parent) || [];
      siblings.push(id);
      children.set(parent, siblings);
    }
  }
  // The reverse walk marks nodes with a terminating parent chain. The remaining
  // nodes either belong to a cycle or lead to one. Each node is visited once.
  const markSafe = (queue: string[]) => {
    for (let index = 0; index < queue.length; index++) {
      const id = queue[index];
      if (!unsafe.delete(id)) continue;
      for (const child of children.get(id) || []) queue.push(child);
    }
  };
  markSafe(roots);
  const duplicateIds = validIds.size !== cards.length + groups.length || validIds.has('');
  const canAttach = (sourceId: string, targetId: string) => {
    const source = nodeId(sourceId);
    let current: string | null = nodeId(targetId);
    if (!cardIndices.has(source) && !bundles.has(source)) return false;
    const seen = new Set<string>();
    while (current) {
      if (current === source || seen.has(current)) return false;
      seen.add(current);
      current = parentOf(current);
    }
    return true;
  };
  const invalidParent = (id: string) => {
    const parent = parentOf(id);
    // Duplicate IDs are malformed but preserve the legacy first-match behavior.
    return !!parent && (duplicateIds ? !canAttach(id, parent) : unsafe.has(id));
  };
  // Preserve legacy encounter order: even a branch entering a still-live cycle
  // loses its own edge before the cycle's first node is encountered.
  nextCards.forEach((card, index) => {
    if ((!card.bundleId || !bundles.has(card.bundleId)) && invalidParent(card.id)) {
      updateCard(index, { groupId: null });
      markSafe([card.id]);
    }
  });
  nextGroups.forEach((group, index) => {
    if (group.kind === 'bundle' && invalidParent(group.id)) {
      updateGroup(index, { parentIds: [] });
      markSafe([group.id]);
    }
  });
  nextGroups.forEach((group, index) => {
    if (group.kind === 'bundle' && group.collapsed && !group.collapsedAnchor) {
      updateGroup(index, { collapsedAnchor: bundleCollapseAnchor(group, nextCards, nextGroups) });
    }
  });
  return { cards: nextCards, groups: nextGroups, changed };
}
