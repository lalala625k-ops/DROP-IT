import { branchStroke } from '../utils/branchColors';
import { useLayoutEffect, useRef } from 'react';
import { Card, Group, Viewport } from '../types';
import type { OriginGeometries } from '../utils/originGeometry';
import { originFrame } from '../utils/originFrame';
import { ORIGIN_STROKE_WIDTH } from '../utils/originStroke';
import { bundleDisplayOutlinePoints } from '../utils/bundleGeometry';
import { bundleTitleLayout } from '../utils/bundleStack';
import { IMAGE_FOOTER_BACKGROUND } from '../utils/cardLayout';
import { FarImageCache, farImageKey, type FarImageRequest } from '../utils/farImageCache';
import { drawFarCard, farCardOnScreen, farImageRequest } from '../utils/farCardDrawing';
import { SubscribeViewportPreview, viewportSnapshotTransform } from '../utils/viewportPreview';

const FAR_CACHE_BUFFER_PX = 300;

interface Props {
  cards: Card[];
  branchColors: ReadonlyMap<string, string>;
  groups: Group[];
  membersByBundle: Map<string, Card[]>;
  viewport: Viewport;
  origins: OriginGeometries;
  interacting?: boolean;
  active?: boolean;
  handoffActive?: boolean;
  domCardIds: ReadonlySet<string>;
  movingCardIds: ReadonlySet<string>;
  domGroupIds: ReadonlySet<string>;
  subscribeViewportPreview: SubscribeViewportPreview;
}

