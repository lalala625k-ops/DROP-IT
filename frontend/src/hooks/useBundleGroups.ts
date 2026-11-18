import { useCallback, MutableRefObject } from 'react';
import { Card, Group } from '../types';
import { saveStateDebounced } from '../utils/storage';
import { canAttachTreeNode, getBundleParentIds, normalizeTreeData } from '../utils/groupRelations';
import { cardHeaderReserve } from '../utils/cardBounds';
import { cardDefaultSize } from '../utils/cardDefaultSize';
import { bundleDisplayBounds, bundleDisplayOutlinePoints, bundleOutlinePoints, bundleBoundsFromMembers } from '../utils/bundleGeometry';
import { bringBundleCardToFront, bundleStackMembers } from '../utils/bundleStack';
import { bundleCollapseAnchor } from '../utils/bundleCollapseAnchor';
export { bundleDisplayBounds, bundleDisplayOutlinePoints, bundleOutlinePoints, bundleBoundsFromMembers } from '../utils/bundleGeometry';

const PAD = 18;
export type BundleResizeCorner = 'nw' | 'ne' | 'se' | 'sw';

export function bundleOutline(members: Card[], group: Group) {
  const hull = bundleOutlinePoints(members, group);
  return `M ${hull.map((point) => `${point.x} ${point.y}`).join(' L ')} Z`;
}

export function bundleResizeHandles(members: Card[], group: Group) {
  const outline = bundleOutlinePoints(members, group);
  const minX = Math.min(...outline.map((point) => point.x));
  const maxX = Math.max(...outline.map((point) => point.x));
  const minY = Math.min(...outline.map((point) => point.y));
  const maxY = Math.max(...outline.map((point) => point.y));
  const corners: { corner: BundleResizeCorner; x: number; y: number }[] = [
    { corner: 'nw', x: minX, y: minY }, { corner: 'ne', x: maxX, y: minY },
    { corner: 'se', x: maxX, y: maxY }, { corner: 'sw', x: minX, y: maxY },
  ];
  const used = new Set<number>();
  return corners.map(({ corner, x, y }) => {
    let closest = 0;
    let distance = Infinity;
    outline.forEach((point, index) => {
      if (used.has(index)) return;
      const nextDistance = (point.x - x) ** 2 + (point.y - y) ** 2;
      if (nextDistance < distance) { distance = nextDistance; closest = index; }
    });
    used.add(closest);
    return { corner, point: outline[closest] };
  });
}

export function bundleBounds(cards: Card[], bundleId: string, fallback: Group) {
  return bundleBoundsFromMembers(cards.filter((card) => card.bundleId === bundleId), fallback);
}

