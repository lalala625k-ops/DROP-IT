import React, { useRef, useState, useEffect, useMemo } from 'react';
import { Card, Group, Viewport } from '../types';
import { bundleDisplayBounds, bundleDisplayOutlinePoints, bundleOutlinePoints } from '../utils/bundleGeometry';
import { cardVisualBounds } from '../utils/cardBounds';
import { clamp, MIN_CANVAS_ZOOM } from '../utils/canvas';
import { linkEndpoints } from '../utils/linkEndpoints';
import { buildOriginGeometries } from '../utils/originGeometry';
import { originFrame } from '../utils/originFrame';
import { ORIGIN_STROKE_WIDTH } from '../utils/originStroke';
import { resolveBranchColors, branchStroke } from '../utils/branchColors';
import { getBundleParentIds } from '../utils/groupRelations';
import { minimapWorldBounds } from '../utils/minimapBounds';
import type { SubscribeViewportPreview } from '../utils/viewportPreview';

interface MinimapNavProps {
  expanded: boolean;
  cards: Card[];
  groups: Group[];
  viewport: Viewport;
  onNavigate: (viewport: Viewport) => void;
  isCanvasInteracting?: boolean;
  subscribeViewportPreview?: SubscribeViewportPreview;
}

const PADDING = 12;
const UNCOLORED = '#1d1d1d';

