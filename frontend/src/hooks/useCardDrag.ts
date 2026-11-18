import { useState, useRef, useCallback } from 'react';
import { Card, Group, SnapLine } from '../types';
import { calculateMagneticSnapping } from '../utils/snap';
import { isPointInRect } from '../utils/canvas';
import { getParentLinkage } from '../utils/groupRelations';

export function useCardDrag() {
  const [snapLines, setSnapLines] = useState<SnapLine[]>([]);
  const [dragOverGroupId, setDragOverGroupId] = useState<string | null>(null);
  const initialPositionsRef = useRef<Map<string, { x: number; y: number }>>(new Map());
  const cardIndexByIdRef = useRef<Map<string, number> | null>(null);
  const activeDragGroupIdRef = useRef<string | null>(null);
  const linkedCardIdsRef = useRef<Set<string>>(new Set());
  const linkedBundleIdsRef = useRef<Set<string>>(new Set());

  const sameSnapLines = (left: SnapLine[], right: SnapLine[]) =>
    left.length === right.length && left.every((line, index) => {
      const other = right[index];
      return other && line.type === other.type && line.position === other.position &&
        line.start === other.start && line.end === other.end;
    });

  const computeCardDragDelta = useCallback(
    (
      deltaWorldX: number,
      deltaWorldY: number,
      selectedIds: Set<string>,
      allCards: Card[],
      enableSnap: boolean,
    ) => {
      let dx = deltaWorldX;
      let dy = deltaWorldY;
      let lines: SnapLine[] = [];

      if (enableSnap && selectedIds.size === 1) {
        const firstId = Array.from(selectedIds)[0];
        const initialPos = initialPositionsRef.current.get(firstId);
        const cardObj = allCards.find((c) => c.id === firstId);

        if (initialPos && cardObj) {
          const tempCard = { ...cardObj, x: initialPos.x + dx, y: initialPos.y + dy };
          const otherCards = allCards.filter((c) => !selectedIds.has(c.id));
          const snapRes = calculateMagneticSnapping(tempCard, otherCards, 12);
          dx += snapRes.deltaX;
          dy += snapRes.deltaY;
          lines = snapRes.snapLines;
        }
      }

      setSnapLines((previous) => sameSnapLines(previous, lines) ? previous : lines);
      return { dx, dy };
    },
    []
  );

  const initDragCards = useCallback((selectedCards: Card[]) => {
    initialPositionsRef.current.clear();
    cardIndexByIdRef.current = null;
    selectedCards.forEach((c) => {
      initialPositionsRef.current.set(c.id, { x: c.x, y: c.y });
    });
  }, []);

  const initDragGroup = useCallback((group: Group, allCards: Card[], allGroups: Group[]) => {
    activeDragGroupIdRef.current = group.id;
    initialPositionsRef.current.clear();
    cardIndexByIdRef.current = null;
    initialPositionsRef.current.set(group.id, { x: group.x, y: group.y });
    const linked = getParentLinkage(allCards, group.id, allGroups);
    linkedCardIdsRef.current = linked.cardIds;
    linkedBundleIdsRef.current = linked.bundleIds;
    allCards
      .filter((c) => linked.cardIds.has(c.id))
      .forEach((c) => {
        initialPositionsRef.current.set(c.id, { x: c.x, y: c.y });
      });
    allGroups.filter((item) => linked.bundleIds.has(item.id)).forEach((item) => {
      initialPositionsRef.current.set(item.id, { x: item.x, y: item.y });
    });
  }, []);

  const updateCardPositions = useCallback(
    (
      deltaWorldX: number,
      deltaWorldY: number,
      selectedIds: Set<string>,
      allCards: Card[],
      enableSnap: boolean,
      setCards: React.Dispatch<React.SetStateAction<Card[]>>,
      groups: Group[] = [],
      isCtrlPressed = false
    ) => {
      const { dx, dy } = computeCardDragDelta(deltaWorldX, deltaWorldY, selectedIds, allCards, enableSnap);

      setDragOverGroupId(null);

      if (!cardIndexByIdRef.current || cardIndexByIdRef.current.size !== allCards.length) {
        cardIndexByIdRef.current = new Map(allCards.map((card, index) => [card.id, index]));
      }
      setCards((prev) => {
        const next = prev.slice();
        let changed = false;
        for (const [id, initial] of initialPositionsRef.current) {
          const index = cardIndexByIdRef.current?.get(id);
          if (index === undefined || !next[index]) continue;
          const card = next[index];
          const x = initial.x + dx;
          const y = initial.y + dy;
          if (card.x === x && card.y === y) continue;
          next[index] = { ...card, x, y };
          changed = true;
        }
        return changed ? next : prev;
      });
    },
    [computeCardDragDelta]
  );

  const updateGroupPositions = useCallback(
    (
      deltaWorldX: number,
      deltaWorldY: number,
      groupId: string,
      setGroups: React.Dispatch<React.SetStateAction<Group[]>>,
      setCards: React.Dispatch<React.SetStateAction<Card[]>>,
      moveChildren = false
    ) => {
      const targetGId = groupId || activeDragGroupIdRef.current;
      if (!targetGId) return;

      setGroups((prev) => prev.map((g) => {
        const init = initialPositionsRef.current.get(g.id);
        if (!init) return g;
        if (g.id === targetGId || (moveChildren && linkedBundleIdsRef.current.has(g.id))) {
          return { ...g, x: init.x + deltaWorldX, y: init.y + deltaWorldY };
        }
        if (linkedBundleIdsRef.current.has(g.id) && (g.x !== init.x || g.y !== init.y)) {
          return { ...g, x: init.x, y: init.y };
        }
        return g;
      }));
      if (moveChildren) {
        setCards((prev) =>
          prev.map((c) => {
            if (!linkedCardIdsRef.current.has(c.id)) return c;
            const init = initialPositionsRef.current.get(c.id);
            return init ? { ...c, x: init.x + deltaWorldX, y: init.y + deltaWorldY } : c;
          })
        );
      } else {
        setCards((prev) => {
          let hasDiff = false;
          const next = prev.map((c) => {
            if (!linkedCardIdsRef.current.has(c.id)) return c;
            const init = initialPositionsRef.current.get(c.id);
            if (init && (c.x !== init.x || c.y !== init.y)) {
              hasDiff = true;
              return { ...c, x: init.x, y: init.y };
            }
            return c;
          });
          return hasDiff ? next : prev;
        });
      }
    },
    []
  );

  const finishGroupDrag = useCallback(() => {
    activeDragGroupIdRef.current = null;
    initialPositionsRef.current.clear();
    cardIndexByIdRef.current = null;
    linkedCardIdsRef.current.clear();
    linkedBundleIdsRef.current.clear();
  }, []);

  const finishCardDrag = useCallback(
    (
      cards: Card[],
      groups: Group[],
      selectedIds: Set<string>,
      isCtrlPressed = false
    ): { nextCards: Card[]; toastMessage?: string } => {
      setSnapLines([]);
      initialPositionsRef.current.clear();
      cardIndexByIdRef.current = null;
      setDragOverGroupId(null);

      return { nextCards: cards };
    },
    []
  );

  return {
    snapLines,
    dragOverGroupId,
    setDragOverGroupId,
    setSnapLines,
    initDragCards,
    initDragGroup,
    computeCardDragDelta,
    updateCardPositions,
    updateGroupPositions,
    finishCardDrag,
    finishGroupDrag,
  };
}
