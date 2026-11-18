import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { Card, Viewport } from '../types';
import { farCardOnScreen } from '../utils/farCardDrawing';

export const DOM_HANDOFF_BATCH_SIZE = 16;
export const DOM_IMAGE_READY_CHECK_MS = 80;

function visibleImagesReady(visibleIds: ReadonlySet<string>) {
  if (typeof document === 'undefined') return true;
  const imagesByCard = new Map<string, { ready: boolean; terminal: boolean }>();
  // One scan of explicitly marked cover layers; favicons and other decorative
  // images cannot finish a card's handoff. An already-ready fallback is enough.
  for (const image of document.querySelectorAll<HTMLElement>('[data-canvas-image]')) {
    const id = image.closest('[data-card-id]')?.getAttribute('data-card-id');
    if (!id || !visibleIds.has(id)) continue;
    const previous = imagesByCard.get(id);
    imagesByCard.set(id, {
      ready: !!previous?.ready || image.dataset.imageReady === 'true',
      terminal: (previous?.terminal ?? true) && image.dataset.imageTerminal === 'true',
    });
  }
  // No marked layers means the card has no cover (or has rendered its final
  // error placeholder), so there is no pending image to wait for.
  return [...imagesByCard.values()].every(image => image.ready || image.terminal);
}

interface Props {
  cards: Card[];
  farMode: boolean;
  interacting: boolean;
  immediateIds: ReadonlySet<string>;
  viewport: Viewport;
}

// Keep the raster until the DOM is mounted and its visible covers can display.
// Selected/moving objects always bypass the queue, including during gestures.
export function useCanvasDomHandoff({ cards, farMode, interacting, immediateIds, viewport }: Props) {
  const previousFarRef = useRef(farMode);
  const [active, setActive] = useState(false);
  const [mountedIds, setMountedIds] = useState<ReadonlySet<string>>(() => new Set());
  const [readyImageSet, setReadyImageSet] = useState<ReadonlySet<string> | null>(null);
  const entering = !farMode && previousFarRef.current;
  const handingOff = !farMode && (active || entering);
  const availableIds = entering ? immediateIds : mountedIds;
  const domCards = useMemo(() => {
    if (!farMode && !handingOff) return cards;
    return cards.filter(card => immediateIds.has(card.id) || (!farMode && availableIds.has(card.id)));
  }, [cards, farMode, handingOff, immediateIds, availableIds]);
  const domCardIds = useMemo(() => new Set(domCards.map(card => card.id)), [domCards]);
  const visibleImageIds = useMemo(() => {
    if (typeof window === 'undefined') return new Set<string>();
    return new Set(cards.filter(card => card.image && farCardOnScreen(card, viewport, window.innerWidth, window.innerHeight))
      .map(card => card.id));
  }, [cards, viewport]);
  const allDomMounted = !farMode && handingOff && domCards.length >= cards.length;
  const imagesReady = !visibleImageIds.size || (!entering && readyImageSet === visibleImageIds);
  const handoffActive = handingOff && (!allDomMounted || !imagesReady);
  const needsMounts = handingOff && !allDomMounted;
  const orderedCards = useMemo(() => {
    if (!needsMounts) return cards;
    const centerX = (window.innerWidth / 2 - viewport.x) / viewport.zoom;
    const centerY = (window.innerHeight / 2 - viewport.y) / viewport.zoom;
    const distance = (card: Card) => (card.x + card.width / 2 - centerX) ** 2 +
      (card.y + card.height / 2 - centerY) ** 2;
    return [...cards].sort((left, right) => distance(left) - distance(right));
  }, [cards, needsMounts, viewport]);
  const latest = useRef({ farMode, interacting, needsMounts, orderedCards, immediateIds, visibleImageIds });
  latest.current = { farMode, interacting, needsMounts, orderedCards, immediateIds, visibleImageIds };

  useLayoutEffect(() => {
    if (previousFarRef.current !== farMode) {
      previousFarRef.current = farMode;
      setMountedIds(immediateIds);
      setActive(!farMode);
      setReadyImageSet(null);
    } else if (!farMode && active) {
      setMountedIds(previous => {
        const next = new Set(cards.filter(card => previous.has(card.id) || immediateIds.has(card.id)).map(card => card.id));
        return next.size === previous.size && [...next].every(id => previous.has(id)) ? previous : next;
      });
    }
  }, [farMode, immediateIds, cards, active]);

  useEffect(() => {
    if (farMode || !handingOff || !allDomMounted || interacting || imagesReady) return;
    let cancelled = false;
    let timer: number | null = null;
    const checkImages = () => {
      timer = null;
      const current = latest.current;
      if (cancelled || current.farMode || current.interacting || current.needsMounts ||
        current.visibleImageIds !== visibleImageIds) return;
      if (visibleImagesReady(visibleImageIds)) setReadyImageSet(visibleImageIds);
      else timer = window.setTimeout(checkImages, DOM_IMAGE_READY_CHECK_MS);
    };
    timer = window.setTimeout(checkImages, DOM_IMAGE_READY_CHECK_MS);
    return () => {
      cancelled = true;
      if (timer !== null) window.clearTimeout(timer);
    };
  }, [farMode, handingOff, allDomMounted, interacting, imagesReady, visibleImageIds]);

  useEffect(() => {
    if (!farMode && active && !handoffActive) setActive(false);
    if (!needsMounts || interacting) return;
    let cancelled = false;
    const frame = window.requestAnimationFrame(() => {
      const current = latest.current;
      if (cancelled || current.farMode || current.interacting || !current.needsMounts) return;
      setMountedIds(previous => {
        // Drop IDs that left the candidate set; a rapid turn or zoom never
        // mounts a stale queued batch from the previous viewport.
        const next = new Set<string>();
        let added = 0;
        for (const card of current.orderedCards) {
          if (previous.has(card.id) || current.immediateIds.has(card.id)) next.add(card.id);
          else if (added < DOM_HANDOFF_BATCH_SIZE) { next.add(card.id); added++; }
        }
        return next.size === previous.size && [...next].every(id => previous.has(id)) ? previous : next;
      });
    });
    return () => { cancelled = true; window.cancelAnimationFrame(frame); };
  }, [farMode, active, handoffActive, needsMounts, interacting, orderedCards, immediateIds, mountedIds]);

  return { domCards, domCardIds, handoffActive };
}
