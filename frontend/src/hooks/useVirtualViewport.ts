import { useMemo, useRef } from 'react';
import { Card, Group, Viewport } from '../types';
import { bundleDisplayBounds } from '../utils/bundleGeometry';
import { MIN_CANVAS_ZOOM } from '../utils/canvas';
import { cardVisualBounds } from '../utils/cardBounds';
import { SpatialIndex } from '../utils/spatialIndex';
import { originEnvelope, OriginGeometries } from '../utils/originGeometry';

interface UseVirtualViewportProps {
  viewport: Viewport;
  cards: Card[];
  groups: Group[];
  membersByBundle: Map<string, Card[]>;
  origins: OriginGeometries;
  selectedCardIds: Set<string>;
  selectedGroupIds: Set<string>;
  highlightedCardIds?: Set<string>;
  highlightedGroupIds?: Set<string>;
  isInteracting?: boolean;
  bufferPx?: number;
}

interface VirtualViewportResult {
  visibleCards: Card[];
  visibleGroups: Group[];
  visibleCardIdSet: Set<string>;
  viewportCardCount: number;
  isCullingActive: boolean;
}

interface CachedViewportResult {
  inputs: readonly unknown[];
  x: number;
  y: number;
  zoom: number;
  result: VirtualViewportResult;
}

const sameInputs = (previous: readonly unknown[], next: readonly unknown[]) =>
  previous.length === next.length && previous.every((value, index) => Object.is(value, next[index]));

