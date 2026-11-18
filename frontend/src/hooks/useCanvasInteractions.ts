import { useState, useRef, useEffect, useLayoutEffect, useCallback, MutableRefObject } from 'react';
import { Card, Group, Viewport } from '../types';
import { DragPreviewState, InteractiveWire } from '../components/ParentLinkLines';
import { clamp, screenToWorld, MIN_CANVAS_ZOOM } from '../utils/canvas';
import { saveStateDebounced } from '../utils/storage';
import { addDraggedCardsToBundles } from './useBundleGroups';
import { canAttachTreeNode, getParentLinkage, treeParentId } from '../utils/groupRelations';
import { findTreeTarget } from '../utils/treeTargets';
import { linkEndpoints, linkStartTowardPoint } from '../utils/linkEndpoints';
import { createBundleDragPreviews, projectBundleDragPreview, writeBundlePreviewShape,
  resolveDragReleasePointer, type BundlePreviewTarget } from '../utils/bundleDragPreview';

export type DragMode =
  | 'pan'
  | 'zoom'
  | 'select'
  | 'drag-card'
  | 'drag-group'
  | 'connect-card'
  | 'scale-card'
  | 'resize-card'
  | 'resize-group'
  | 'pie-menu'
  | null;

interface UseCanvasInteractionsProps {
  viewportRef: MutableRefObject<Viewport>;
  setViewport: (vp: Viewport | ((prev: Viewport) => Viewport)) => void;
  previewViewport: (vp: Viewport) => void;
  cardsRef: MutableRefObject<Card[]>;
  setCards: React.Dispatch<React.SetStateAction<Card[]>>;
  groupsRef: MutableRefObject<Group[]>;
  setGroups: React.Dispatch<React.SetStateAction<Group[]>>;
  selectedCardIdsRef: MutableRefObject<Set<string>>;
  setSelectedCardIds: (ids: Set<string>) => void;
  selectedGroupIdsRef: MutableRefObject<Set<string>>;
  setSelectedGroupIds: (ids: Set<string>) => void;
  setSelectionRect: (rect: { x: number; y: number; width: number; height: number } | null) => void;
  clearSelection: () => void;
  beginMarqueeSelection: (isShift: boolean) => void;
  selectCard: (id: string, isShift: boolean) => void;
  selectGroup: (id: string, isShift: boolean) => void;
  updateMarqueeSelection: (rect: { x: number; y: number; width: number; height: number }, cards: Card[], groups: Group[], isCtrl?: boolean) => void;
  isSpacePressedRef: MutableRefObject<boolean>;
  isAltPressedRef: MutableRefObject<boolean>;
  isShiftPressedRef: MutableRefObject<boolean>;
  initDragCards: (cards: Card[]) => void;
  initDragGroup: (group: Group, allCards: Card[], allGroups: Group[]) => void;
  computeCardDragDelta: (deltaX: number, deltaY: number, selectedIds: Set<string>, cards: Card[], snap: boolean) => { dx: number; dy: number };
  updateCardPositions: (dx: number, dy: number, selIds: Set<string>, cards: Card[], snap: boolean, setCards: any, groups: Group[], isCtrl: boolean) => void;
  updateGroupPositions: (dx: number, dy: number, gId: string, setGroups: any, setCards: any, moveChildren: boolean) => void;
  finishCardDrag: (cards: Card[], groups: Group[], selIds: Set<string>, isCtrl: boolean) => { nextCards: Card[]; toastMessage?: string };
  finishGroupDrag: () => void;
  updateScale: (clientX: number, zoom: number, setCards: any) => void;
  updateResize: (clientX: number, clientY: number, zoom: number, setCards: any) => void;
  updateGroupResize: (clientX: number, clientY: number, zoom: number, setGroups: any) => void;
  resetResize: () => void;
  startScale: (card: Card, clientX: number) => void;
  startResize: (card: Card, handle: any, clientX: number, clientY: number) => void;
  dragOverGroupId: string | null;
  setDragOverGroupId: (id: string | null) => void;
  commitState: (cards: Card[], groups: Group[]) => void;
  pushHistory: (cards: Card[], groups: Group[]) => void;
  showToast: (msg: string) => void;
  onOpenPieMenu: (card: Card, clientX: number, clientY: number, multiSelectedCardIds?: Set<string>, rightMouseDown?: boolean) => void;
  onOpenGroupPieMenu: (group: Group, clientX: number, clientY: number, rightMouseDown: boolean) => void;
  onUpdatePieMenuPointer: (clientX: number, clientY: number) => void;
  onReleasePieMenuMouseDown: (clientX: number, clientY: number) => void;
}

