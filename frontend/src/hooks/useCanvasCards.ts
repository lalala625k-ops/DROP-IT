import { useMemo, useRef } from 'react';
import { Card } from '../types';
import type { Group } from '../types';
import { bundleTitleLayout } from '../utils/bundleStack';

/** Preserve card identity so moving one image cannot rerender every card. */
export function useCanvasCards(cards: Card[], collapsedIds: Set<string>, revealedCardId?: string | null, groups?: Group[]) {
  const projections = useRef(new WeakMap<Card, Card>());
  return useMemo(() => {
    // The common flat-board path needs no projection work. Returning the
    // source array also keeps every unchanged card reference stable while a
    // different card is being dragged.
    if (collapsedIds.size === 0 && !revealedCardId) return cards;
    let revealedPage: ReturnType<typeof bundleTitleLayout>['pages'][number] | undefined;
    let revealedGroupId: string | null = null;
    if (revealedCardId) {
      const revealedCard = cards.find(card => card.id === revealedCardId);
      if (revealedCard?.bundleId && collapsedIds.has(revealedCard.bundleId)) {
        const group = groups?.find(item => item.id === revealedCard.bundleId);
        if (group) {
          const members = cards.filter(member => member.bundleId === group.id);
          revealedPage = bundleTitleLayout(members, group).pages.find(page => page.card.id === revealedCardId);
          revealedGroupId = group.id;
        }
      }
    }
    const revealedZIndex = revealedPage
      ? cards.reduce((max, card) => Math.max(max, card.zIndex), 0) + 1 : 0;
    const result: Card[] = [];
    for (const card of cards) {
      if (card.bundleId && collapsedIds.has(card.bundleId) && card.id !== revealedCardId) continue;
      if (card.id === revealedCardId && card.bundleId === revealedGroupId && revealedPage) {
        result.push({ ...card, x: revealedPage.x, y: revealedPage.y + revealedPage.height - card.height,
          zIndex: revealedZIndex, textColor: undefined, borderColor: undefined });
        continue;
      }
      if (card.textColor === undefined && card.borderColor === undefined) {
        result.push(card);
        continue;
      }
      let projected = projections.current.get(card);
      if (!projected) {
        projected = { ...card, textColor: undefined, borderColor: undefined };
        projections.current.set(card, projected);
      }
      result.push(projected);
    }
    return result;
  }, [cards, collapsedIds, revealedCardId, groups]);
}
