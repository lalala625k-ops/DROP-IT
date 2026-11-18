import type { Card, Group } from '../types';
import { bundleDisplayBounds } from './bundleGeometry';
import { buildOriginGeometries, type OriginGeometries } from './originGeometry';

export type NodeOffsets = ReadonlyMap<string, { dx: number; dy: number }>;
export interface ParentLink {
  childId: string;
  parentId: string;
  bundleMemberCount?: number;
}

// Membership, parentage and branch selection do not change during a drag.
export function buildParentLinkTopology(cards: Card[], groups: Group[]) {
  const cardById = new Map(cards.map((card) => [card.id, card]));
  const groupById = new Map(groups.map((group) => [group.id, group]));
  const membersByBundle = new Map<string, Card[]>();
  const bundles = groups.filter((group) => group.kind === 'bundle');
  const bundleIds = new Set(bundles.map((group) => group.id));
  const legacyParents = new Map<string, string>();
  const parentById = new Map<string, string>();
  for (const card of cards) {
    if (card.bundleId) {
      const members = membersByBundle.get(card.bundleId) || [];
      members.push(card);
      membersByBundle.set(card.bundleId, members);
      if (card.groupId && !legacyParents.has(card.bundleId)) legacyParents.set(card.bundleId, card.groupId);
    }
    const parentId = card.bundleId && bundleIds.has(card.bundleId) ? card.bundleId : card.groupId;
    if (parentId) parentById.set(card.id, parentId);
  }
  const links: ParentLink[] = [];
  for (const bundle of bundles) {
    const parentId = bundle.parentIds?.[0] || legacyParents.get(bundle.id);
    if (!parentId) continue;
    parentById.set(bundle.id, parentId);
    links.push({ childId: bundle.id, parentId, bundleMemberCount: membersByBundle.get(bundle.id)?.length || 0 });
  }
  for (const card of cards) {
    if (card.bundleId && bundleIds.has(card.bundleId)) continue;
    if (card.groupId) links.push({ childId: card.id, parentId: card.groupId });
  }
  return { cards, groups, cardById, groupById, membersByBundle, parentById, links };
}

export function projectParentLinks(topology: ReturnType<typeof buildParentLinkTopology>,
  origins: OriginGeometries, offsets: NodeOffsets | null) {
  if (!offsets?.size) return { cards: topology.cards, groups: topology.groups, origins, lookup: topology };
  const changedCards = new Map<string, Card>();
  const changedGroups = new Map<string, Group>();
  const changedBundles = new Set<string>();
  for (const [id, offset] of offsets) {
    if (!offset.dx && !offset.dy) continue;
    const card = topology.cardById.get(id);
    const group = topology.groupById.get(id);
    if (card) {
      changedCards.set(id, { ...card, x: card.x + offset.dx, y: card.y + offset.dy });
      if (card.bundleId) changedBundles.add(card.bundleId);
    }
    if (group) changedGroups.set(id, { ...group, x: group.x + offset.dx, y: group.y + offset.dy });
  }
  if (!changedCards.size && !changedGroups.size) {
    return { cards: topology.cards, groups: topology.groups, origins, lookup: topology };
  }
  const membersByBundle = new Map(topology.membersByBundle);
  for (const id of changedBundles) {
    const members = (topology.membersByBundle.get(id) || []).map((card) => changedCards.get(card.id) || card);
    membersByBundle.set(id, members);
    const group = topology.groupById.get(id);
    if (group?.kind === 'bundle') changedGroups.set(id, bundleDisplayBounds(members, group));
  }
  const cards = changedCards.size ? topology.cards.map((card) => changedCards.get(card.id) || card) : topology.cards;
  const groups = changedGroups.size ? topology.groups.map((group) => changedGroups.get(group.id) || group) : topology.groups;
  const affectedOrigins = new Set<string>();
  for (const [id, geometry] of origins) {
    if (changedGroups.has(id) || geometry.branches.some((branch) =>
      changedCards.has(branch.branchId) || changedGroups.has(branch.branchId))) affectedOrigins.add(id);
  }
  let nextOrigins = origins;
  if (affectedOrigins.size) {
    // All bundles remain available for descendant counts and their centers;
    // expensive polygon sizing is needed only for origins whose axes moved.
    const rebuilt = buildOriginGeometries(cards, groups.filter((group) =>
      group.kind === 'bundle' || affectedOrigins.has(group.id)));
    nextOrigins = new Map(origins);
    for (const [id, geometry] of rebuilt) nextOrigins.set(id, geometry);
  }
  return { cards, groups, origins: nextOrigins, lookup: {
    cardById: changedCards.size ? new Map(cards.map((card) => [card.id, card])) : topology.cardById,
    groupById: changedGroups.size ? new Map(groups.map((group) => [group.id, group])) : topology.groupById,
    membersByBundle,
  } };
}