export const MinimapNav: React.FC<MinimapNavProps> = ({
  expanded,
  cards,
  groups,
  viewport,
  onNavigate,
  isCanvasInteracting = false,
  subscribeViewportPreview,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const viewportIndicatorRef = useRef<HTMLDivElement>(null);
  const layoutViewportRef = useRef(viewport);
  const mapCardsRef = useRef(cards);
  const mapGroupsRef = useRef(groups);
  // Keep the expensive map projection stable while the main canvas is moving.
  // The viewport rectangle below still follows the live viewport.
  if (!isCanvasInteracting) {
    layoutViewportRef.current = viewport;
    mapCardsRef.current = cards;
    mapGroupsRef.current = groups;
  }
  const layoutViewport = layoutViewportRef.current;
  const mapCards = mapCardsRef.current;
  const mapGroups = mapGroupsRef.current;
  const origins = useMemo(() => buildOriginGeometries(mapCards, mapGroups), [mapCards, mapGroups]);
  const membersByBundle = useMemo(() => {
    const result = new Map<string, Card[]>();
    for (const card of mapCards) if (card.bundleId) {
      const members = result.get(card.bundleId) || [];
      members.push(card);
      result.set(card.bundleId, members);
    }
    return result;
  }, [mapCards]);
  const mapLinks = useMemo(() => {
    const lookup = { cardById: new Map(mapCards.map(card => [card.id, card])),
      groupById: new Map(mapGroups.map(group => [group.id, group])), membersByBundle };
    const bundleIds = new Set(mapGroups.filter((group) => group.kind === 'bundle').map((group) => group.id));
    return [...mapCards.filter((card) => !card.bundleId || !bundleIds.has(card.bundleId)),
      ...mapGroups.filter((group) => group.kind === 'bundle')].flatMap((node) => {
      const parentId = bundleIds.has(node.id) ? getBundleParentIds(mapCards, node as Group)[0] : (node as Card).groupId;
      if (!parentId) return [];
      const endpoints = linkEndpoints(parentId, node.id, mapCards, mapGroups, origins, lookup);
      return endpoints ? [{ key: `${node.id}-${parentId}`, parentId, ...endpoints }] : [];
    });
  }, [mapCards, mapGroups, origins, membersByBundle]);
  const dragStartRef = useRef<{ x: number; y: number } | null>(null);
  const [dragRect, setDragRect] = useState<{ x: number; y: number; width: number; height: number } | null>(null);
  const [windowSize, setWindowSize] = useState(() => ({ width: window.innerWidth, height: window.innerHeight }));
  const bundleIds = useMemo(() => new Set(mapGroups.filter((group) => group.kind === 'bundle')
    .map((group) => group.id)), [mapGroups]);
  const inheritedColors = useMemo(() => resolveBranchColors(mapCards, mapGroups), [mapCards, mapGroups]);

  useEffect(() => {
    const updateSize = () => setWindowSize({ width: window.innerWidth, height: window.innerHeight });
    window.addEventListener('resize', updateSize);
    return () => window.removeEventListener('resize', updateSize);
  }, []);

  const contentBounds = useMemo(() => {
    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;
    for (const card of mapCards) {
      if (card.bundleId && bundleIds.has(card.bundleId)) continue;
      const bounds = cardVisualBounds(card);
      minX = Math.min(minX, bounds.x);
      maxX = Math.max(maxX, bounds.x + bounds.width);
      minY = Math.min(minY, bounds.y);
      maxY = Math.max(maxY, bounds.y + bounds.height);
    }
    for (const group of mapGroups) {
      if (group.kind !== 'bundle') {
        const bounds = origins.get(group.id)!.bounds;
        minX = Math.min(minX, bounds.x);
        maxX = Math.max(maxX, bounds.x + bounds.width);
        minY = Math.min(minY, bounds.y);
        maxY = Math.max(maxY, bounds.y + bounds.height);
        continue;
      }
      const bounds = group.collapsed
        ? bundleDisplayBounds(membersByBundle.get(group.id) || [], group)
        : group;
      minX = Math.min(minX, bounds.x);
      maxX = Math.max(maxX, bounds.x + bounds.width);
      minY = Math.min(minY, bounds.y);
      maxY = Math.max(maxY, bounds.y + bounds.height);
    }
    return { minX, maxX, minY, maxY };
  }, [mapCards, mapGroups, bundleIds, membersByBundle, origins]);

  const mapLayout = useMemo(() => {
    const { minX: bMinX, minY: bMinY, width: worldW, height: worldH } =
      minimapWorldBounds(contentBounds, layoutViewport, windowSize, expanded ? 100 : 30);

    const contentAspect = worldW / worldH;

    // Full screen reference dimensions
    const screenW = typeof window !== 'undefined'
      ? (window.screen?.availWidth || window.screen?.width || 1920)
      : 1920;
    const screenH = typeof window !== 'undefined'
      ? (window.screen?.availHeight || window.screen?.height || 1080)
      : 1080;
    const fullW = Math.max(screenW, windowSize.width);
    const fullH = Math.max(screenH, windowSize.height);

    // If either width or height decreases (e.g. windowed mode), the minimap scales down proportionally
    const scaleRatio = Math.min(windowSize.width / fullW, windowSize.height / fullH);
    const windowScale = Math.min(1, Math.max(0.35, scaleRatio));

    // Base max dimensions in full window
    const BASE_MAX_W = 280;
    const BASE_MAX_H = 190;
    const maxBoxW = Math.min(BASE_MAX_W * windowScale, windowSize.width - 32);
    const maxBoxH = Math.min(BASE_MAX_H * windowScale, windowSize.height - 32);

    // Adapt compact minimap box to content aspect ratio
    const availW = Math.max(30, maxBoxW - PADDING * 2);
    const availH = Math.max(30, maxBoxH - PADDING * 2);
    const envelopeAspect = availW / availH;
    let compactInnerW: number;
    let compactInnerH: number;
    if (contentAspect >= envelopeAspect) {
      compactInnerW = availW;
      compactInnerH = Math.max(24, Math.round(compactInnerW / contentAspect));
    } else {
      compactInnerH = availH;
      compactInnerW = Math.max(24, Math.round(compactInnerH * contentAspect));
    }

    // Adapt expanded HUD box to content aspect ratio
    const maxExpW = Math.min(windowSize.width * 0.75, windowSize.width - 64);
    const maxExpH = Math.min(windowSize.height * 0.75, windowSize.height - 64);
    const expAvailW = maxExpW - PADDING * 2;
    const expAvailH = maxExpH - PADDING * 2;
    const expEnvelopeAspect = expAvailW / expAvailH;
    let expInnerW: number;
    let expInnerH: number;
    if (contentAspect >= expEnvelopeAspect) {
      expInnerW = expAvailW;
      expInnerH = Math.max(40, Math.round(expInnerW / contentAspect));
    } else {
      expInnerH = expAvailH;
      expInnerW = Math.max(40, Math.round(expInnerH * contentAspect));
    }

    const innerW = expanded ? expInnerW : compactInnerW;
    const innerH = expanded ? expInnerH : compactInnerH;
    const mapWidth = Math.round(innerW + PADDING * 2);
    const mapHeight = Math.round(innerH + PADDING * 2);

    const fitScale = Math.min(innerW / worldW, innerH / worldH);
    const renderedW = worldW * fitScale;
    const renderedH = worldH * fitScale;

    const offX = PADDING + (innerW - renderedW) / 2;
    const offY = PADDING + (innerH - renderedH) / 2;

    return {
      minX: bMinX,
      minY: bMinY,
      scale: fitScale,
      offsetX: offX,
      offsetY: offY,
      mapWidth,
      mapHeight,
    };
  }, [contentBounds, expanded, layoutViewport, windowSize]);

  const { minX, minY, scale, offsetX, offsetY, mapWidth, mapHeight } = mapLayout;
  const vpRect = useMemo(() => {
    const vpLeft = -viewport.x / viewport.zoom;
    const vpTop = -viewport.y / viewport.zoom;
    const vpRight = (windowSize.width - viewport.x) / viewport.zoom;
    const vpBottom = (windowSize.height - viewport.y) / viewport.zoom;
    return {
      x: offsetX + (vpLeft - minX) * scale,
      y: offsetY + (vpTop - minY) * scale,
      w: (vpRight - vpLeft) * scale,
      h: (vpBottom - vpTop) * scale,
    };
  }, [minX, minY, offsetX, offsetY, scale, viewport, windowSize]);

  useEffect(() => subscribeViewportPreview?.((next) => {
    const element = viewportIndicatorRef.current;
    if (!element) return;
    element.style.left = `${offsetX + (-next.x / next.zoom - minX) * scale}px`;
    element.style.top = `${offsetY + (-next.y / next.zoom - minY) * scale}px`;
    element.style.width = `${windowSize.width / next.zoom * scale}px`;
    element.style.height = `${windowSize.height / next.zoom * scale}px`;
  }), [subscribeViewportPreview, minX, minY, offsetX, offsetY, scale, windowSize]);

  const staticLayer = useMemo(() => (
    <>
      {/* SVG Layer for Network Links */}
      <svg className="absolute inset-0 w-full h-full pointer-events-none">
        {mapLinks.map(({ key, parentId, start: parent, end: child }) => (
          <line key={key}
            x1={offsetX + (parent.x - minX) * scale} y1={offsetY + (parent.y - minY) * scale}
            x2={offsetX + (child.x - minX) * scale} y2={offsetY + (child.y - minY) * scale}
            stroke={branchStroke(inheritedColors.get(parentId))} strokeOpacity="0.8" strokeWidth="1" strokeDasharray="2 2" />
        ))}
      </svg>

      {/* A Group uses its linked parent's color and hides its member cards. */}
      <svg className="absolute inset-0 w-full h-full pointer-events-none">
        {mapGroups.filter((group) => group.kind === 'bundle').map((group) => {
          const color = inheritedColors.get(group.id) || UNCOLORED;
          const members = membersByBundle.get(group.id) || [];
          const points = group.collapsed
            ? bundleDisplayOutlinePoints(members, group)
            : bundleOutlinePoints(members, group);
          const path = points.map((point, index) => `${index ? 'L' : 'M'} ${offsetX + (group.x + point.x - minX) * scale} ${offsetY + (group.y + point.y - minY) * scale}`).join(' ') + ' Z';
          return <path key={group.id} d={path} fill={color} stroke={color} strokeWidth="2" />;
        })}
      </svg>

      {/* Cards: Squares & Rectangles */}
      {mapCards.map((c) => {
        if (c.bundleId && bundleIds.has(c.bundleId)) return null;
        const color = inheritedColors.get(c.id) || UNCOLORED;
        const cx = offsetX + (c.x - minX) * scale;
        const cy = offsetY + (c.y - minY) * scale;
        const cw = Math.max(4, c.width * scale);
        const ch = Math.max(3, c.height * scale);
        return (
          <div
            key={c.id}
            className="absolute pointer-events-none transition-transform"
            style={{ left: `${cx}px`, top: `${cy}px`, width: `${cw}px`, height: `${ch}px`, backgroundColor: color }}
          />
        );
      })}

      {/* Origins share the main canvas's branch-weighted silhouette. */}
      <svg className="absolute inset-0 w-full h-full pointer-events-none">
        {mapGroups.filter((group) => group.kind !== 'bundle').map((group) => {
          const geometry = origins.get(group.id)!;
          const cx = offsetX + (geometry.center.x - minX) * scale;
          const cy = offsetY + (geometry.center.y - minY) * scale;
          const shapeScale = Math.max(scale, 3 / geometry.baseRadius);
          const frame = originFrame(geometry, Math.max(ORIGIN_STROKE_WIDTH, 0.8 / shapeScale));
          return <path key={group.id} data-minimap-origin={group.id} d={frame.path}
            transform={`translate(${cx} ${cy}) scale(${shapeScale}) translate(${-geometry.center.x} ${-geometry.center.y})`}
            fill={frame.hasInterior ? inheritedColors.get(group.id) || UNCOLORED : 'none'} fillRule="evenodd"
            stroke={frame.hasInterior ? 'none' : inheritedColors.get(group.id) || UNCOLORED} strokeWidth={0.8 / shapeScale} strokeLinejoin="miter" />;
        })}
      </svg>
    </>
  ), [mapCards, mapGroups, bundleIds, inheritedColors, mapLinks, membersByBundle, minX, minY, offsetX, offsetY, origins, scale]);

  const localPoint = (clientX: number, clientY: number) => {
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return null;
    return { x: clamp(clientX - rect.left, 0, mapWidth), y: clamp(clientY - rect.top, 0, mapHeight) };
  };

  useEffect(() => {
    const onMove = (event: MouseEvent) => {
      const start = dragStartRef.current;
      if (!start) return;
      const point = localPoint(event.clientX, event.clientY);
      if (!point) return;
      setDragRect({ x: Math.min(start.x, point.x), y: Math.min(start.y, point.y),
        width: Math.abs(start.x - point.x), height: Math.abs(start.y - point.y) });
    };
    const onUp = (event: MouseEvent) => {
      const start = dragStartRef.current;
      if (!start) return;
      dragStartRef.current = null;
      setDragRect(null);
      const point = localPoint(event.clientX, event.clientY);
      if (!point || scale <= 0) return;
      const width = Math.abs(point.x - start.x);
      const height = Math.abs(point.y - start.y);
      if (width < 6 || height < 6) {
        const worldX = minX + (point.x - offsetX) / scale;
        const worldY = minY + (point.y - offsetY) / scale;
        const zoom = 1;
        onNavigate({ x: windowSize.width / 2 - worldX * zoom,
          y: windowSize.height / 2 - worldY * zoom, zoom });
        return;
      }
      const left = minX + (Math.min(start.x, point.x) - offsetX) / scale;
      const top = minY + (Math.min(start.y, point.y) - offsetY) / scale;
      const worldWidth = width / scale;
      const worldHeight = height / scale;
      const zoom = clamp(Math.min(windowSize.width / worldWidth, windowSize.height / worldHeight), MIN_CANVAS_ZOOM, 3);
      const centerX = left + worldWidth / 2;
      const centerY = top + worldHeight / 2;
      onNavigate({ x: windowSize.width / 2 - centerX * zoom,
        y: windowSize.height / 2 - centerY * zoom, zoom });
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => { window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp); };
  }, [mapWidth, mapHeight, minX, minY, offsetX, offsetY, scale, windowSize, onNavigate]);

  return (
    <div
      ref={containerRef}
      data-minimap
      onMouseDown={(event) => {
        if (event.button !== 0) return;
        event.preventDefault();
        event.stopPropagation();
        dragStartRef.current = localPoint(event.clientX, event.clientY);
      }}
      onContextMenu={(event) => { event.preventDefault(); event.stopPropagation(); }}
      className={`fixed ${expanded ? 'z-[30001] bg-transparent' : 'z-[30000] bg-paper'} pointer-events-auto border-2 border-ink overflow-hidden cursor-crosshair select-none rounded-none`}
      style={{
        left: expanded ? '50%' : '16px',
        top: expanded ? '50%' : undefined,
        bottom: expanded ? undefined : '16px',
        transform: expanded ? 'translate(-50%, -50%)' : undefined,
        width: `${mapWidth}px`,
        height: `${mapHeight}px`,
      }}
    >
      {/* Background Map Canvas / Paper Texture */}
      {!expanded && <div className="absolute inset-0 bg-[#f4f2ed]" />}

      {staticLayer}

      {/* Current Viewport Field of View Indicator */}
      <div
        ref={viewportIndicatorRef}
        data-minimap-viewport
        className="absolute border-2 border-ink pointer-events-none bg-ink/10"
        style={{
          left: `${vpRect.x}px`,
          top: `${vpRect.y}px`,
          width: `${vpRect.w}px`,
          height: `${vpRect.h}px`,
        }}
      />

      {dragRect && dragRect.width + dragRect.height >= 6 && <div
        className="absolute border-2 border-ink bg-ink/10 pointer-events-none"
        style={{ left: dragRect.x, top: dragRect.y, width: dragRect.width, height: dragRect.height }} />}

      {/* Subtle outer indicator dot in corner */}
      <div className="absolute bottom-1 right-1 w-1.5 h-1.5 rounded-full bg-ink/30 pointer-events-none" />
    </div>
  );
};