export function useVirtualViewport({
  viewport,
  cards,
  groups,
  membersByBundle,
  origins,
  selectedCardIds,
  selectedGroupIds,
  highlightedCardIds,
  highlightedGroupIds,
  isInteracting = false,
  bufferPx = 300,
}: UseVirtualViewportProps) {
  const cardsById = useMemo(() => new Map(cards.map((card) => [card.id, card])), [cards]);
  const groupsById = useMemo(() => new Map(groups.map((group) => [group.id, group])), [groups]);
  const cardIndexRef = useRef<{ cards: Card[]; ids: string[]; index: SpatialIndex<Card> } | null>(null);
  const cardIndex = useMemo(() => {
    const previous = cardIndexRef.current;
    if (previous?.cards === cards) return previous.index;
    const idsUnchanged = previous && previous.ids.length === cards.length &&
      cards.every((card, index) => previous.ids[index] === card.id);
    if (isInteracting && idsUnchanged) return previous.index;
    const index = new SpatialIndex(cards, cardVisualBounds);
    cardIndexRef.current = { cards, ids: cards.map((card) => card.id), index };
    return index;
  }, [cards, isInteracting]);
  const groupBounds = (g: Group) => g.kind !== 'bundle' ? originEnvelope(g, origins.get(g.id))
    : bundleDisplayBounds(membersByBundle.get(g.id) || [], g);
  const groupIndexRef = useRef<{ groups: Group[]; membersByBundle: Map<string, Card[]>;
    origins: OriginGeometries; ids: string[]; index: SpatialIndex<Group> } | null>(null);
  const groupIndex = useMemo(() => {
    const previous = groupIndexRef.current;
    if (previous?.groups === groups && previous.membersByBundle === membersByBundle && previous.origins === origins) {
      return previous.index;
    }
    const idsUnchanged = previous && previous.ids.length === groups.length &&
      groups.every((group, index) => previous.ids[index] === group.id);
    if (isInteracting && idsUnchanged) return previous.index;
    const index = new SpatialIndex(groups, groupBounds);
    groupIndexRef.current = { groups, membersByBundle, origins, ids: groups.map((group) => group.id), index };
    return index;
  }, [groups, membersByBundle, origins, isInteracting]);
  const interactionQueryRef = useRef<{ key: string; cardIndex: SpatialIndex<Card>; groupIndex: SpatialIndex<Group>;
    cardIds: string[]; groupIds: string[] } | null>(null);
  const interactionResultRef = useRef<CachedViewportResult | null>(null);
  const lastResultRef = useRef<CachedViewportResult | null>(null);
  const winW = typeof window !== 'undefined' ? window.innerWidth : 1920;
  const winH = typeof window !== 'undefined' ? window.innerHeight : 1080;
  return useMemo((): VirtualViewportResult => {
    const inputs = [cards, groups, membersByBundle, origins, selectedCardIds, selectedGroupIds,
      highlightedCardIds, highlightedGroupIds, cardIndex, groupIndex, bufferPx, winW, winH];
    if (!isInteracting) {
      interactionQueryRef.current = null;
      interactionResultRef.current = null;
    } else {
      const cached = interactionResultRef.current;
      if (cached && sameInputs(cached.inputs, inputs)) return cached.result;
    }
    // A gesture ending can render once with the old deferred viewport. Reuse
    // that exact query instead of rebuilding the same sets before it catches up.
    const previous = lastResultRef.current;
    if (previous && sameInputs(previous.inputs, inputs) && previous.x === viewport.x &&
      previous.y === viewport.y && previous.zoom === viewport.zoom) {
      if (isInteracting) interactionResultRef.current = previous;
      return previous.result;
    }
    const remember = (result: VirtualViewportResult) => {
      const cached = { inputs, x: viewport.x, y: viewport.y, zoom: viewport.zoom, result };
      lastResultRef.current = cached;
      if (isInteracting) interactionResultRef.current = cached;
      return result;
    };

    if (cards.length === 0 && groups.length === 0) {
      const result = {
        visibleCards: [],
        visibleGroups: [],
        visibleCardIdSet: new Set<string>(),
        viewportCardCount: 0,
        isCullingActive: false,
      };
      return remember(result);
    }

    const zoom = Math.max(MIN_CANVAS_ZOOM, viewport.zoom);

    const bufferWorld = bufferPx / zoom;
    const minX = -viewport.x / zoom - bufferWorld;
    const minY = -viewport.y / zoom - bufferWorld;
    const maxX = (winW - viewport.x) / zoom + bufferWorld;
    const maxY = (winH - viewport.y) / zoom + bufferWorld;
    const viewportMinX = -viewport.x / zoom;
    const viewportMinY = -viewport.y / zoom;
    const viewportMaxX = (winW - viewport.x) / zoom;
    const viewportMaxY = (winH - viewport.y) / zoom;

    const visibleCards: Card[] = [];
    const visibleCardIdSet = new Set<string>();
    let viewportCardCount = 0;

    const query = { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
    const queryKey = `${minX}:${minY}:${maxX}:${maxY}:${cards.length}:${groups.length}`;
    const cachedQuery = isInteracting && interactionQueryRef.current?.key === queryKey &&
      interactionQueryRef.current.cardIndex === cardIndex && interactionQueryRef.current.groupIndex === groupIndex
      ? interactionQueryRef.current : null;
    const queriedCards = cachedQuery
      ? cachedQuery.cardIds.map(id => cardsById.get(id)).filter((card): card is Card => !!card)
      : cardIndex.query(query);
    const queriedGroups = cachedQuery
      ? cachedQuery.groupIds.map(id => groupsById.get(id)).filter((group): group is Group => !!group)
      : groupIndex.query(query);
    if (!cachedQuery) interactionQueryRef.current = {
      key: queryKey,
      cardIndex,
      groupIndex,
      cardIds: queriedCards.map(card => card.id),
      groupIds: queriedGroups.map(group => group.id),
    };
    const candidates = new Map(queriedCards.map((card) => [card.id, card]));
    for (const id of selectedCardIds) {
      const card = cardsById.get(id);
      if (card) candidates.set(id, card);
    }
    for (const id of highlightedCardIds || []) {
      const card = cardsById.get(id);
      if (card) candidates.set(id, card);
    }
    for (const candidate of candidates.values()) {
      const c = cardsById.get(candidate.id);
      if (!c) continue;
      const bounds = cardVisualBounds(c);
      // Always include selected cards so dragging never vanishes
      const isSelected = selectedCardIds.has(c.id) || !!highlightedCardIds?.has(c.id);
      const isVisible =
        isSelected ||
        (bounds.x + bounds.width >= minX &&
          bounds.x <= maxX &&
          bounds.y + bounds.height >= minY &&
          bounds.y <= maxY);

      if (isVisible) {
        visibleCards.push(c);
        visibleCardIdSet.add(c.id);
        if (bounds.x + bounds.width >= viewportMinX && bounds.x <= viewportMaxX &&
          bounds.y + bounds.height >= viewportMinY && bounds.y <= viewportMaxY) {
          viewportCardCount += 1;
        }
      }
    }

    const visibleGroups: Group[] = [];
    const groupCandidates = new Map(queriedGroups.map((group) => [group.id, group]));
    for (const id of selectedGroupIds) {
      const group = groupsById.get(id);
      if (group) groupCandidates.set(id, group);
    }
    for (const id of highlightedGroupIds || []) {
      const group = groupsById.get(id);
      if (group) groupCandidates.set(id, group);
    }
    for (const candidate of groupCandidates.values()) {
      const g = groupsById.get(candidate.id);
      if (!g) continue;
      const bounds = groupBounds(g);
      const isSelected = selectedGroupIds.has(g.id) || !!highlightedGroupIds?.has(g.id);
      const isVisible =
        isSelected ||
        (bounds.x + bounds.width >= minX &&
          bounds.x <= maxX &&
          bounds.y + bounds.height >= minY &&
          bounds.y <= maxY);

      if (isVisible) {
        visibleGroups.push(g);
      }
    }

    const result = {
      visibleCards,
      visibleGroups,
      visibleCardIdSet,
      viewportCardCount,
      isCullingActive: true,
    };
    return remember(result);
  }, [
    viewport.x,
    viewport.y,
    viewport.zoom,
    cards,
    groups,
    membersByBundle,
    origins,
    selectedCardIds,
    selectedGroupIds,
    highlightedCardIds,
    highlightedGroupIds,
    isInteracting,
    bufferPx,
    cardIndex,
    groupIndex,
    cardsById,
    groupsById,
    winW,
    winH,
  ]);
}