export function useCanvasInteractions({
  viewportRef,
  setViewport,
  previewViewport,
  cardsRef,
  setCards,
  groupsRef,
  setGroups,
  selectedCardIdsRef,
  setSelectedCardIds,
  selectedGroupIdsRef,
  setSelectedGroupIds,
  setSelectionRect,
  clearSelection,
  beginMarqueeSelection,
  selectCard,
  selectGroup,
  updateMarqueeSelection,
  isSpacePressedRef,
  isAltPressedRef,
  isShiftPressedRef,
  initDragCards,
  initDragGroup,
  computeCardDragDelta,
  updateCardPositions,
  updateGroupPositions,
  finishCardDrag,
  finishGroupDrag,
  updateScale,
  updateResize,
  updateGroupResize,
  resetResize,
  startScale,
  startResize,
  dragOverGroupId,
  setDragOverGroupId,
  commitState,
  pushHistory,
  showToast,
  onOpenPieMenu,
  onOpenGroupPieMenu,
  onUpdatePieMenuPointer,
  onReleasePieMenuMouseDown,
}: UseCanvasInteractionsProps) {
  const [isPanning, setIsPanning] = useState(false);
  const [isZooming, setIsZooming] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [interactiveWire, setInteractiveWire] = useState<InteractiveWire | null>(null);
  const [movingCardIds, setMovingCardIds] = useState<Set<string>>(new Set());
  const [movingGroupIds, setMovingGroupIds] = useState<Set<string>>(new Set());

  const dragModeRef = useRef<DragMode>(null);
  const draggingGroupIdRef = useRef<string | null>(null);
  const draggingGroupIdsRef = useRef<Set<string>>(new Set());
  const draggingSelectedCardIdsRef = useRef<Set<string>>(new Set());
  const draggingCardBranchIdsRef = useRef<Set<string>>(new Set());
  const draggingCardBranchBundleIdsRef = useRef<Set<string>>(new Set());
  const draggingCardPreviewBundleIdsRef = useRef<Set<string>>(new Set());
  const groupDragShiftRef = useRef(false);
  const groupDragWasSelectedRef = useRef(false);
  const hasGroupDraggedRef = useRef(false);
  const hasCardDraggedRef = useRef(false);
  const dragStartCardsRef = useRef<Card[]>([]);
  const dragStartGroupsRef = useRef<Group[]>([]);
  // Group drag membership is stable for the duration of a gesture. Keep the
  // derived sets here so mousemove only applies the delta instead of walking
  // every group/card and rebuilding parent linkage on every animation frame.
  const draggingGroupMoveIdsRef = useRef<Set<string>>(new Set());
  const draggingGroupLinkedIdsRef = useRef<Set<string>>(new Set());
  const draggingCardMoveIdsRef = useRef<Set<string>>(new Set());
  const dragStartCardByIdRef = useRef<Map<string, Card>>(new Map());
  const dragStartGroupByIdRef = useRef<Map<string, Group>>(new Map());
  const connectingCardIdRef = useRef<string | null>(null);
  const connectingBundleIdRef = useRef<string | null>(null);
  const isolatedDragRef = useRef(false);
  const connectStartRef = useRef<{ x: number; y: number } | null>(null);
  const dragOverGroupIdRef = useRef<string | null>(null);
  const clickedCardInfoRef = useRef<{ id: string; wasAlreadySelected: boolean; shiftKey: boolean } | null>(null);
  const zoomPointerRef = useRef<{ x: number; y: number } | null>(null);
  const dragPreviewRef = useRef<DragPreviewState>({ cardDx: 0, cardDy: 0, groupDx: 0, groupDy: 0, nodeOffsets: new Map() });
  const dragPreviewNodesRef = useRef<Map<string, HTMLElement>>(new Map());
  const bundlePreviewsRef = useRef<ReturnType<typeof createBundleDragPreviews>>(new Map());
  const bundlePreviewTargetsRef = useRef<Map<string, BundlePreviewTarget>>(new Map());
  const bundlePreviewSourcesRef = useRef<{ cards: Card[]; groups: Group[] } | null>(null);
  const lastDragPointerRef = useRef<{ clientX: number; clientY: number } | null>(null);

  const dragStartRef = useRef<{
    screenX: number;
    screenY: number;
    vpX: number;
    vpY: number;
    vpZoom: number;
    worldX: number;
    worldY: number;
  }>({ screenX: 0, screenY: 0, vpX: 0, vpY: 0, vpZoom: 1, worldX: 0, worldY: 0 });

  const collectDragPreviewNodes = useCallback((cardIds: Set<string>, groupIds: Set<string>) => {
    const nodes = new Map<string, HTMLElement>();
    document.querySelectorAll<HTMLElement>('[data-card-id]').forEach((element) => {
      const id = element.getAttribute('data-card-id');
      if (id && cardIds.has(id)) nodes.set(`card:${id}`, element);
    });
    document.querySelectorAll<HTMLElement>('[data-group-id], [data-bundle-id]').forEach((element) => {
      const id = element.getAttribute('data-group-id') || element.getAttribute('data-bundle-id');
      if (id && groupIds.has(id)) nodes.set(`group:${id}`, element);
    });
    dragPreviewNodesRef.current = nodes;
    const targets = new Map<string, BundlePreviewTarget>();
    nodes.forEach((element, key) => {
      if (!element.hasAttribute('data-bundle-id')) return;
      const svg = element.querySelector('svg');
      targets.set(key.slice('group:'.length), { element, svg,
        paths: svg ? Array.from(svg.querySelectorAll('path')) : [] });
    });
    bundlePreviewTargetsRef.current = targets;
    bundlePreviewsRef.current = createBundleDragPreviews(cardsRef.current, groupsRef.current, groupIds, cardIds);
    bundlePreviewSourcesRef.current = { cards: cardsRef.current, groups: groupsRef.current };
    // A newly mounted node can appear after the first preview. Initialize it
    // from the gesture snapshot and replay the current delta before paint.
    nodes.forEach((element, key) => {
      const isCard = key.startsWith('card:');
      const id = key.slice(isCard ? 'card:'.length : 'group:'.length);
      const offset = dragPreviewRef.current.nodeOffsets.get(id);
      if (!offset) return;
      const start = isCard ? dragStartCardByIdRef.current.get(id) : dragStartGroupByIdRef.current.get(id);
      const relative = element.hasAttribute('data-bundle-id');
      if (start || relative) element.style.transform = `translate(${(relative ? 0 : start!.x) + offset.dx}px, ${(relative ? 0 : start!.y) + offset.dy}px)`;
    });
    bundlePreviewsRef.current.forEach((preview, id) => {
      const target = targets.get(id);
      if (!target) return;
      writeBundlePreviewShape(target, preview.base);
      const { cardDx, cardDy } = dragPreviewRef.current;
      const geometry = projectBundleDragPreview(preview, cardDx, cardDy);
      if (geometry.kind === 'translate') target.element.style.transform = `translate(${cardDx}px, ${cardDy}px)`;
      else writeBundlePreviewShape(target, geometry);
    });
  }, [cardsRef, groupsRef]);

  // Far-view selection mounts DOM copies at drag start. Collect again after
  // that commit so newly mounted members move on the very first preview frame.
  useLayoutEffect(() => {
    if (!isDragging) return;
    const groupIds = dragModeRef.current === 'drag-group'
      ? draggingGroupLinkedIdsRef.current : draggingCardPreviewBundleIdsRef.current;
    collectDragPreviewNodes(movingCardIds, groupIds);
  }, [isDragging, movingCardIds, movingGroupIds, cardsRef.current, groupsRef.current, collectDragPreviewNodes]);

  const setDragPreviewTransform = useCallback((element: HTMLElement | undefined, x: number, y: number) => {
    if (element) element.style.transform = `translate(${x}px, ${y}px)`;
  }, []);

  // Cards and origin Groups position themselves with an absolute transform.
  // Bundle Groups already have their world position in left/top, so their
  // drag preview must be a relative offset or the two coordinate systems are
  // applied at the same time and the outline drifts away from its cards.
  const setDragPreviewOffset = useCallback((element: HTMLElement | undefined, x: number, y: number) => {
    if (element) element.style.transform = `translate(${x}px, ${y}px)`;
  }, []);

  const clearDragPreview = useCallback(() => {
    const cardsById = new Map(cardsRef.current.map(card => [card.id, card]));
    const groupsById = new Map(groupsRef.current.map(group => [group.id, group]));
    dragPreviewNodesRef.current.forEach((element, key) => {
      if (key.startsWith('card:')) {
        const id = key.slice('card:'.length);
        const card = cardsById.get(id);
        if (card) element.style.transform = `translate(${card.x}px, ${card.y}px)`;
        else element.style.removeProperty('transform');
        return;
      }
      if (element.hasAttribute('data-bundle-id')) {
        const id = key.slice('group:'.length);
        const target = bundlePreviewTargetsRef.current.get(id);
        const preview = bundlePreviewsRef.current.get(id);
        // Restore manually written geometry even when a click did not become
        // a drag; React may keep identical props and leave DOM edits untouched.
        if (target && preview) writeBundlePreviewShape(target, preview.base);
        else element.style.removeProperty('transform');
        return;
      }
      const id = key.slice('group:'.length);
      const group = groupsById.get(id);
      if (group) element.style.transform = `translate(${group.x}px, ${group.y}px)`;
      else element.style.removeProperty('transform');
    });
    dragPreviewNodesRef.current.clear();
    bundlePreviewsRef.current.clear();
    bundlePreviewTargetsRef.current.clear();
    bundlePreviewSourcesRef.current = null;
    lastDragPointerRef.current = null;
    draggingCardPreviewBundleIdsRef.current.clear();
    dragPreviewRef.current = { cardDx: 0, cardDy: 0, groupDx: 0, groupDy: 0, nodeOffsets: new Map() };
  }, [cardsRef, groupsRef]);

  const updateBundleDragPreviewGeometry = useCallback(() => {
    const sources = bundlePreviewSourcesRef.current;
    if (sources && (sources.cards !== cardsRef.current || sources.groups !== groupsRef.current)) {
      const groupIds = dragModeRef.current === 'drag-group'
        ? draggingGroupLinkedIdsRef.current : draggingCardPreviewBundleIdsRef.current;
      const cardIds = dragModeRef.current === 'drag-group'
        ? draggingCardMoveIdsRef.current : draggingCardBranchIdsRef.current;
      collectDragPreviewNodes(cardIds, groupIds);
    }
    const { cardDx, cardDy } = dragPreviewRef.current;
    bundlePreviewsRef.current.forEach((preview, id) => {
      const target = bundlePreviewTargetsRef.current.get(id);
      if (!target) return;
      const geometry = projectBundleDragPreview(preview, cardDx, cardDy);
      if (geometry.kind === 'translate') {
        target.element.style.transform = `translate(${geometry.dx}px, ${geometry.dy}px)`;
      } else writeBundlePreviewShape(target, geometry);
    });
  }, [cardsRef, groupsRef, collectDragPreviewNodes]);

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    const isMiddle = e.button === 1;
    const isRight = e.button === 2;
    const isLeft = e.button === 0;
    const spaceOrAlt = isSpacePressedRef.current || isAltPressedRef.current;

    if (isMiddle) e.preventDefault();

    const target = e.target as HTMLElement;
    const cardEl = target.closest('[data-card-id]') as HTMLElement | null;
    const groupEl = target.closest('[data-group-id], [data-bundle-id]') as HTMLElement | null;

    if (isRight && (cardEl || groupEl)) {
      e.preventDefault();
      e.stopPropagation();
      const targetCard = cardEl && cardsRef.current.find((c) => c.id === cardEl.getAttribute('data-card-id'));
      const targetGroup = groupEl && groupsRef.current.find((g) =>
        g.id === (groupEl.getAttribute('data-group-id') || groupEl.getAttribute('data-bundle-id')));
      if (targetCard || targetGroup) {
        dragModeRef.current = 'pie-menu';
        if (targetCard) {
          const multi = selectedCardIdsRef.current.has(targetCard.id) && selectedCardIdsRef.current.size > 1
            ? selectedCardIdsRef.current : undefined;
          onOpenPieMenu(targetCard, e.clientX, e.clientY, multi, true);
        } else if (targetGroup) onOpenGroupPieMenu(targetGroup, e.clientX, e.clientY, true);
      }
      return;
    }

    const isPan = isMiddle || isRight || (spaceOrAlt && isLeft);
    const world = screenToWorld(e.clientX, e.clientY, viewportRef.current);

    dragStartRef.current = {
      screenX: e.clientX,
      screenY: e.clientY,
      vpX: viewportRef.current.x,
      vpY: viewportRef.current.y,
      vpZoom: viewportRef.current.zoom,
      worldX: world.x,
      worldY: world.y,
    };

    if (isMiddle && e.altKey) {
      dragModeRef.current = 'zoom';
      setIsZooming(true);
      return;
    }

    if (isPan) {
      dragModeRef.current = 'pan';
      setIsPanning(true);
      return;
    }

    if (isLeft) {
      if (cardEl || groupEl) return;
      dragModeRef.current = 'select';
      beginMarqueeSelection(e.shiftKey);
      if (!e.shiftKey) clearSelection();
      setSelectionRect({ x: world.x, y: world.y, width: 0, height: 0 });
    }
  }, [beginMarqueeSelection, clearSelection, isAltPressedRef, isSpacePressedRef,
    onOpenPieMenu, onOpenGroupPieMenu, cardsRef, groupsRef, setSelectionRect, viewportRef]);

  useEffect(() => {
    let panPreview: typeof viewportRef.current | null = null;
    const applyZoom = (clientX: number, clientY: number) => {
      const start = dragStartRef.current;
      const nextZoom = clamp(start.vpZoom * Math.exp((start.screenY - clientY) * 0.006), MIN_CANVAS_ZOOM, 3.0);
      const next = {
        x: clientX - start.worldX * nextZoom,
        y: clientY - start.worldY * nextZoom,
        zoom: nextZoom,
      };
      previewViewport(next);
    };
    const applyGlobalMouseMove = (e: MouseEvent) => {
      const mode = dragModeRef.current;
      if (!mode) return;
      lastDragPointerRef.current = { clientX: e.clientX, clientY: e.clientY };
      const vp = viewportRef.current;

      if (mode === 'pie-menu') {
        onUpdatePieMenuPointer(e.clientX, e.clientY);
        return;
      }

      if (mode === 'zoom') {
        zoomPointerRef.current = { x: e.clientX, y: e.clientY };
        // The outer mousemove scheduler already runs once per animation frame.
        applyZoom(e.clientX, e.clientY);
        return;
      }

      if (mode === 'pan') {
        const next = {
          ...vp,
          x: dragStartRef.current.vpX + (e.clientX - dragStartRef.current.screenX),
          y: dragStartRef.current.vpY + (e.clientY - dragStartRef.current.screenY),
        };
        previewViewport(next);
        panPreview = next;
        return;
      }

      if (mode === 'select') {
        const currentWorld = screenToWorld(e.clientX, e.clientY, vp);
        const rect = {
          x: Math.min(dragStartRef.current.worldX, currentWorld.x),
          y: Math.min(dragStartRef.current.worldY, currentWorld.y),
          width: Math.abs(currentWorld.x - dragStartRef.current.worldX),
          height: Math.abs(currentWorld.y - dragStartRef.current.worldY),
        };
        const isCtrl = e.ctrlKey || e.metaKey;
        updateMarqueeSelection(rect, cardsRef.current, groupsRef.current, isCtrl);
        return;
      }

      const deltaX = (e.clientX - dragStartRef.current.screenX) / vp.zoom;
      const deltaY = (e.clientY - dragStartRef.current.screenY) / vp.zoom;

      if (mode === 'connect-card') {
        const currentWorld = screenToWorld(e.clientX, e.clientY, vp);
        const sourceId = connectingBundleIdRef.current || connectingCardIdRef.current;
        if (sourceId) {
          const target = findTreeTarget(currentWorld, sourceId, cardsRef.current, groupsRef.current);
          const validTarget = target && canAttachTreeNode(sourceId, target.id, cardsRef.current, groupsRef.current);
          dragOverGroupIdRef.current = target?.id || null;
          setDragOverGroupId(validTarget ? target.id : null);
          const endpoints = validTarget
            ? linkEndpoints(sourceId, target.id, cardsRef.current, groupsRef.current) : null;
          const start = endpoints?.start || linkStartTowardPoint(sourceId, currentWorld,
            cardsRef.current, groupsRef.current);
          if (start) setInteractiveWire({
            startX: start.x, startY: start.y,
            targetX: endpoints?.end.x ?? currentWorld.x,
            targetY: endpoints?.end.y ?? currentWorld.y,
            sourceCardId: sourceId,
            isSnapping: !!validTarget,
          });
        }
        return;
      }

      if (mode === 'drag-card') {
        if (Math.hypot(e.clientX - dragStartRef.current.screenX, e.clientY - dragStartRef.current.screenY) > 3) {
          hasCardDraggedRef.current = true;
        }
        const snap = isShiftPressedRef.current && isSpacePressedRef.current;
        const preview = computeCardDragDelta(deltaX, deltaY, draggingCardBranchIdsRef.current,
          cardsRef.current, snap);
        const nodeOffsets = new Map<string, { dx: number; dy: number }>();
        dragPreviewRef.current = { cardDx: preview.dx, cardDy: preview.dy, groupDx: deltaX, groupDy: deltaY, nodeOffsets };
        draggingCardBranchIdsRef.current.forEach((id) => {
          nodeOffsets.set(id, { dx: preview.dx, dy: preview.dy });
          const start = dragStartCardByIdRef.current.get(id);
          if (start) setDragPreviewTransform(dragPreviewNodesRef.current.get(`card:${id}`),
            start.x + preview.dx, start.y + preview.dy);
        });
        if (draggingCardBranchBundleIdsRef.current.size) {
          draggingCardBranchBundleIdsRef.current.forEach((id) => {
            nodeOffsets.set(id, { dx: deltaX, dy: deltaY });
            setDragPreviewOffset(dragPreviewNodesRef.current.get(`group:${id}`), deltaX, deltaY);
          });
        }
        updateBundleDragPreviewGeometry();
      } else if (mode === 'drag-group') {
          const groupIds = draggingGroupIdsRef.current;
          if (groupIds.size) {
          if (Math.hypot(e.clientX - dragStartRef.current.screenX, e.clientY - dragStartRef.current.screenY) > 3) {
            hasGroupDraggedRef.current = true;
          }
          const movedGroupIds = draggingGroupMoveIdsRef.current;
          const linkedBundleIds = draggingGroupLinkedIdsRef.current;
          const cardIds = draggingCardMoveIdsRef.current;
          const nodeOffsets = new Map<string, { dx: number; dy: number }>();
          dragPreviewRef.current = { cardDx: deltaX, cardDy: deltaY, groupDx: deltaX, groupDy: deltaY, nodeOffsets };
          linkedBundleIds.forEach((id) => {
            const offset = movedGroupIds.has(id) ? 1 : 0;
            nodeOffsets.set(id, { dx: deltaX * offset, dy: deltaY * offset });
            const group = dragStartGroupByIdRef.current.get(id);
            const node = dragPreviewNodesRef.current.get(`group:${id}`);
            if (group && group.kind !== 'bundle') {
              setDragPreviewTransform(node, group.x + deltaX * offset, group.y + deltaY * offset);
            } else setDragPreviewOffset(node, deltaX * offset, deltaY * offset);
          });
          cardIds.forEach((id) => {
            nodeOffsets.set(id, { dx: deltaX, dy: deltaY });
            const start = dragStartCardByIdRef.current.get(id);
            if (start) setDragPreviewTransform(dragPreviewNodesRef.current.get(`card:${id}`),
              start.x + deltaX, start.y + deltaY);
          });
          updateBundleDragPreviewGeometry();
        }
      } else if (mode === 'scale-card') {
        updateScale(e.clientX, vp.zoom, setCards);
      } else if (mode === 'resize-card') {
        updateResize(e.clientX, e.clientY, vp.zoom, setCards);
      } else if (mode === 'resize-group') {
        updateGroupResize(e.clientX, e.clientY, vp.zoom, setGroups);
      }
    };

    let moveFrame: number | null = null;
    let latestMove: MouseEvent | null = null;
    const handleGlobalMouseMove = (event: MouseEvent) => {
      latestMove = event;
      if (moveFrame !== null) return;
      moveFrame = window.requestAnimationFrame(() => {
        moveFrame = null;
        const current = latestMove;
        latestMove = null;
        if (current) applyGlobalMouseMove(current);
      });
    };

    const handleGlobalMouseUp = (e: MouseEvent) => {
      if (moveFrame !== null) window.cancelAnimationFrame(moveFrame);
      moveFrame = null;
      latestMove = null;
      if (dragModeRef.current && dragModeRef.current !== 'zoom') applyGlobalMouseMove(e);
      const mode = dragModeRef.current;
      dragModeRef.current = null;
      if (mode === 'drag-card' || mode === 'drag-group') setIsDragging(false);
      setMovingCardIds((previous) => previous.size ? new Set() : previous);
      setMovingGroupIds((previous) => previous.size ? new Set() : previous);
      if (mode === 'pan' && panPreview) {
        setViewport(panPreview);
        panPreview = null;
      }
      setIsPanning(false);
      setIsZooming(false);
      setSelectionRect(null);
      resetResize();

      if (mode === 'zoom') {
        zoomPointerRef.current = null;
        applyZoom(e.clientX, e.clientY);
        setViewport(viewportRef.current);
        return;
      }

      if (mode === 'connect-card') {
        const started = connectStartRef.current;
        connectStartRef.current = null;
        const sourceId = connectingCardIdRef.current;
        const bundleId = connectingBundleIdRef.current;
        const activeSourceId = bundleId || sourceId;
        const target = activeSourceId ? findTreeTarget(screenToWorld(e.clientX, e.clientY, viewportRef.current),
          activeSourceId, cardsRef.current, groupsRef.current) : null;
        connectingCardIdRef.current = null;
        connectingBundleIdRef.current = null;
        dragOverGroupIdRef.current = null;
        setInteractiveWire(null);
        setDragOverGroupId(null);
        if (!activeSourceId) return;
        const currentParentId = treeParentId(activeSourceId, cardsRef.current, groupsRef.current);
        if (started && Math.hypot(e.clientX - started.x, e.clientY - started.y) < 6) {
          if (!currentParentId) return;
          pushHistory(cardsRef.current, groupsRef.current);
          if (bundleId) {
            commitState(cardsRef.current, groupsRef.current.map((group) => group.id === bundleId
              ? { ...group, parentIds: [] } : group));
          } else {
            commitState(cardsRef.current.map((card) => card.id === sourceId
              ? { ...card, groupId: null } : card), groupsRef.current);
          }
          return;
        }
        if (target && !canAttachTreeNode(activeSourceId, target.id, cardsRef.current, groupsRef.current)) {
          showToast('不能连接到自己的下级，树状结构不允许形成环');
          return;
        }
        const targetId = target?.id || null;
        if (targetId === currentParentId || (!targetId && !currentParentId)) return;
        pushHistory(cardsRef.current, groupsRef.current);
        if (bundleId) {
          const nextGroups = groupsRef.current.map((group) => group.id === bundleId
            ? { ...group, parentIds: targetId ? [targetId] : [] } : group);
          commitState(cardsRef.current, nextGroups);
        } else {
          const nextCards = cardsRef.current.map((card) => card.id === sourceId
            ? { ...card, groupId: targetId } : card);
          commitState(nextCards, groupsRef.current);
        }
        return;
      }

      if (mode === 'pie-menu' || e.button === 2) {
        onReleasePieMenuMouseDown(e.clientX, e.clientY);
      }
      if (mode === 'drag-card') {
        const isolated = isolatedDragRef.current;
        isolatedDragRef.current = false;
        const info = clickedCardInfoRef.current;
        const didDrag = hasCardDraggedRef.current;
        if (!didDrag && info && info.wasAlreadySelected && !info.shiftKey) {
          setSelectedCardIds(new Set([info.id]));
        }
        clickedCardInfoRef.current = null;
        hasCardDraggedRef.current = false;

        const { cardDx, cardDy, groupDx, groupDy } = dragPreviewRef.current;
        let previewCards = didDrag ? cardsRef.current.map((card) => {
          const start = dragStartCardByIdRef.current.get(card.id);
          return start && draggingCardBranchIdsRef.current.has(card.id)
            ? { ...card, x: start.x + cardDx, y: start.y + cardDy } : card;
        }) : cardsRef.current;
        let previewGroups = groupsRef.current;
        if (didDrag && !isolated && draggingCardBranchBundleIdsRef.current.size) {
          previewGroups = groupsRef.current.map((group) => {
            const start = dragStartGroupByIdRef.current.get(group.id);
            return start && draggingCardBranchBundleIdsRef.current.has(group.id)
              ? { ...group, x: start.x + groupDx, y: start.y + groupDy } : group;
          });
        }
        let { nextCards } = finishCardDrag(
          previewCards,
          previewGroups,
          selectedCardIdsRef.current,
          isolated
        );
        let nextGroups = previewGroups;
        if (didDrag && !isolated) {
          const result = addDraggedCardsToBundles(nextCards, nextGroups, selectedCardIdsRef.current,
            dragStartCardsRef.current, dragStartGroupsRef.current);
          nextCards = result.nextCards;
          nextGroups = result.nextGroups;
        }
      dragStartCardsRef.current = [];
        dragStartGroupsRef.current = [];
        draggingCardBranchIdsRef.current.clear();
        draggingCardBranchBundleIdsRef.current.clear();
        dragStartCardByIdRef.current.clear();
        dragStartGroupByIdRef.current.clear();
        clearDragPreview();
        commitState(nextCards, nextGroups);
      } else if (mode === 'drag-group') {
        isolatedDragRef.current = false;
        const gId = draggingGroupIdRef.current;
        draggingGroupIdRef.current = null;
        draggingGroupIdsRef.current = new Set();
        draggingSelectedCardIdsRef.current = new Set();
        if (!hasGroupDraggedRef.current && gId) {
          if (groupDragShiftRef.current && groupDragWasSelectedRef.current) {
            const next = new Set(selectedGroupIdsRef.current);
            next.delete(gId);
            setSelectedGroupIds(next);
          } else if (!groupDragShiftRef.current) {
            setSelectedGroupIds(new Set([gId]));
          }
        }
        if (hasGroupDraggedRef.current && gId) {
          hasGroupDraggedRef.current = false;
          const { cardDx, cardDy, groupDx, groupDy } = dragPreviewRef.current;
          const nextCards = cardsRef.current.map((card) => {
            const start = dragStartCardByIdRef.current.get(card.id);
            return start && draggingCardMoveIdsRef.current.has(card.id)
              ? { ...card, x: start.x + cardDx, y: start.y + cardDy } : card;
          });
          const nextGroups = groupsRef.current.map((item) => {
            const start = dragStartGroupByIdRef.current.get(item.id);
            if (!start || !draggingGroupLinkedIdsRef.current.has(item.id)) return item;
            const offset = draggingGroupMoveIdsRef.current.has(item.id) ? 1 : 0;
            return { ...item, x: start.x + groupDx * offset, y: start.y + groupDy * offset };
          });
          commitState(nextCards, nextGroups);
        }
        dragStartCardsRef.current = [];
        dragStartGroupsRef.current = [];
        draggingGroupMoveIdsRef.current.clear();
        draggingGroupLinkedIdsRef.current.clear();
        draggingCardMoveIdsRef.current.clear();
        dragStartCardByIdRef.current.clear();
        dragStartGroupByIdRef.current.clear();
        clearDragPreview();
        finishGroupDrag();
      } else if (mode === 'scale-card' || mode === 'resize-card' || mode === 'resize-group') {
        saveStateDebounced(cardsRef.current, groupsRef.current);
      }
    };

    const handleWindowBlur = () => {
      const mode = dragModeRef.current;
      if (mode === 'drag-card' || mode === 'drag-group') {
        if (moveFrame !== null) window.cancelAnimationFrame(moveFrame);
        moveFrame = null;
        const last = resolveDragReleasePointer(latestMove, lastDragPointerRef.current, dragStartRef.current);
        latestMove = null;
        const { clientX, clientY } = last;
        handleGlobalMouseUp(new MouseEvent('mouseup', { button: 0, clientX, clientY }));
        return;
      }
      if (mode !== 'zoom' && mode !== 'pan') return;
      if (moveFrame !== null) window.cancelAnimationFrame(moveFrame);
      moveFrame = null;
      if (latestMove) applyGlobalMouseMove(latestMove);
      latestMove = null;
      if (mode === 'zoom' && zoomPointerRef.current) {
        applyZoom(zoomPointerRef.current.x, zoomPointerRef.current.y);
      }
      setViewport(viewportRef.current);
      panPreview = null;
      dragModeRef.current = null;
      setIsPanning(false);
      setIsZooming(false);
      zoomPointerRef.current = null;
    };
    window.addEventListener('mousemove', handleGlobalMouseMove, { passive: true });
    window.addEventListener('mouseup', handleGlobalMouseUp);
    window.addEventListener('blur', handleWindowBlur);
    return () => {
      window.removeEventListener('mousemove', handleGlobalMouseMove);
      window.removeEventListener('mouseup', handleGlobalMouseUp);
      window.removeEventListener('blur', handleWindowBlur);
      if (moveFrame !== null) window.cancelAnimationFrame(moveFrame);
    };
  }, [
    cardsRef,
    clearDragPreview,
    computeCardDragDelta,
    commitState,
    setDragPreviewTransform,
    setDragPreviewOffset,
    updateBundleDragPreviewGeometry,
    finishCardDrag,
    finishGroupDrag,
    groupsRef,
    isShiftPressedRef,
    isSpacePressedRef,
    onReleasePieMenuMouseDown,
    onUpdatePieMenuPointer,
    pushHistory,
    resetResize,
    selectedCardIdsRef,
    selectedGroupIdsRef,
    setSelectedGroupIds,
    setCards,
    setDragOverGroupId,
    setGroups,
    setSelectedCardIds,
    setSelectionRect,
    setViewport,
    previewViewport,
    showToast,
    updateCardPositions,
    updateGroupPositions,
    updateGroupResize,
    updateMarqueeSelection,
    updateResize,
    updateScale,
    viewportRef,
  ]);

  const handleStartCardDrag = useCallback(
    (card: Card, e: React.MouseEvent) => {
      if (e.ctrlKey && e.shiftKey && !e.altKey) {
        dragModeRef.current = 'connect-card';
        connectStartRef.current = { x: e.clientX, y: e.clientY };
        const sourceId = card.bundleId && groupsRef.current.some((group) => group.id === card.bundleId && group.kind === 'bundle')
          ? card.bundleId : card.id;
        if (sourceId === card.id) connectingCardIdRef.current = card.id;
        else connectingBundleIdRef.current = sourceId;
        const currentWorld = screenToWorld(e.clientX, e.clientY, viewportRef.current);
        const source = linkStartTowardPoint(sourceId, currentWorld, cardsRef.current, groupsRef.current);
        setInteractiveWire({
          startX: source?.x ?? card.x + card.width / 2,
          startY: source?.y ?? card.y + card.height / 2,
          targetX: currentWorld.x,
          targetY: currentWorld.y,
          sourceCardId: sourceId,
        });
        return;
      }

      dragModeRef.current = 'drag-card';
      lastDragPointerRef.current = { clientX: e.clientX, clientY: e.clientY };
      isolatedDragRef.current = (e.ctrlKey || e.metaKey) && !e.altKey;
      hasCardDraggedRef.current = false;
      dragStartCardsRef.current = cardsRef.current;
      dragStartGroupsRef.current = groupsRef.current;
      pushHistory(cardsRef.current, groupsRef.current);

      const wasAlreadySelected = selectedCardIdsRef.current.has(card.id);
      clickedCardInfoRef.current = { id: card.id, wasAlreadySelected, shiftKey: e.shiftKey };

      let nextIds: Set<string>;
      if (isolatedDragRef.current) {
        nextIds = new Set([card.id]);
        selectCard(card.id, false);
      } else if (e.shiftKey) {
        nextIds = new Set(selectedCardIdsRef.current);
        nextIds.add(card.id);
        selectCard(card.id, true);
      } else if (wasAlreadySelected) {
        nextIds = new Set(selectedCardIdsRef.current);
      } else {
        nextIds = new Set([card.id]);
        selectCard(card.id, false);
      }
      const branchCardIds = new Set(nextIds);
      const branchBundleIds = new Set<string>();
      if (!isolatedDragRef.current) nextIds.forEach((id) => {
        const linked = getParentLinkage(cardsRef.current, id, groupsRef.current);
        linked.cardIds.forEach((childId) => branchCardIds.add(childId));
        linked.bundleIds.forEach((bundleId) => branchBundleIds.add(bundleId));
      });
      // A bundle member is a leaf in the downward linkage traversal, so its
      // owning Bundle is not included by getParentLinkage. Include that chain
      // explicitly so the outline can follow a member during direct-preview
      // dragging.
      const previewBundleIds = new Set(branchBundleIds);
      branchCardIds.forEach((cardId) => {
        let bundleId = cardsRef.current.find((item) => item.id === cardId)?.bundleId || null;
        const visited = new Set<string>();
        while (bundleId && !visited.has(bundleId)) {
          visited.add(bundleId);
          const bundle = groupsRef.current.find((item) => item.id === bundleId && item.kind === 'bundle');
          if (!bundle) break;
          previewBundleIds.add(bundle.id);
          bundleId = (bundle.parentIds || []).find((parentId) =>
            groupsRef.current.some((item) => item.id === parentId && item.kind === 'bundle')) || null;
        }
      });
      draggingCardBranchIdsRef.current = branchCardIds;
      draggingCardBranchBundleIdsRef.current = branchBundleIds;
      draggingCardPreviewBundleIdsRef.current = previewBundleIds;
      dragStartCardByIdRef.current = new Map(cardsRef.current
        .filter((item) => branchCardIds.has(item.id))
        .map((item) => [item.id, item]));
      dragStartGroupByIdRef.current = new Map(groupsRef.current
        .filter((item) => branchBundleIds.has(item.id))
        .map((item) => [item.id, item]));
      dragPreviewRef.current = { cardDx: 0, cardDy: 0, groupDx: 0, groupDy: 0, nodeOffsets: new Map() };
      collectDragPreviewNodes(branchCardIds, previewBundleIds);
      setIsDragging(true);
      setMovingCardIds(new Set(branchCardIds));
      setMovingGroupIds(new Set(previewBundleIds));
      initDragCards(cardsRef.current.filter((c) => branchCardIds.has(c.id)));
    },
    [cardsRef, collectDragPreviewNodes, groupsRef, initDragCards, pushHistory, selectCard, selectedCardIdsRef, viewportRef]
  );

  const handleStartGroupDrag = useCallback(
    (group: Group, e: React.MouseEvent) => {
      if (e.button !== 0) return;
      e.stopPropagation();
      if (group.kind === 'bundle' && e.ctrlKey && e.shiftKey && !e.altKey) {
        dragModeRef.current = 'connect-card';
        connectStartRef.current = { x: e.clientX, y: e.clientY };
        connectingBundleIdRef.current = group.id;
        const currentWorld = screenToWorld(e.clientX, e.clientY, viewportRef.current);
        const source = linkStartTowardPoint(group.id, currentWorld, cardsRef.current, groupsRef.current);
        setInteractiveWire({
          startX: source?.x ?? group.x + group.width / 2,
          startY: source?.y ?? group.y + group.height / 2,
          targetX: currentWorld.x,
          targetY: currentWorld.y,
          sourceCardId: group.id,
        });
        return;
      }
      const vp = viewportRef.current;
      dragStartRef.current = {
        screenX: e.clientX,
        screenY: e.clientY,
        vpX: vp.x,
        vpY: vp.y,
        vpZoom: vp.zoom,
        worldX: (e.clientX - vp.x) / vp.zoom,
        worldY: (e.clientY - vp.y) / vp.zoom,
      };
      dragModeRef.current = 'drag-group';
      lastDragPointerRef.current = { clientX: e.clientX, clientY: e.clientY };
      isolatedDragRef.current = (e.ctrlKey || e.metaKey) && !e.altKey;
      draggingGroupIdRef.current = group.id;
      groupDragShiftRef.current = e.shiftKey;
      groupDragWasSelectedRef.current = selectedGroupIdsRef.current.has(group.id);
      draggingGroupIdsRef.current = new Set(!isolatedDragRef.current && (e.shiftKey || groupDragWasSelectedRef.current)
        ? selectedGroupIdsRef.current : []);
      draggingGroupIdsRef.current.add(group.id);
      draggingSelectedCardIdsRef.current = new Set(!isolatedDragRef.current && (e.shiftKey || groupDragWasSelectedRef.current)
        ? selectedCardIdsRef.current : []);
      const moveGroupIds = isolatedDragRef.current
        ? new Set<string>([group.id])
        : new Set(draggingGroupIdsRef.current);
      const linkedGroupIds = new Set(moveGroupIds);
      const moveCardIds = new Set(draggingSelectedCardIdsRef.current);
      if (!isolatedDragRef.current) {
        for (const id of draggingGroupIdsRef.current) {
          const groupItem = groupsRef.current.find((item) => item.id === id);
          if (groupItem?.kind === 'bundle') {
            cardsRef.current.forEach((card) => {
              if (card.bundleId === id) moveCardIds.add(card.id);
            });
          }
          const linked = getParentLinkage(cardsRef.current, id, groupsRef.current);
          linked.cardIds.forEach((cardId) => moveCardIds.add(cardId));
          linked.bundleIds.forEach((bundleId) => linkedGroupIds.add(bundleId));
        }
      }
      draggingGroupMoveIdsRef.current = moveGroupIds;
      draggingGroupLinkedIdsRef.current = linkedGroupIds;
      draggingCardMoveIdsRef.current = moveCardIds;
      const moving = new Set(moveCardIds);
      dragStartCardByIdRef.current = new Map(cardsRef.current
        .filter((card) => moveCardIds.has(card.id))
        .map((card) => [card.id, card]));
      dragStartGroupByIdRef.current = new Map(groupsRef.current
        .filter((item) => linkedGroupIds.has(item.id))
        .map((item) => [item.id, item]));
      setMovingCardIds(moving);
      setMovingGroupIds(new Set(linkedGroupIds));
      hasGroupDraggedRef.current = false;
      dragStartCardsRef.current = cardsRef.current;
      dragStartGroupsRef.current = groupsRef.current;
      pushHistory(cardsRef.current, groupsRef.current);
      dragPreviewRef.current = { cardDx: 0, cardDy: 0, groupDx: 0, groupDy: 0, nodeOffsets: new Map() };
      collectDragPreviewNodes(moveCardIds, linkedGroupIds);
      setIsDragging(true);
      if (e.shiftKey) setSelectedGroupIds(new Set(draggingGroupIdsRef.current));
      else if (!groupDragWasSelectedRef.current) {
        selectGroup(group.id, false);
      }
    },
    [cardsRef, collectDragPreviewNodes, groupsRef, pushHistory, selectedGroupIdsRef, selectedCardIdsRef, selectGroup, setSelectedCardIds, setSelectedGroupIds, viewportRef]
  );

  const handleStartCardScale = useCallback(
    (c: Card, clientX: number) => {
      pushHistory(cardsRef.current, groupsRef.current);
      dragModeRef.current = 'scale-card';
      startScale(c, clientX);
    },
    [cardsRef, groupsRef, pushHistory, startScale]
  );

  const handleStartCardResize = useCallback(
    (c: Card, handle: any, e: React.MouseEvent) => {
      pushHistory(cardsRef.current, groupsRef.current);
      dragModeRef.current = 'resize-card';
      startResize(c, handle, e.clientX, e.clientY);
      setSelectedCardIds(new Set([c.id]));
    },
    [cardsRef, groupsRef, pushHistory, setSelectedCardIds, startResize]
  );

  return {
    isPanning,
    isZooming,
    isDragging,
    interactiveWire,
    movingCardIds,
    movingGroupIds,
    dragStartRef,
    dragPreviewRef,
    handleMouseDown,
    handleStartCardDrag,
    handleStartGroupDrag,
    handleStartCardScale,
    handleStartCardResize,
  };
}