export function FarCanvas({ cards, groups, branchColors, membersByBundle, viewport, origins, interacting = false, active = true, handoffActive = false, domCardIds, movingCardIds, domGroupIds, subscribeViewportPreview }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const drawnViewportRef = useRef<Viewport | null>(null);
  const cacheRef = useRef<FarImageCache | null>(null);
  const redrawRef = useRef<() => void>(() => {});
  const interactingRef = useRef(interacting);
  const previousDomIdsRef = useRef(domCardIds);
  const previousMovingIdsRef = useRef(movingCardIds);
  const previousDomGroupIdsRef = useRef(domGroupIds);

  useLayoutEffect(() => subscribeViewportPreview((next) => {
    const canvas = canvasRef.current;
    const base = drawnViewportRef.current;
    if (canvas && base && !canvas.hidden) {
      canvas.style.transform = viewportSnapshotTransform(base, next);
    }
  }), [subscribeViewportPreview]);

  useLayoutEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const schedule = () => {
      if (timer !== undefined || interactingRef.current) return;
      timer = setTimeout(() => { timer = undefined; redrawRef.current(); }, 50);
    };
    const cache = new FarImageCache(schedule);
    cacheRef.current = cache;
    window.addEventListener('resize', schedule);
    return () => {
      clearTimeout(timer);
      window.removeEventListener('resize', schedule);
      cache.dispose();
      cacheRef.current = null;
    };
  }, []);

  // The far canvas is already a rasterized screen-space snapshot. During a
  // gesture, move and scale that snapshot instead of rebuilding every Path2D
  // and placeholder for each pointer frame. The final viewport is redrawn
  // once the gesture settles.
  useLayoutEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    interactingRef.current = interacting || !active;
    cacheRef.current?.setPaused(interacting || !active);
    if (!active) {
      // Retain the small image tiles, not a full-screen high-DPI backing store.
      canvas.width = canvas.height = 0;
      drawnViewportRef.current = null;
      return;
    }
    canvas.style.transformOrigin = '0 0';
    if (!interacting) {
      canvas.style.transform = '';
      return;
    }
    const base = drawnViewportRef.current || viewport;
    canvas.style.transform = viewportSnapshotTransform(base, viewport);
  }, [active, interacting, viewport.x, viewport.y, viewport.zoom]);

  useLayoutEffect(() => {
    // Removing a newly selected/moving card from the snapshot happens once at
    // gesture start, so its DOM copy cannot leave a ghost at the old location.
    const domChanged = previousDomIdsRef.current !== domCardIds || previousMovingIdsRef.current !== movingCardIds ||
      previousDomGroupIdsRef.current !== domGroupIds;
    previousDomIdsRef.current = domCardIds;
    previousMovingIdsRef.current = movingCardIds;
    previousDomGroupIdsRef.current = domGroupIds;
    let paintCards: Card[] | undefined;
    let preparedWidth = 0;
    let preparedHeight = 0;
    const draw = (force = false) => {
      const canvas = canvasRef.current;
      const cache = cacheRef.current;
      if (!active || !canvas || !cache || (interactingRef.current && !force)) return;
      const ratio = Math.min(window.devicePixelRatio || 1, 2);
      if (!paintCards || preparedWidth !== window.innerWidth || preparedHeight !== window.innerHeight) {
        preparedWidth = window.innerWidth;
        preparedHeight = window.innerHeight;
        const onScreen = cards.filter(card => farCardOnScreen(card, viewport, preparedWidth, preparedHeight));
        const onScreenIds = new Set(onScreen.map(card => card.id));
        const cacheCards = cards.filter(card => farCardOnScreen(card, viewport, preparedWidth, preparedHeight, FAR_CACHE_BUFFER_PX));
        paintCards = onScreen.filter(card => !movingCardIds.has(card.id) && (handoffActive || !domCardIds.has(card.id)))
          .sort((a, b) => a.zIndex - b.zIndex);
        // Retain the existing small tiles through the handoff. Reversing the
        // zoom before its DOM batches finish must not have to decode them again.
        // Visible images take the two decoder slots before the off-screen shell.
        // Source de-duplication keeps that priority and the largest tile request.
        const requests = new Map<string, FarImageRequest>();
        for (const card of [...onScreen, ...cacheCards.filter(card => !onScreenIds.has(card.id))]) {
          const request = farImageRequest(card, viewport.zoom, ratio);
          if (!request) continue;
          const key = farImageKey(request);
          const previous = requests.get(key);
          if (!previous || previous.edge < request.edge) requests.set(key, request);
        }
        cache.update([...requests.values()]);
      }
      const pixelWidth = Math.round(window.innerWidth * ratio);
      const pixelHeight = Math.round(window.innerHeight * ratio);
      if (canvas.width !== pixelWidth) canvas.width = pixelWidth;
      if (canvas.height !== pixelHeight) canvas.height = pixelHeight;
      if (canvas.style.width !== `${window.innerWidth}px`) canvas.style.width = `${window.innerWidth}px`;
      if (canvas.style.height !== `${window.innerHeight}px`) canvas.style.height = `${window.innerHeight}px`;
      const context = canvas.getContext('2d');
      if (!context) return;
      drawnViewportRef.current = viewport;
      canvas.style.transform = '';
      context.setTransform(ratio, 0, 0, ratio, 0, 0);
      context.clearRect(0, 0, window.innerWidth, window.innerHeight);
      const rect = (x: number, y: number, width: number, height: number) => {
        const px = viewport.x + x * viewport.zoom;
        const py = viewport.y + y * viewport.zoom;
        return { px, py, width: width * viewport.zoom, height: height * viewport.zoom };
      };
      for (const group of groups) {
        if (domGroupIds.has(group.id)) continue;
        if (group.kind !== 'bundle') {
          const geometry = origins.get(group.id)!;
          const frame = originFrame(geometry, Math.max(ORIGIN_STROKE_WIDTH, 0.8 / viewport.zoom));
          const outline = new Path2D(frame.path);
          context.save();
          context.translate(viewport.x, viewport.y);
          context.scale(viewport.zoom, viewport.zoom);
          context.fillStyle = branchColors.get(group.id) || '#1d1d1d';
          context.strokeStyle = context.fillStyle;
          context.lineWidth = 1 / viewport.zoom;
          context.lineJoin = 'miter';
          if (frame.hasInterior) context.fill(outline, 'evenodd'); else context.stroke(outline);
          context.restore();
          continue;
        }
        const members = membersByBundle.get(group.id) || [];
        const points = bundleDisplayOutlinePoints(members, group);
        const outline = new Path2D();
        points.forEach((point, index) => {
          const x = viewport.x + (group.x + point.x) * viewport.zoom;
          const y = viewport.y + (group.y + point.y) * viewport.zoom;
          if (index === 0) outline.moveTo(x, y); else outline.lineTo(x, y);
        });
        outline.closePath();
        context.fillStyle = '#e1dfd8';
        context.globalAlpha = 0.18;
        context.fill(outline);
        context.globalAlpha = 1;
        context.strokeStyle = branchStroke(branchColors.get(group.id));
        context.globalAlpha = 0.8;
        context.setLineDash([7 * viewport.zoom, 5 * viewport.zoom]);
        context.lineWidth = 1;
        context.stroke(outline);
        context.globalAlpha = 1;
        context.setLineDash([]);
        if (group.collapsed) {
          const layout = bundleTitleLayout(members, group);
          for (const page of layout.pages.slice().reverse()) {
            const box = rect(page.x, page.y, page.width, page.height);
            context.fillStyle = page.card.type === 'image' ? IMAGE_FOOTER_BACKGROUND : '#fffefa';
            context.fillRect(box.px, box.py, box.width, box.height);
            context.strokeStyle = branchColors.get(page.card.id) || '#373633';
            context.strokeRect(box.px, box.py, box.width, box.height);
            context.beginPath();
            context.moveTo(box.px, box.py);
            context.lineTo(box.px + box.width, box.py);
            context.stroke();
          }
        }
      }
      for (const card of paintCards) drawFarCard(context, card, viewport, cache, ratio, branchColors.get(card.id));
    };
    redrawRef.current = draw;
    draw(domChanged);
  }, [cards, groups, branchColors, membersByBundle, viewport, origins, interacting, active, handoffActive, domCardIds, movingCardIds, domGroupIds]);
  return <canvas ref={canvasRef} hidden={!active} aria-hidden="true"
    className={`${active ? 'far-canvas ' : ''}absolute inset-0 pointer-events-none`} />;
}