function pointInOutline(point: { x: number; y: number }, outline: { x: number; y: number }[]) {
  let inside = false;
  for (let i = 0, j = outline.length - 1; i < outline.length; j = i++) {
    const a = outline[j];
    const b = outline[i];
    const cross = (point.x - a.x) * (b.y - a.y) - (point.y - a.y) * (b.x - a.x);
    if (Math.abs(cross) < 1e-6 && point.x >= Math.min(a.x, b.x) && point.x <= Math.max(a.x, b.x)
      && point.y >= Math.min(a.y, b.y) && point.y <= Math.max(a.y, b.y)) return true;
    if ((a.y > point.y) !== (b.y > point.y)
      && point.x < (b.x - a.x) * (point.y - a.y) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

export function containsBundlePoint(group: Group, cards: Card[], point: { x: number; y: number }) {
  const members = cards.filter((card) => card.bundleId === group.id);
  const bounds = group.collapsed ? group : bundleBoundsFromMembers(members, group);
  const outline = bundleDisplayOutlinePoints(members, bounds);
  return pointInOutline({ x: point.x - bounds.x, y: point.y - bounds.y }, outline);
}

export function addDraggedCardsToBundles(cards: Card[], groups: Group[], draggedIds: Set<string>,
  initialCards: Card[], initialGroups: Group[]) {
  const bundles = groups.filter((group) => group.kind === 'bundle').reverse();
  let addedCount = 0;
  const inheritedParents = new Map<string, string>();
  const nextCards = cards.map((card) => {
    if (!draggedIds.has(card.id)) return card;
    const center = { x: card.x + card.width / 2, y: card.y + card.height / 2 };
    const initialCard = initialCards.find((item) => item.id === card.id);
    const target = bundles.find((group) => {
      if (group.id === card.bundleId) return false;
      const initialGroup = initialGroups.find((item) => item.id === group.id);
      const initialCenter = initialCard && { x: initialCard.x + initialCard.width / 2, y: initialCard.y + initialCard.height / 2 };
      return containsBundlePoint(group, cards, center) && canAttachTreeNode(card.id, group.id, cards, groups)
        && (!initialGroup || !initialCenter || !containsBundlePoint(initialGroup, initialCards, initialCenter));
    });
    if (!target) return card;
    addedCount++;
    if (card.groupId && !getBundleParentIds(cards, target).length
      && canAttachTreeNode(target.id, card.groupId, cards, groups)) {
      inheritedParents.set(target.id, card.groupId);
    }
    return { ...card, bundleId: target.id,
      contentScale: (target.outlinePadding ?? PAD) / PAD };
  });
  const occupied = new Set(nextCards.map((card) => card.bundleId).filter(Boolean));
  const nextGroups = groups.filter((group) => group.kind !== 'bundle' || occupied.has(group.id))
    .map((group) => group.kind === 'bundle'
      ? bundleBounds(nextCards, group.id, inheritedParents.has(group.id)
        ? { ...group, parentIds: [inheritedParents.get(group.id)!] } : group) : group);
  return { nextCards, nextGroups, addedCount };
}

interface Props {
  cardsRef: MutableRefObject<Card[]>;
  setCards: React.Dispatch<React.SetStateAction<Card[]>>;
  groupsRef: MutableRefObject<Group[]>;
  setGroups: React.Dispatch<React.SetStateAction<Group[]>>;
  selectedCardIdsRef: MutableRefObject<Set<string>>;
  setSelectedCardIds: (ids: Set<string>) => void;
  setSelectedGroupIds: (ids: Set<string>) => void;
  zoomRef: MutableRefObject<{ zoom: number }>;
  pushHistory: (cards: Card[], groups: Group[]) => void;
  showToast: (message: string) => void;
}

export function useBundleGroups({ cardsRef, setCards, groupsRef, setGroups, selectedCardIdsRef,
  setSelectedCardIds, setSelectedGroupIds, zoomRef, pushHistory, showToast }: Props) {
  const createBundle = useCallback(() => {
    const ids = selectedCardIdsRef.current;
    const members = cardsRef.current.filter((card) => ids.has(card.id));
    if (!members.length) {
      showToast('请先框选要打组的卡片');
      return;
    }
    pushHistory(cardsRef.current, groupsRef.current);
    const id = `bundle-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const nextCards = cardsRef.current.map((card) => ids.has(card.id)
      ? { ...card, bundleId: id, contentScale: 1 } : card);
    const newBundle: Group = bundleBounds(nextCards, id, {
      id, kind: 'bundle', title: '', x: 0, y: 0, width: 180, height: 100,
      collapsed: false, tags: [], zIndex: 1,
    });
    const occupied = new Set(nextCards.map((card) => card.bundleId).filter(Boolean));
    const nextGroups = [...groupsRef.current.filter((group) => group.kind !== 'bundle' || occupied.has(group.id)), newBundle];
    const tree = normalizeTreeData(nextCards, nextGroups);
    setCards(tree.cards);
    setGroups(tree.groups);
    saveStateDebounced(tree.cards, tree.groups);
    setSelectedCardIds(new Set());
    setSelectedGroupIds(new Set([id]));
  }, [cardsRef, groupsRef, pushHistory, selectedCardIdsRef, setCards, setGroups, setSelectedCardIds, setSelectedGroupIds]);

  const updateBundle = useCallback((id: string, changes: Partial<Group>) => {
    pushHistory(cardsRef.current, groupsRef.current);
    const next = groupsRef.current.map((group) => group.id === id ? { ...group, ...changes } : group);
    setGroups(next);
    saveStateDebounced(cardsRef.current, next);
  }, [cardsRef, groupsRef, pushHistory, setGroups]);

  const toggleBundle = useCallback((id: string) => {
    const bundle = groupsRef.current.find((group) => group.id === id && group.kind === 'bundle');
    if (!bundle) return;
    const bounds = bundleBounds(cardsRef.current, id, bundle);
    updateBundle(id, { x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height,
      collapsed: !bundle.collapsed, collapsedAnchor: bundleCollapseAnchor(bundle, cardsRef.current, groupsRef.current) });
    if (!bundle.collapsed) setSelectedCardIds(new Set());
  }, [cardsRef, groupsRef, setSelectedCardIds, updateBundle]);

  const bringMemberToFront = useCallback((id: string, cardId: string) => {
    const group = groupsRef.current.find(item => item.id === id && item.kind === 'bundle' && item.collapsed);
    if (!group) return;
    const members = cardsRef.current.filter(card => card.bundleId === id);
    if (!members.some(card => card.id === cardId) || bundleStackMembers(members, group)[0]?.id === cardId) return;
    updateBundle(id, { collapsedCardOrder: bringBundleCardToFront(members, group, cardId) });
  }, [cardsRef, groupsRef, updateBundle]);

  const ungroupBundle = useCallback((id: string) => {
    if (!groupsRef.current.some((group) => group.id === id && group.kind === 'bundle')) return;
    pushHistory(cardsRef.current, groupsRef.current);
    const bundle = groupsRef.current.find((group) => group.id === id)!;
    const parentId = getBundleParentIds(cardsRef.current, bundle)[0] || null;
    const nextCards = cardsRef.current.map((card) => card.bundleId === id
      ? { ...card, bundleId: null, groupId: parentId, contentScale: 1 }
      : card.groupId === id ? { ...card, groupId: parentId } : card);
    const nextGroups = groupsRef.current.filter((group) => group.id !== id)
      .map((group) => group.parentIds?.includes(id)
        ? { ...group, parentIds: parentId ? [parentId] : [] } : group);
    setCards(nextCards);
    setGroups(nextGroups);
    saveStateDebounced(nextCards, nextGroups);
    setSelectedGroupIds(new Set());
  }, [cardsRef, groupsRef, pushHistory, setCards, setGroups, setSelectedGroupIds]);

  const detachCardFromBundle = useCallback((cardId: string) => {
    const card = cardsRef.current.find((item) => item.id === cardId);
    if (!card?.bundleId) return;
    const bundleId = card.bundleId;
    const bundle = groupsRef.current.find((group) => group.id === bundleId);
    const parentId = bundle ? getBundleParentIds(cardsRef.current, bundle)[0] || null : null;
    pushHistory(cardsRef.current, groupsRef.current);
    const nextCards = cardsRef.current.map((item) => item.id === cardId
      ? { ...item, bundleId: null, groupId: parentId, contentScale: 1 } : item);
    const hasMembers = nextCards.some((item) => item.bundleId === bundleId);
    const settledCards = hasMembers ? nextCards : nextCards.map((item) => item.groupId === bundleId
      ? { ...item, groupId: parentId } : item);
    const nextGroups = groupsRef.current
      .filter((group) => group.id !== bundleId || hasMembers)
      .map((group) => group.id === bundleId ? bundleBounds(settledCards, bundleId, group)
        : !hasMembers && group.parentIds?.includes(bundleId)
          ? { ...group, parentIds: parentId ? [parentId] : [] } : group);
    setCards(settledCards);
    setGroups(nextGroups);
    saveStateDebounced(settledCards, nextGroups);
    if (!hasMembers) setSelectedGroupIds(new Set());
  }, [cardsRef, groupsRef, pushHistory, setCards, setGroups, setSelectedGroupIds]);

  const disconnectCardParent = useCallback((cardId: string) => {
    const card = cardsRef.current.find((item) => item.id === cardId);
    if (!card?.groupId) return;
    pushHistory(cardsRef.current, groupsRef.current);
    const nextCards = cardsRef.current.map((item) => item.id === cardId ? { ...item, groupId: null } : item);
    setCards(nextCards);
    saveStateDebounced(nextCards, groupsRef.current);
  }, [cardsRef, groupsRef, pushHistory, setCards]);

  const disconnectBundleParent = useCallback((bundleId: string, parentId: string) => {
    if (!cardsRef.current.some((card) => card.bundleId === bundleId && card.groupId === parentId)
      && !groupsRef.current.some((group) => group.id === bundleId && group.parentIds?.includes(parentId))) return;
    pushHistory(cardsRef.current, groupsRef.current);
    const nextCards = cardsRef.current.map((card) => card.bundleId === bundleId && card.groupId === parentId
      ? { ...card, groupId: null } : card);
    const nextGroups = groupsRef.current.map((group) => group.id === bundleId
      ? { ...group, parentIds: (group.parentIds || []).filter((id) => id !== parentId) } : group);
    setCards(nextCards);
    setGroups(nextGroups);
    saveStateDebounced(nextCards, nextGroups);
  }, [cardsRef, groupsRef, pushHistory, setCards, setGroups]);

  const resetBundleSize = useCallback((id: string) => {
    const storedGroup = groupsRef.current.find((group) => group.id === id && group.kind === 'bundle');
    if (!storedGroup) return;
    const scale = (storedGroup.outlinePadding ?? PAD) / PAD;
    if (!Number.isFinite(scale) || scale <= 0) return;
    const members = cardsRef.current.filter((card) => card.bundleId === id);
    const changed = Math.abs(scale - 1) >= 0.001 || members.some((card) => {
      const size = cardDefaultSize(card, scale);
      return Math.abs(card.width - size.width) > 0.5 || Math.abs(card.height - size.height) > 0.5
        || !!card.sizeLocked;
    });
    if (!changed) return;
    const group = bundleBounds(cardsRef.current, id, storedGroup);
    const center = { x: group.x + group.width / 2, y: group.y + group.height / 2 };
    pushHistory(cardsRef.current, groupsRef.current);
    const nextCards = cardsRef.current.map((card) => {
      if (card.bundleId !== id) return card;
      const size = cardDefaultSize(card, scale);
      const cardCenterX = center.x + (card.x + card.width / 2 - center.x) / scale;
      const cardCenterY = center.y + (card.y + card.height / 2 - center.y) / scale;
      return { ...card, x: cardCenterX - size.width / 2, y: cardCenterY - size.height / 2,
        width: size.width, height: size.height,
        defaultWidth: size.width, defaultHeight: size.height,
        sizeLocked: false, contentScale: 1 };
    });
    const nextGroups = groupsRef.current.map((item) => item.id === id
      ? bundleBounds(nextCards, id, { ...item, outlinePadding: PAD }) : item);
    setCards(nextCards);
    setGroups(nextGroups);
    saveStateDebounced(nextCards, nextGroups);
  }, [cardsRef, groupsRef, pushHistory, setCards, setGroups]);

  const startBundleResize = useCallback((id: string, corner: BundleResizeCorner, event: React.MouseEvent) => {
    if (event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    const startingCards = cardsRef.current;
    const startingGroups = groupsRef.current;
    const storedGroup = startingGroups.find((group) => group.id === id && group.kind === 'bundle');
    if (!storedGroup) return;
    const members = startingCards.filter((card) => card.bundleId === id);
    if (!members.length) return;
    const memberIndexes = startingCards.reduce<number[]>((indexes, card, index) => {
      if (card.bundleId === id) indexes.push(index);
      return indexes;
    }, []);
    const group = bundleBounds(startingCards, id, storedGroup);
    const outline = bundleOutlinePoints(members, group);
    const handle = bundleResizeHandles(members, group).find((item) => item.corner === corner);
    if (!handle) return;
    const minX = group.x + Math.min(...outline.map((point) => point.x));
    const maxX = group.x + Math.max(...outline.map((point) => point.x));
    const minY = group.y + Math.min(...outline.map((point) => point.y));
    const maxY = group.y + Math.max(...outline.map((point) => point.y));
    const anchor = { x: corner.includes('w') ? maxX : minX, y: corner.includes('n') ? maxY : minY };
    const vector = { x: group.x + handle.point.x - anchor.x, y: group.y + handle.point.y - anchor.y };
    const vectorLengthSquared = vector.x ** 2 + vector.y ** 2;
    const startPointer = { x: event.clientX, y: event.clientY };
    const zoom = zoomRef.current.zoom;
    const minimumScale = Math.min(1, Math.max(0.03,
      ...members.map((card) => 12 / (Math.min(card.width, card.height) * zoom))));
    const getScale = (pointer: MouseEvent) => {
      const dx = (pointer.clientX - startPointer.x) / zoom;
      const dy = (pointer.clientY - startPointer.y) / zoom;
      const projected = vectorLengthSquared > 0
        ? 1 + (dx * vector.x + dy * vector.y) / vectorLengthSquared : 1;
      return Math.min(8, Math.max(minimumScale, projected));
    };
    const scaledState = (scale: number) => {
      const scaledMembers = members.map((card) => ({
        ...card,
        defaultWidth: card.defaultWidth ?? card.width / ((group.outlinePadding ?? PAD) / PAD),
        defaultHeight: card.defaultHeight ?? card.height / ((group.outlinePadding ?? PAD) / PAD),
        x: anchor.x + (card.x - anchor.x) * scale,
        y: anchor.y + (card.y - anchor.y) * scale,
        width: card.width * scale,
        height: card.height * scale,
        sizeLocked: card.type === 'web' || card.type === 'file' ? true : card.sizeLocked,
        contentScale: ((group.outlinePadding ?? PAD) / PAD) * scale,
      }));
      const nextCards = startingCards.slice();
      memberIndexes.forEach((index, memberIndex) => { nextCards[index] = scaledMembers[memberIndex]; });
      const scaledGroup = { ...group, outlinePadding: (group.outlinePadding ?? PAD) * scale };
      const nextGroups = startingGroups.map((item) => item.id === id
        ? bundleBoundsFromMembers(scaledMembers, scaledGroup) : item);
      return { nextCards, nextGroups };
    };
    setSelectedCardIds(new Set());
    setSelectedGroupIds(new Set([id]));
    let moved = false;
    let frame: number | null = null;
    let pendingScale: number | null = null;
    const applyPendingScale = () => {
      frame = null;
      if (pendingScale === null) return;
      const { nextCards, nextGroups } = scaledState(pendingScale);
      setCards(nextCards);
      setGroups(nextGroups);
      pendingScale = null;
    };
    const onMove = (moveEvent: MouseEvent) => {
      const scale = getScale(moveEvent);
      if (!moved && Math.abs(scale - 1) < 0.005) return;
      if (!moved) pushHistory(startingCards, startingGroups);
      moved = true;
      pendingScale = scale;
      if (frame === null) frame = window.requestAnimationFrame(applyPendingScale);
    };
    const onUp = (upEvent: MouseEvent) => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      if (!moved) return;
      if (frame !== null) window.cancelAnimationFrame(frame);
      frame = null;
      const { nextCards, nextGroups } = scaledState(getScale(upEvent));
      pendingScale = null;
      setCards(nextCards);
      setGroups(nextGroups);
      saveStateDebounced(nextCards, nextGroups);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }, [cardsRef, groupsRef, pushHistory, setCards, setGroups, setSelectedCardIds, setSelectedGroupIds, zoomRef]);

  const startBundleDrag = useCallback((id: string, event: React.MouseEvent) => {
    if (event.button !== 0) return;
    event.stopPropagation();
    const bundle = groupsRef.current.find((group) => group.id === id);
    if (!bundle) return;
    setSelectedCardIds(new Set());
    setSelectedGroupIds(new Set([id]));
    const origin = { x: event.clientX, y: event.clientY };
    const startingCards = cardsRef.current;
    const startingGroups = groupsRef.current;
    const zoom = zoomRef.current.zoom;
    let moved = false;
    const onMove = (moveEvent: MouseEvent) => {
      const dx = (moveEvent.clientX - origin.x) / zoom;
      const dy = (moveEvent.clientY - origin.y) / zoom;
      if (Math.hypot(dx, dy) < 2 && !moved) return;
      if (!moved) pushHistory(startingCards, startingGroups);
      moved = true;
      setCards(startingCards.map((card) => card.bundleId === id ? { ...card, x: card.x + dx, y: card.y + dy } : card));
      setGroups(startingGroups.map((group) => group.id === id ? { ...group, x: group.x + dx, y: group.y + dy } : group));
    };
    const onUp = (upEvent: MouseEvent) => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      if (!moved) return;
      const dx = (upEvent.clientX - origin.x) / zoom;
      const dy = (upEvent.clientY - origin.y) / zoom;
      const nextCards = startingCards.map((card) => card.bundleId === id ? { ...card, x: card.x + dx, y: card.y + dy } : card);
      const nextGroups = startingGroups.map((group) => group.id === id ? { ...group, x: group.x + dx, y: group.y + dy } : group);
      setCards(nextCards);
      setGroups(nextGroups);
      saveStateDebounced(nextCards, nextGroups);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }, [cardsRef, groupsRef, pushHistory, setCards, setGroups, setSelectedCardIds, setSelectedGroupIds, zoomRef]);

  return { createBundle, updateBundle, toggleBundle, bringMemberToFront, ungroupBundle, detachCardFromBundle,
    disconnectCardParent, disconnectBundleParent, resetBundleSize, startBundleDrag, startBundleResize };
}
