import type { Card, Group } from '../types';
export const INK = '#1d1d1d';
export const ASH = '#a8a7a2';

export function normalizeBranchColor(color?: string | null): string | undefined {
  if (!color) return;
  if (/^#[\da-f]{6}$/i.test(color)) return color.toUpperCase();
  if (/^#[\da-f]{3}$/i.test(color)) return '#' + [...color.slice(1)].map(c => c + c).join('').toUpperCase();
}

/** Resolve stored colors without putting inherited presentation values into saved objects. */
export function resolveBranchColors(cards: Card[], groups: Group[]): Map<string, string> {
  const parents = new Map<string, string>();
  const explicit = new Map<string, string>();
  const bundleIds = new Set(groups.filter(g => g.kind === 'bundle').map(g => g.id));
  const legacyParents = new Map<string, string>();
  for (const card of cards) {
    if (card.bundleId && card.groupId && !legacyParents.has(card.bundleId)) legacyParents.set(card.bundleId, card.groupId);
    const parent = card.bundleId && bundleIds.has(card.bundleId) ? card.bundleId : card.groupId;
    if (parent) parents.set(card.id, parent);
  }
  for (const group of groups) if (group.kind === 'bundle') {
    const parent = group.parentIds !== undefined ? group.parentIds[0] : legacyParents.get(group.id);
    if (parent) parents.set(group.id, parent);
  }
  for (const node of [...cards, ...groups]) {
    const color = normalizeBranchColor(node.color);
    if (color) explicit.set(node.id, color);
  }
  const colors = new Map<string, string>();
  const resolved = new Set<string>();
  // Iterative resolution also handles deep trees and malformed legacy cycles.
  for (const node of [...cards, ...groups]) {
    const path: string[] = [], visited = new Set<string>();
    let id: string | undefined = node.id;
    while (id && !resolved.has(id) && !explicit.has(id) && !visited.has(id)) {
      path.push(id); visited.add(id); id = parents.get(id);
    }
    const color = id ? colors.get(id) || explicit.get(id) : undefined;
    if (id && color) colors.set(id, color);
    if (id) resolved.add(id);
    path.forEach(key => { resolved.add(key); if (color) colors.set(key, color); });
  }
  return colors;
}

/**
 * Set only the selected branch roots' explicit colors.
 * Descendants without an explicit color inherit at render time; descendants
 * that already have one remain independent sub-branches.
 */
export function recolorBranch(cards: Card[], groups: Group[], roots: ReadonlySet<string>, color?: string) {
  const ids = new Set([...cards, ...groups].map(node => node.id));
  const validRoots = new Set([...roots].filter(id => ids.has(id)));
  const apply = <T extends Card | Group>(node: T): T => {
    if (!validRoots.has(node.id)) return node;
    const nextColor = normalizeBranchColor(color);
    if (normalizeBranchColor(node.color) === nextColor) return node;
    return { ...node, color: nextColor };
  };
  return { cards: cards.map(apply), groups: groups.map(apply) };
}

function mix(from: string, to: string, weight: number): string {
  const a = normalizeBranchColor(from) || INK, b = normalizeBranchColor(to) || ASH;
  return `#${[1, 3, 5].map(i => Math.round(parseInt(a.slice(i, i + 2), 16) * weight +
    parseInt(b.slice(i, i + 2), 16) * (1 - weight)).toString(16).padStart(2, '0')).join('')}`;
}

/** Keep resting strokes pale and active strokes stronger without changing hue. */
export function branchStroke(color?: string, active = false, memberCount?: number): string {
  const accent = normalizeBranchColor(color);
  const progress = memberCount === undefined ? 0 : Math.min(Math.max(memberCount - 1, 0), 9) / 9;
  if (accent) return active ? accent : mix(accent, '#d6d4ca', 0.48 + progress * 0.22);
  return active ? INK : mix(INK, ASH, progress);
}
