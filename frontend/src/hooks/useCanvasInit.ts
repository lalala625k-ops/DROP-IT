import { useEffect, useState, MutableRefObject } from 'react';
import { Card, Group, Viewport } from '../types';
import { loadInitialData, flushStoredCards, saveStateDebounced } from '../utils/storage';
import { normalizeTreeData } from '../utils/groupRelations';
import { getSavedViewport } from './useViewport';
import { computeFitViewport } from '../utils/canvas';
import { bundleDisplayBounds } from '../utils/bundleGeometry';
import type { CanvasPin } from './useCanvasPins';
import { buildOriginGeometries, originEnvelope } from '../utils/originGeometry';
import { migrateRemoteImageCards } from '../utils/remoteImage';

interface UseCanvasInitProps {
  setCards: React.Dispatch<React.SetStateAction<Card[]>>;
  setGroups: React.Dispatch<React.SetStateAction<Group[]>>;
  setViewport: (vp: Viewport) => void;
  maxZIndexRef: MutableRefObject<number>;
  replacePins: (pins: CanvasPin[]) => void;
}

export function useCanvasInit({
  setCards,
  setGroups,
  setViewport,
  maxZIndexRef,
  replacePins,
}: UseCanvasInitProps) {
  const [ready, setReady] = useState(false);
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let cancelled = false;
    setError('');
    loadInitialData().then(({ cards: initCards, groups: initGroups, viewport: loadedViewport, pins: loadedPins }) => {
      if (cancelled) return;
      const tree = normalizeTreeData(initCards, initGroups);
      initCards = tree.cards;
      initGroups = tree.groups;
      const bundleScales = new Map(initGroups.filter((group) => group.kind === 'bundle')
        .map((group) => [group.id, (group.outlinePadding ?? 18) / 18]));
      let repairedScales = false;
      initCards = initCards.map((card) => {
        const expected = card.bundleId ? bundleScales.get(card.bundleId) : undefined;
        if (expected === undefined || Math.abs((card.contentScale ?? 1) - expected) < 0.001) return card;
        repairedScales = true;
        return { ...card, contentScale: expected };
      });
      const standardSize = 120;
      const normalizedGroups = initGroups.map((g) => {
        if (g.kind === 'bundle') return g;
        if (!g.width || g.width !== standardSize || !g.height || g.height !== standardSize) {
          const oldW = g.width || standardSize;
          const oldH = g.height || standardSize;
          return {
            ...g,
            x: Math.round(g.x + oldW / 2 - standardSize / 2),
            y: Math.round(g.y + oldH / 2 - standardSize / 2),
            width: standardSize,
            height: standardSize,
          };
        }
        return g;
      });
      setCards(initCards);
      setGroups(normalizedGroups);
      const origins = buildOriginGeometries(initCards, normalizedGroups);
      if (tree.changed || repairedScales) saveStateDebounced(initCards, normalizedGroups);

      const restoredViewport = loadedViewport && typeof loadedViewport.x === 'number' &&
        typeof loadedViewport.y === 'number' && typeof loadedViewport.zoom === 'number' &&
        loadedViewport.zoom >= 0.01 && loadedViewport.zoom <= 3 ? loadedViewport : null;
      if (restoredViewport) setViewport(restoredViewport);
      replacePins(loadedPins || []);
      const savedVp = restoredViewport || getSavedViewport();
      if (!restoredViewport && new URLSearchParams(location.search).get('new-board') !== '1' && !localStorage.getItem('pinboard_migrated_viewport_applied')) {
        void fetch('/api/migration/viewport').then((response) => response.json()).then((vp) => {
          if (typeof vp.x === 'number' && typeof vp.y === 'number' && typeof vp.zoom === 'number') {
            setViewport(vp);
            localStorage.setItem('pinboard_migrated_viewport_applied', '1');
          }
        }).catch(() => {});
      }
      // A cached viewport can outlive a workspace (for example after opening a
      // different .drop file).  Restoring it blindly leaves the canvas looking
      // empty while the cards are far outside the current screen.  Keep the
      // user's viewport when it still intersects the loaded content, otherwise
      // fall back to a fit view so the first frame is usable.
      const folded = new Set(normalizedGroups.filter((g) => g.kind === 'bundle' && g.collapsed).map((g) => g.id));
      const savedViewportShowsContent = savedVp && (() => {
        const zoom = Math.max(savedVp.zoom, 0.01);
        const screenRect = {
          x: -savedVp.x / zoom,
          y: -savedVp.y / zoom,
          width: window.innerWidth / zoom,
          height: window.innerHeight / zoom,
        };
        const intersects = (rect: { x: number; y: number; width: number; height: number }) =>
          rect.x + rect.width >= screenRect.x && rect.x <= screenRect.x + screenRect.width &&
          rect.y + rect.height >= screenRect.y && rect.y <= screenRect.y + screenRect.height;
        return initCards.some((card) => (!card.bundleId || !folded.has(card.bundleId))
          && intersects({ x: card.x, y: card.y, width: card.width, height: card.height }))
          || normalizedGroups.some((group) => intersects(group.kind !== 'bundle' ? originEnvelope(group, origins.get(group.id))
            : bundleDisplayBounds(initCards.filter(card => card.bundleId === group.id), group)));
      })();

      if (!restoredViewport && !savedViewportShowsContent) {
        const fitCards = initCards.filter((card) => !card.bundleId || !folded.has(card.bundleId));
        const fitGroups = normalizedGroups.map((group) => group.kind === 'bundle' && group.collapsed
          ? { ...group, ...bundleDisplayBounds(initCards.filter(card => card.bundleId === group.id), group) }
          : group);
        const fit = computeFitViewport(fitCards, fitGroups, window.innerWidth, window.innerHeight, 80, origins);
        if (fit) setViewport(fit);
      }

      let maxZ = 10;
      initCards.forEach((c) => {
        if (c.zIndex && c.zIndex > maxZ) maxZ = c.zIndex;
      });
      maxZIndexRef.current = maxZ + 1;
      setReady(true);
      // Migrate readable legacy CDN covers after the first frame. A failed
      // download leaves the original URL intact so the user can retry later.
      const loadedImages = new Map(initCards.map((card) => [card.id, card.image]));
      void migrateRemoteImageCards(initCards).then((updates) => {
        if (cancelled || !updates.size) return;
        setCards((current) => {
          let changed = false;
          const next = current.map((card) => {
            const original = loadedImages.get(card.id);
            const update = updates.get(card.id);
            if (!update || card.image !== original) return card;
            changed = true;
            return { ...card, image: update.image, thumbnail: update.thumbnail };
          });
          if (changed) saveStateDebounced(next, normalizedGroups);
          return changed ? next : current;
        });
      });
    }).catch(failure => { if (!cancelled) setError(failure instanceof Error ? failure.message : '恢复失败'); });

    const handleBeforeUnload = () => flushStoredCards();
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => { cancelled = true; window.removeEventListener('beforeunload', handleBeforeUnload); };
  }, [maxZIndexRef, replacePins, setCards, setGroups, setViewport, attempt]);
  return { ready, error, retry: () => setAttempt(value => value + 1) };
}
