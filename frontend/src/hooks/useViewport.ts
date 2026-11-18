import { useState, useRef, useEffect, useLayoutEffect, useCallback, useMemo } from 'react';
import type { SetStateAction } from 'react';
import { workspaceWritesSuspended } from '../utils/workspaceApi';
import { Viewport, Card, Group } from '../types';
import { buildOriginGeometries, OriginGeometries } from '../utils/originGeometry';
import { clamp, computeFitViewport, computeCardFocusViewport, MIN_CANVAS_ZOOM } from '../utils/canvas';
import { createViewportPreview } from '../utils/viewportPreview';

const boardId = new URLSearchParams(location.search).get('board-id');
const VIEWPORT_STORAGE_KEY = `pinboard_viewport_v1${boardId ? `_${boardId}` : ''}`;

export function getSavedViewport(): Viewport | null {
  try {
    const raw = localStorage.getItem(VIEWPORT_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (
      typeof parsed.x === 'number' &&
      typeof parsed.y === 'number' &&
      typeof parsed.zoom === 'number' &&
      parsed.zoom >= MIN_CANVAS_ZOOM &&
      parsed.zoom <= 3.0
    ) {
      return parsed;
    }
  } catch {
    // ignore
  }
  return null;
}

export function saveViewportToStorage(vp: Viewport) {
  if (workspaceWritesSuspended()) return;
  try {
    localStorage.setItem(VIEWPORT_STORAGE_KEY, JSON.stringify(vp));
  } catch {
    // ignore
  }
}

export function useViewport(options?: { invertWheelZoom?: boolean }) {
  const [viewport, setViewportState] = useState<Viewport>(() => getSavedViewport() || { x: 0, y: 0, zoom: 1.0 });
  const viewportRef = useRef<Viewport>(viewport);
  const surfaceRef = useRef<HTMLDivElement>(null);
  const culledViewportRef = useRef<Viewport>(viewport);
  const wheelRafRef = useRef<number | null>(null);
  const wheelIdleRef = useRef<number | null>(null);
  const pendingWheelRef = useRef<{ factor: number; clientX: number; clientY: number } | null>(null);
  const wheelActiveRef = useRef(false);
  const wheelLodZoomRef = useRef(viewport.zoom);
  const [isWheelZooming, setIsWheelZooming] = useState(false);
  const previewChannel = useMemo(createViewportPreview, []);

  const applySurfaceTransform = useCallback((next: Viewport) => {
    const surface = surfaceRef.current;
    if (surface) surface.style.transform = `translate(${next.x}px, ${next.y}px) scale(${next.zoom})`;
  }, []);

  const previewViewport = useCallback((next: Viewport) => {
    viewportRef.current = next;
    applySurfaceTransform(next);
    previewChannel.publish(next);
  }, [applySurfaceTransform, previewChannel]);

  const commitViewport = useCallback((next: Viewport) => {
    previewViewport(next);
    culledViewportRef.current = next;
    setViewportState(next);
  }, [previewViewport]);

  const setViewport = useCallback((update: SetStateAction<Viewport>) => {
    if (wheelRafRef.current !== null) window.cancelAnimationFrame(wheelRafRef.current);
    if (wheelIdleRef.current !== null) window.clearTimeout(wheelIdleRef.current);
    wheelRafRef.current = null;
    wheelIdleRef.current = null;
    pendingWheelRef.current = null;
    if (wheelActiveRef.current) {
      wheelActiveRef.current = false;
      setIsWheelZooming(false);
    }
    const next = typeof update === 'function' ? update(viewportRef.current) : update;
    commitViewport(next);
  }, [commitViewport]);

  // A React commit may land while the wheel gesture has already advanced another frame.
  useLayoutEffect(() => {
    applySurfaceTransform(viewportRef.current);
  }, [viewport, applySurfaceTransform]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      saveViewportToStorage(viewport);
    }, 200);
    return () => window.clearTimeout(timer);
  }, [viewport]);

  const previousViewportRef = useRef<Viewport | null>(null);
  const focusedCardIdRef = useRef<string | null>(null);

  const mouseScreenRef = useRef<{ x: number; y: number }>({
    x: typeof window !== 'undefined' ? window.innerWidth / 2 : 0,
    y: typeof window !== 'undefined' ? window.innerHeight / 2 : 0,
  });
  const mouseWorldRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 });

  const handleMouseMove = useCallback((e: MouseEvent) => {
    mouseScreenRef.current = { x: e.clientX, y: e.clientY };
    const vp = viewportRef.current;
    mouseWorldRef.current = {
      x: (e.clientX - vp.x) / vp.zoom,
      y: (e.clientY - vp.y) / vp.zoom,
    };
  }, []);

  useEffect(() => {
    window.addEventListener('mousemove', handleMouseMove, { passive: true });
    return () => window.removeEventListener('mousemove', handleMouseMove);
  }, [handleMouseMove]);

  const applyPendingWheel = useCallback(() => {
    wheelRafRef.current = null;
    const pending = pendingWheelRef.current;
    pendingWheelRef.current = null;
    if (!pending) return;
    const prev = viewportRef.current;
    const nextZoom = clamp(prev.zoom * pending.factor, MIN_CANVAS_ZOOM, 3.0);
    if (Math.abs(nextZoom - prev.zoom) < 0.0001) return;
    const next = {
      x: pending.clientX - (pending.clientX - prev.x) * (nextZoom / prev.zoom),
      y: pending.clientY - (pending.clientY - prev.y) * (nextZoom / prev.zoom),
      zoom: nextZoom,
    };
    previewViewport(next);
    mouseScreenRef.current = { x: pending.clientX, y: pending.clientY };
    mouseWorldRef.current = {
      x: (pending.clientX - next.x) / next.zoom,
      y: (pending.clientY - next.y) / next.zoom,
    };
  }, [previewViewport]);

  const flushWheelZoom = useCallback(() => {
    if (wheelRafRef.current !== null) window.cancelAnimationFrame(wheelRafRef.current);
    if (wheelIdleRef.current !== null) window.clearTimeout(wheelIdleRef.current);
    wheelRafRef.current = null;
    wheelIdleRef.current = null;
    applyPendingWheel();
    if (viewportRef.current !== culledViewportRef.current) commitViewport(viewportRef.current);
    if (wheelActiveRef.current) {
      wheelActiveRef.current = false;
      setIsWheelZooming(false);
    }
  }, [applyPendingWheel, commitViewport]);

  useEffect(() => {
    return () => {
      if (wheelRafRef.current !== null) {
        window.cancelAnimationFrame(wheelRafRef.current);
      }
      if (wheelIdleRef.current !== null) window.clearTimeout(wheelIdleRef.current);
    };
  }, []);

  // Wheel zoom centered at mouse pointer (throttled via requestAnimationFrame for silky smooth 60/120fps).
  const handleWheel = useCallback((e: React.WheelEvent) => {
    const target = e.target as HTMLElement;

    const isCanvasObject = !!target.closest('[data-card-id], [data-group-id], [data-bundle-id]');
    // Controls outside the canvas objects keep their own scroll behavior.
    if (!isCanvasObject && (
      target.tagName === 'TEXTAREA' ||
      target.tagName === 'INPUT' ||
      target.closest('textarea') ||
      target.closest('.overflow-y-auto') ||
      target.closest('.overflow-auto')
    )) {
      return;
    }

    e.preventDefault();
    if (!wheelActiveRef.current) {
      wheelActiveRef.current = true;
      wheelLodZoomRef.current = viewportRef.current.zoom;
      setIsWheelZooming(true);
    }
    const isZoomIn = options?.invertWheelZoom ? e.deltaY > 0 : e.deltaY < 0;
    const step = Math.min(Math.abs(e.deltaY) / 100, 1.5);
    const stepFactor = isZoomIn ? (1 + 0.12 * Math.max(0.6, step)) : (1 / (1 + 0.12 * Math.max(0.6, step)));
    const { clientX, clientY } = e;

    if (!pendingWheelRef.current) {
      pendingWheelRef.current = { factor: stepFactor, clientX, clientY };
    } else {
      pendingWheelRef.current.factor *= stepFactor;
      pendingWheelRef.current.clientX = clientX;
      pendingWheelRef.current.clientY = clientY;
    }

    if (wheelRafRef.current === null) wheelRafRef.current = window.requestAnimationFrame(applyPendingWheel);
    if (wheelIdleRef.current !== null) window.clearTimeout(wheelIdleRef.current);
    wheelIdleRef.current = window.setTimeout(() => {
      wheelIdleRef.current = null;
      flushWheelZoom();
    }, 200);
  }, [options?.invertWheelZoom, applyPendingWheel, flushWheelZoom]);

  // Double click card: smooth 80% focus toggle
  const handleCardDoubleClick = useCallback((card: Card) => {
    if (focusedCardIdRef.current === card.id && previousViewportRef.current) {
      setViewport(previousViewportRef.current);
      previousViewportRef.current = null;
      focusedCardIdRef.current = null;
    } else {
      previousViewportRef.current = viewportRef.current;
      focusedCardIdRef.current = card.id;
      setViewport(computeCardFocusViewport(card, window.innerWidth, window.innerHeight));
    }
  }, [setViewport]);

  // Double click blank canvas: fit all cards & groups
  const handleCanvasDoubleClick = useCallback((cards: Card[], groups: Group[], origins?: OriginGeometries) => {
    const fitted = computeFitViewport(cards, groups, window.innerWidth, window.innerHeight, 80,
      origins || buildOriginGeometries(cards, groups));
    if (fitted) {
      setViewport(fitted);
      previousViewportRef.current = null;
      focusedCardIdRef.current = null;
    }
  }, [setViewport]);

  return {
    viewport,
    setViewport,
    previewViewport,
    subscribeViewportPreview: previewChannel.subscribe,
    viewportRef,
    surfaceRef,
    mouseScreenRef,
    mouseWorldRef,
    handleWheel,
    flushWheelZoom,
    isWheelZooming,
    wheelLodZoom: wheelLodZoomRef.current,
    handleCardDoubleClick,
    handleCanvasDoubleClick,
  };
}
