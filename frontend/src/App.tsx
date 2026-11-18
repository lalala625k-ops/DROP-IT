import React, { useState, useRef, useCallback, useMemo, useEffect, useDeferredValue } from 'react';
import { flushSync } from 'react-dom';
import { Card, Viewport } from './types';
import { CardComponent } from './components/CardComponent';
import { GroupComponent } from './components/GroupComponent';
import { buildOriginGeometries } from './utils/originGeometry';
import { BundleGroupComponent } from './components/BundleGroupComponent';
import { ParentLinkLines } from './components/ParentLinkLines';
import { FarCanvas } from './components/FarCanvas';
import { farCardOnScreen } from './utils/farCardDrawing';
import { cardVisualBounds } from './utils/cardBounds';
import { shouldUseRasterOverview } from './utils/canvasRenderMode';
import { ClipboardPastePreview } from './components/ClipboardPastePreview';
import { SelectionBox } from './components/SelectionBox';
import { SnapGuides } from './components/SnapGuides';
import { CanvasCommandMenu, CanvasCommand } from './components/CanvasCommandMenu';
import { applyGroupMenuAction } from './utils/groupMenuActions';
import { CanvasModals } from './components/CanvasModals';
import { DesktopWindowControls } from './components/DesktopWindowControls';
import { DocumentDecisionDialog } from './components/DocumentDecisionDialog';
import { useDocumentState } from './hooks/useDocumentState';
import { DropRecoveryDialog } from './components/DropRecoveryDialog';
import { DropRecoveryRequired, DropRecoveryOffer, DropOpenChoice } from './utils/dropRecovery';
import { useCanvasPins } from './hooks/useCanvasPins';
import { PinInputModal } from './components/PinInputModal';
import { CanvasPinsLayer } from './components/CanvasPinsLayer';
import { useSettings } from './hooks/useSettings';
import { SettingsModal } from './components/SettingsModal';
import { RecoveryPanel } from './components/settings/RecoveryPanel';

import { computeCardFocusViewport } from './utils/canvas';
import { getNowFormatted } from './utils/dateParser';
import { acceptLoadedWorkspace, getLocalData, getRemoteRevision, currentServerRevision, openDropFile, selectDropFile, saveStateDebounced, hydrateProgressiveOpen } from './utils/storage';
import { getParentLinkage } from './utils/groupRelations';
import { resolveBranchColors } from './utils/branchColors';

import { useViewport } from './hooks/useViewport';
import { useSelection } from './hooks/useSelection';
import { useGroups } from './hooks/useGroups';
import { useCardResize } from './hooks/useCardResize';
import { useCardDrag } from './hooks/useCardDrag';
import { useClipboardPaste } from './hooks/useClipboardPaste';
import { useShortcuts } from './hooks/useShortcuts';
import { useHistory } from './hooks/useHistory';
import { useMinimapState } from './hooks/useMinimapState';
import { useCardClipboard } from './hooks/useCardClipboard';
import { usePieMenuState } from './hooks/usePieMenuState';
import { useCanvasInteractions } from './hooks/useCanvasInteractions';
import { useCanvasDrop } from './hooks/useCanvasDrop';
import { useCanvasActions } from './hooks/useCanvasActions';
import { useCanvasInit } from './hooks/useCanvasInit';
import { useWorkspaceDraft } from './hooks/useWorkspaceDraft';
import { flushWorkspaceDraft, flushWorkspaceJournal, workspaceRequest, RecoverySelection } from './utils/workspaceApi';
import { openBoardWindow, consumeOpenFileRequest, completeRecoveryRequest, getOpenSelectionRequest } from './utils/boardWindows';
import { useCanvasCards } from './hooks/useCanvasCards';
import { useBundleMotion } from './hooks/useBundleMotion';
import { useVirtualViewport } from './hooks/useVirtualViewport';
import { useCanvasDomHandoff } from './hooks/useCanvasDomHandoff';
import { migrateRemoteImageCards } from './utils/remoteImage';
import { bundleDisplayBounds, useBundleGroups } from './hooks/useBundleGroups';

export default function App() {
  const [cards, setCards] = useState<Card[]>([]);
  const cardsRef = useRef<Card[]>(cards);
  cardsRef.current = cards;

  const maxZIndexRef = useRef(10);
  const containerRef = useRef<HTMLDivElement>(null);
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const [isRecoveryOpen, setIsRecoveryOpen] = useState(false);
  const [startupRecords, setStartupRecords] = useState<import('./utils/workspaceApi').RecoveryRecord[] | null>(null);
  const [pressedObject, setPressedObject] = useState<string | null>(null);
  const [canvasMenuPosition, setCanvasMenuPosition] = useState<{ x: number; y: number } | null>(null);
  const suppressPasteClickRef = useRef(false);
  const savingDropRef = useRef(false);
  const documentSaveRef = useRef<((saveAs: boolean) => Promise<boolean>) | null>(null);
  const [dropRecovery, setDropRecovery] = useState<DropRecoveryOffer | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const showToast = useCallback((msg: string) => setToast(msg), []);
  useEffect(() => {
    const failed = (event: Event) => showToast((event as CustomEvent<string>).detail);
    window.addEventListener('pinboard-file-error', failed);
    return () => window.removeEventListener('pinboard-file-error', failed);
  }, [showToast]);

  useEffect(() => {
    const release = () => setPressedObject(null);
    window.addEventListener('mouseup', release);
    window.addEventListener('blur', release);
    return () => {
      window.removeEventListener('mouseup', release);
      window.removeEventListener('blur', release);
    };
  }, []);

  useEffect(() => {
    // A blocking browser alert can make the canvas appear frozen (especially
    // in the desktop WebView, where the dialog is easy to miss).  Surface the
    // same conflict as the app toast so the board remains interactive.
    const onConflict = () => showToast('另一窗口已经修改画布。本窗口的修改已保存在本地，请先备份或刷新后处理冲突。');
    const onFocus = async () => {
      if (savingDropRef.current) return;
      const revision = await getRemoteRevision();
      if (revision === null || revision === currentServerRevision()) return;
      if (getLocalData()?.pendingSync) { onConflict(); return; }
      window.location.reload();
    };
    window.addEventListener('focus', onFocus);
    window.addEventListener('pinboard-sync-conflict', onConflict);
    return () => {
      window.removeEventListener('focus', onFocus);
      window.removeEventListener('pinboard-sync-conflict', onConflict);
    };
  }, [showToast]);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(null), 5000);
    return () => window.clearTimeout(timer);
  }, [toast]);

  // Base Canvas & State Hooks
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const {
    settings,
    updateShortcuts,
    updateGeneral,
    resetShortcuts,
  } = useSettings();

  const {
    viewport,
    setViewport,
    previewViewport,
    subscribeViewportPreview,
    viewportRef,
    surfaceRef,
    mouseScreenRef,
    mouseWorldRef,
    handleWheel,
    flushWheelZoom,
    isWheelZooming,
    handleCardDoubleClick,
    handleCanvasDoubleClick,
  } = useViewport({ invertWheelZoom: settings.general.invertWheelZoom });

  const canvasPins = useCanvasPins({ viewportRef, setViewport, previewViewport, showToast });
  const { pushHistory, undo } = useHistory(canvasPins.pinsRef);
  const {
    selectedCardIds,
    setSelectedCardIds,
    selectedCardIdsRef,
    selectedGroupIds,
    setSelectedGroupIds,
    selectedGroupIdsRef,
    selectedPinIds,
    setSelectedPinIds,
    selectedPinIdsRef,
    selectionRect,
    setSelectionRect,
    clearSelection,
    selectCard,
    selectGroup,
    selectPin,
    beginMarqueeSelection,
    updateMarqueeSelection,
  } = useSelection(canvasPins.pinsRef, viewportRef);

  const {
    groups,
    setGroups,
    groupsRef,
    refreshGroupBounds,
    createParentWithCollisionAvoidance,
    createGroupFromSelection,
    renameGroup,
  } = useGroups([]);

  const bundles = useBundleGroups({
    cardsRef, setCards, groupsRef, setGroups, selectedCardIdsRef, setSelectedCardIds,
    setSelectedGroupIds, zoomRef: viewportRef, pushHistory, showToast,
  });
  const animateBundle = useBundleMotion();

  const membersByBundle = useMemo(() => {
    const result = new Map<string, Card[]>();
    for (const card of cards) if (card.bundleId) {
      const members = result.get(card.bundleId) || [];
      members.push(card);
      result.set(card.bundleId, members);
    }
    return result;
  }, [cards]);
  const displayGroups = useMemo(() => groups.map((group) =>
    group.kind === 'bundle'
      ? bundleDisplayBounds(membersByBundle.get(group.id) || [], group) : group
  ), [groups, membersByBundle]);
  const branchColors = useMemo(() => resolveBranchColors(cards, groups), [cards, groups]);
  const originGeometries = useMemo(() => buildOriginGeometries(cards, displayGroups), [cards, displayGroups]);
  const collapsedIds = useMemo(() => new Set(groups.filter((group) => group.kind === 'bundle' && group.collapsed).map((group) => group.id)), [groups]);
  const [hoveredCollapsedCardId, setHoveredCollapsedCardId] = useState<string | null>(null);
  const collapsedHoverTimer = useRef<number | null>(null);
  const revealCollapsedCard = useCallback((cardId: string | null) => {
    if (collapsedHoverTimer.current !== null) window.clearTimeout(collapsedHoverTimer.current);
    if (cardId) setHoveredCollapsedCardId(cardId);
    else collapsedHoverTimer.current = window.setTimeout(() => setHoveredCollapsedCardId(null), 120);
  }, []);
  useEffect(() => () => {
    if (collapsedHoverTimer.current !== null) window.clearTimeout(collapsedHoverTimer.current);
  }, []);
  const toggleBundleWithMotion = useCallback((id: string) => {
    animateBundle(id, (membersByBundle.get(id) || []).map(card => card.id), () => {
      if (collapsedHoverTimer.current !== null) window.clearTimeout(collapsedHoverTimer.current);
      setHoveredCollapsedCardId(null);
      bundles.toggleBundle(id);
    });
  }, [animateBundle, bundles, membersByBundle]);
  const canvasCards = useCanvasCards(cards, collapsedIds, hoveredCollapsedCardId, groups);
  // displayGroups already contains the projected bounds used for rendering;
  // reuse it for fit-to-canvas instead of rebuilding every collapsed stack.
  const fitGroups = displayGroups;

  const { startScale, startResize, updateScale, updateResize, updateGroupResize, resetResize } = useCardResize();
  const {
    snapLines,
    dragOverGroupId,
    setDragOverGroupId,
    initDragCards,
    initDragGroup,
    computeCardDragDelta,
    updateCardPositions,
    updateGroupPositions,
    finishCardDrag,
    finishGroupDrag,
  } = useCardDrag();

  // Domain Extension Hooks
  const minimap = useMinimapState();
  const clipboard = useCardClipboard({
    cardsRef,
    groupsRef,
    selectedCardIdsRef,
    selectedGroupIdsRef,
    pinsRef: canvasPins.pinsRef,
    selectedPinIdsRef,
    replacePins: canvasPins.replacePins,
    setSelectedPinIds,
    setSelectedCardIds,
    setSelectedGroupIds,
    setCards,
    setGroups,
    maxZIndexRef,
    mouseWorldRef,
    mouseScreenRef,
    pushHistory,
    showToast,
  });

  const pieMenu = usePieMenuState({ cardsRef, groupsRef, setCards, setGroups, pushHistory, showToast });

  const actions = useCanvasActions({
    cardsRef,
    setCards,
    groupsRef,
    setGroups,
    selectedCardIdsRef,
    setSelectedCardIds,
    selectedGroupIdsRef,
    pinsRef: canvasPins.pinsRef,
    selectedPinIdsRef,
    replacePins: canvasPins.replacePins,
    setSelectedGroupIds,
    maxZIndexRef,
    mouseWorldRef,
    pushHistory,
    undo,
    clearSelection,
    refreshGroupBounds,
    createParentWithCollisionAvoidance,
    createGroupFromSelection,
    showToast,
  });

  const dissolveParent = useCallback((parentId: string) => {
    if (!groupsRef.current.some((group) => group.id === parentId && group.kind !== 'bundle')) return;
    pushHistory(cardsRef.current, groupsRef.current);
    const nextCards = cardsRef.current.map((card) => card.groupId === parentId ? { ...card, groupId: null } : card);
    const nextGroups = groupsRef.current.filter((group) => group.id !== parentId)
      .map((group) => group.parentIds?.includes(parentId)
        ? { ...group, parentIds: group.parentIds.filter((id) => id !== parentId) } : group);
    actions.commitState(nextCards, nextGroups);
    setSelectedGroupIds((previous) => {
      const next = new Set(previous);
      next.delete(parentId);
      return next;
    });
    showToast('已解散原点，卡片已保留');
  }, [actions.commitState, pushHistory, setSelectedGroupIds, showToast]);

  const parentHighlights = useMemo(() => {
    const cardIds = new Set<string>();
    const bundleIds = new Set<string>();
    for (const id of [...selectedGroupIds, ...selectedCardIds]) {
      const linked = getParentLinkage(cards, id, displayGroups);
      linked.cardIds.forEach((id) => cardIds.add(id));
      linked.bundleIds.forEach((id) => bundleIds.add(id));
    }
    return { cardIds, bundleIds };
  }, [cards, displayGroups, selectedCardIds, selectedGroupIds]);

  // Paste & Shortcuts
  const { handlePaste, handleDroppedData, pasteFromSystemClipboard } = useClipboardPaste({
    createCardAtCursor: actions.createCardAtCursor,
    updateCard: actions.handleCardUpdate,
    stageCopiedObjects: clipboard.stagePaste,
    getCopiedObjects: () => clipboard.copiedObjectsRef.current,
    hasCanvasMultiSelection: selectedCardIds.size + selectedGroupIds.size + selectedPinIds.size > 1,
    getWorldPosition: () => mouseWorldRef.current,
    getCardById: (id) => cardsRef.current.find((card) => card.id === id),
    showToast,
  });

  const resetObjectSize = useCallback((id: string) => {
    const selectedIds = selectedCardIdsRef.current;
    if (selectedIds.has(id) && selectedIds.size > 1) {
      selectedIds.forEach((cardId) => {
        actions.handleResetCardSize(cardId);
      });
      return;
    }
    const group = groupsRef.current.find((item) => item.id === id && item.kind === 'bundle');
    if (group) { bundles.resetBundleSize(group.id); return; }
    const card = cardsRef.current.find((item) => item.id === id);
    if (!card) return;
    if (card.bundleId && groupsRef.current.some((item) => item.id === card.bundleId && item.kind === 'bundle')) {
      bundles.resetBundleSize(card.bundleId);
    } else actions.handleResetCardSize(card.id);
  }, [actions.handleResetCardSize, bundles.resetBundleSize, cardsRef, groupsRef]);

  const handleDetachCardFromBundle = useCallback((cardId: string) => {
    const selectedIds = selectedCardIdsRef.current;
    if (selectedIds.has(cardId) && selectedIds.size > 1) {
      selectedIds.forEach((cid) => bundles.detachCardFromBundle(cid));
      return;
    }
    bundles.detachCardFromBundle(cardId);
  }, [bundles]);

  const handleDisconnectCardParent = useCallback((cardId: string) => {
    const selectedIds = selectedCardIdsRef.current;
    if (selectedIds.has(cardId) && selectedIds.size > 1) {
      selectedIds.forEach((cid) => bundles.disconnectCardParent(cid));
      return;
    }
    bundles.disconnectCardParent(cardId);
  }, [bundles]);

  const getSelectedSingleId = useCallback(() => {
    return [...selectedGroupIdsRef.current][0] || [...selectedCardIdsRef.current][0] || null;
  }, []);

  const handleShortcutEditTitle = useCallback(() => {
    const id = getSelectedSingleId();
    if (!id) return;
    const card = cardsRef.current.find((c) => c.id === id);
    if (card) {
      pieMenu.openPieMenu(card, window.innerWidth / 2, window.innerHeight / 2);
      return;
    }
    const group = groupsRef.current.find((g) => g.id === id);
    if (group) {
      pieMenu.openGroupPieMenu(group, window.innerWidth / 2, window.innerHeight / 2);
    }
  }, [getSelectedSingleId, pieMenu]);

  const handleShortcutClearTitle = useCallback(() => {
    const id = getSelectedSingleId();
    if (!id) return;
    pieMenu.handleConfirmPieTitle(id, null);
  }, [getSelectedSingleId, pieMenu]);

  const handleShortcutSetTime = useCallback(() => {
    const id = getSelectedSingleId();
    if (!id) return;
    const card = cardsRef.current.find((c) => c.id === id);
    if (card) {
      pieMenu.openPieMenu(card, window.innerWidth / 2, window.innerHeight / 2);
      return;
    }
    const group = groupsRef.current.find((g) => g.id === id);
    if (group) {
      pieMenu.openGroupPieMenu(group, window.innerWidth / 2, window.innerHeight / 2);
    }
  }, [getSelectedSingleId, pieMenu]);

  const handleShortcutSetNow = useCallback(() => {
    const id = getSelectedSingleId();
    if (!id) return;
    const now = getNowFormatted().formattedText;
    pieMenu.handleConfirmPieDate(id, now);
  }, [getSelectedSingleId, pieMenu]);

  const handleShortcutManageTags = useCallback(() => {
    const id = getSelectedSingleId();
    if (!id) return;
    const card = cardsRef.current.find((c) => c.id === id);
    if (card) {
      pieMenu.openPieMenu(card, window.innerWidth / 2, window.innerHeight / 2);
      return;
    }
    const group = groupsRef.current.find((g) => g.id === id);
    if (group) {
      pieMenu.openGroupPieMenu(group, window.innerWidth / 2, window.innerHeight / 2);
    }
  }, [getSelectedSingleId, pieMenu]);

  const handleShortcutDisconnectParent = useCallback(() => {
    const cardId = [...selectedCardIdsRef.current][0];
    if (cardId) {
      bundles.disconnectCardParent(cardId);
      return;
    }
    const groupId = [...selectedGroupIdsRef.current][0];
    if (groupId) {
      const group = groupsRef.current.find((g) => g.id === groupId && g.kind === 'bundle');
      const parentId = group?.parentIds?.[0];
      if (parentId) bundles.disconnectBundleParent(groupId, parentId);
    }
  }, [bundles]);

  const handleShortcutDetachFromBundle = useCallback(() => {
    const cardId = [...selectedCardIdsRef.current][0];
    if (cardId) bundles.detachCardFromBundle(cardId);
  }, [bundles]);

  const handleShortcutReparseLink = useCallback(() => {
    const cardId = [...selectedCardIdsRef.current].find((id) =>
      cardsRef.current.some((c) => c.id === id && c.type === 'web' && c.url));
    if (cardId) pieMenu.handleReparseLink(cardId);
  }, [pieMenu]);

  const handleShortcutImageOCR = useCallback(() => {
    const cardId = [...selectedCardIdsRef.current].find((id) =>
      cardsRef.current.some((c) => c.id === id && (c.type === 'image' || c.type === 'file')));
    if (cardId) pieMenu.handleRecognizeImage(cardId, 'ocr');
  }, [pieMenu]);

  const handleShortcutImageLink = useCallback(() => {
    const cardId = [...selectedCardIdsRef.current].find((id) =>
      cardsRef.current.some((c) => c.id === id && c.type === 'image'));
    if (cardId) pieMenu.handleRecognizeImage(cardId, 'link');
  }, [pieMenu]);

  const handleSaveDrop = useCallback(async (saveAs = false) => {
    if (savingDropRef.current) return;
    savingDropRef.current = true;
    setToast(null);
    try {
      await documentSaveRef.current?.(saveAs);
    } catch (error) {
      showToast(`保存失败: ${error instanceof Error ? error.message : '无法写入 .drop 文件'}`);
    } finally {
      savingDropRef.current = false;
    }
  }, [cardsRef, groupsRef, viewportRef, canvasPins.pins, showToast]);

  const handleLoadDrop = useCallback(async (choice?: DropOpenChoice, selectionId?: string) => {
    if (savingDropRef.current) return;
    savingDropRef.current = true;
    setToast(null);
    try {
      if (!selectionId) await flushWorkspaceDraft();
      const result = await openDropFile(choice, selectionId);
      if (!result.success) return;
      setCards(result.cards);
      setGroups(result.groups);
      clearSelection();
      acceptLoadedWorkspace(result.cards, result.groups, result.revision, result.workspace_id);
      if (result.viewport && typeof result.viewport.x === 'number' &&
        typeof result.viewport.y === 'number' && typeof result.viewport.zoom === 'number') {
        setViewport(result.viewport);
      } else {
        handleCanvasDoubleClick(result.cards, result.groups);
      }
      canvasPins.replacePins(Array.isArray(result.pins) ? result.pins : []);
      let maxZ = 10;
      result.cards.forEach((card) => {
        if (card.zIndex && card.zIndex > maxZ) maxZ = card.zIndex;
      });
      maxZIndexRef.current = maxZ + 1;
      showToast(`打开成功：${result.path}`);
      const loadedImages = new Map(result.cards.map((card) => [card.id, card.image]));
      void migrateRemoteImageCards(result.cards).then((updates) => {
        if (!updates.size) return;
        setCards((current) => {
          let changed = false;
          const next = current.map((card) => {
            const original = loadedImages.get(card.id);
            const update = updates.get(card.id);
            if (!update || card.image !== original) return card;
            changed = true;
            return { ...card, image: update.image, thumbnail: update.thumbnail };
          });
          if (changed) saveStateDebounced(next, result.groups);
          return changed ? next : current;
        });
      });
      if (result.progressive_task_id) {
        void hydrateProgressiveOpen(result.progressive_task_id, (update) => {
          setCards((current) => {
            let changed = false;
            const next = current.map((card) => {
              const recovery = card.recoveryMedia;
              if (!recovery) return card;
              const nextRecovery = { ...recovery };
              const nextCard = { ...card } as typeof card;
              let cardChanged = false;
              for (const field of ['image', 'thumbnail', 'favicon'] as const) {
                const detail = recovery[field];
                if (!detail || `/api/${detail.category || 'assets'}/${detail.name}` !== update.url.split('?')[0]) continue;
                if (update.ready) {
                  nextCard[field] = update.url;
                  delete nextRecovery[field];
                } else {
                  nextRecovery[field] = { ...detail, reason: update.reason || '图片读取失败' };
                }
                cardChanged = true;
              }
              if (!Object.keys(nextRecovery).length) delete nextCard.recoveryMedia;
              else nextCard.recoveryMedia = nextRecovery;
              changed ||= cardChanged;
              return cardChanged ? nextCard : card;
            });
            if (changed) saveStateDebounced(next, groupsRef.current);
            return changed ? next : current;
          });
        }).then((summary) => {
          if (summary.failed || summary.error) {
            showToast(summary.failed
              ? `文件已打开，但有 ${summary.failed} 张图片未能读取，已显示占位卡片。`
              : `图片加载中断：${summary.error}`);
          }
        }).catch((error) => showToast(`图片加载中断：${error instanceof Error ? error.message : '未知错误'}`));
      }
    } catch (error) {
      if (error instanceof DropRecoveryRequired) { setDropRecovery(error.offer); return; }
      if (choice) throw error;
      showToast(`打开失败: ${error instanceof Error ? error.message : '无法读取 .drop 文件'}`);
    } finally {
      savingDropRef.current = false;
    }
  }, [canvasPins, handleCanvasDoubleClick, clearSelection, setViewport, showToast]);

  const handleOpenDrop = useCallback(async () => {
    if (savingDropRef.current) return;
    savingDropRef.current = true;
    setToast(null);
    try {
      await openBoardWindow(true, flushWorkspaceJournal, '无法打开新画板，请允许浏览器弹出窗口', undefined, selectDropFile);
    } catch (error) {
      showToast(`打开失败: ${error instanceof Error ? error.message : '无法读取 .drop 文件'}`);
    } finally {
      savingDropRef.current = false;
    }
  }, [showToast]);

  const { isShiftPressedRef, isSpacePressedRef, isAltPressedRef } = useShortcuts({
    onNewCard: actions.handleNewCard,
    onDelete: actions.handleDeleteSelected,
    onUndo: actions.handleUndo,
    onGroup: actions.handleGroup,
    onBundle: bundles.createBundle,
    onUngroup: actions.handleUngroup,
    onResetSize: () => {
      const id = [...selectedGroupIdsRef.current].find((groupId) =>
        groupsRef.current.some((group) => group.id === groupId && group.kind === 'bundle'))
        || [...selectedCardIdsRef.current][0];
      if (id) resetObjectSize(id);
    },
    onAlign: actions.handleAlign,
    onSaveDrop: (saveAs) => { void handleSaveDrop(saveAs); },
    onPaste: handlePaste,
    onCopy: clipboard.handleCopy,
    onCut: clipboard.handleCut,
    hasCanvasMultiSelection: selectedCardIds.size + selectedGroupIds.size + selectedPinIds.size > 1,
    onDuplicate: clipboard.handleDuplicateSelected,
    onSearch: () => setIsSearchOpen(true),
    onMinimapOpen: minimap.handleMinimapOpen,
    onMinimapClose: minimap.handleMinimapClose,
    onEditTitle: handleShortcutEditTitle,
    onClearTitle: handleShortcutClearTitle,
    onSetTime: handleShortcutSetTime,
    onSetNow: handleShortcutSetNow,
    onManageTags: handleShortcutManageTags,
    onDisconnectParent: handleShortcutDisconnectParent,
    onDetachFromBundle: handleShortcutDetachFromBundle,
    onUniformWidth: actions.handleUniformCardWidth,
    onReparseLink: handleShortcutReparseLink,
    onRecognizeImageOCR: handleShortcutImageOCR,
    onRecognizeImageLink: handleShortcutImageLink,
    onFitCanvas: () => handleCanvasDoubleClick(canvasCards, fitGroups, originGeometries),
    onJumpToPin: canvasPins.jumpToPin,
    shortcutsConfig: settings.shortcuts,
    onOpenSettings: () => setIsSettingsOpen(true),
  });


  useEffect(() => {
    if (!clipboard.hasPendingPaste) return;
    let frame: number | null = null;
    let nextPosition = clipboard.pasteScreenPosition;
    const move = (event: MouseEvent) => {
      nextPosition = { x: event.clientX, y: event.clientY };
      if (frame !== null) return;
      frame = window.requestAnimationFrame(() => {
        clipboard.setPasteScreenPosition(nextPosition);
        frame = null;
      });
    };
    const cancel = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); clipboard.cancelPendingPaste(); }
    };
    window.addEventListener('mousemove', move, { passive: true });
    window.addEventListener('keydown', cancel);
    return () => {
      if (frame !== null) window.cancelAnimationFrame(frame);
      window.removeEventListener('mousemove', move);
      window.removeEventListener('keydown', cancel);
    };
  }, [clipboard.hasPendingPaste, clipboard.setPasteScreenPosition, clipboard.cancelPendingPaste]);

  const canvasInteractions = useCanvasInteractions({
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
    selectCard,
    selectGroup,
    beginMarqueeSelection,
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
    commitState: actions.commitState,
    pushHistory,
    showToast,
    onOpenPieMenu: pieMenu.openPieMenu,
    onOpenGroupPieMenu: pieMenu.openGroupPieMenu,
    onUpdatePieMenuPointer: pieMenu.updatePieMenuPointer,
    onReleasePieMenuMouseDown: pieMenu.releasePieMenuMouseDown,
  });

  const navigating = canvasInteractions.isPanning || canvasInteractions.isZooming || isWheelZooming || canvasPins.isAnimating;
  const canvasInteracting = navigating || canvasInteractions.isDragging;
  const [lodZoom, setLodZoom] = useState(viewport.zoom);
  const lodZoomTimerRef = useRef<number | null>(null);
  const tinyThumbnailStateRef = useRef(new Map<string, boolean>());

  // Commit LOD after the gesture settles. A pointer-up frame that mounts or
  // unmounts many image bodies competes with the final transform and decoding.
  useEffect(() => {
    if (lodZoomTimerRef.current !== null) window.clearTimeout(lodZoomTimerRef.current);
    lodZoomTimerRef.current = null;
    if (canvasInteracting) return;
    lodZoomTimerRef.current = window.setTimeout(() => {
      lodZoomTimerRef.current = null;
      setLodZoom(viewport.zoom);
    }, 180);
    return () => {
      if (lodZoomTimerRef.current !== null) window.clearTimeout(lodZoomTimerRef.current);
      lodZoomTimerRef.current = null;
    };
  }, [canvasInteracting, viewport.zoom]);

  const isTinyThumbnail = useCallback((card: Card) => {
    const projectedSize = Math.min(card.width, card.height) * lodZoom;
    const previous = tinyThumbnailStateRef.current.get(card.id);
    // Hysteresis prevents repeated full-body mount/unmount near the threshold.
    const tiny = previous === undefined
      ? projectedSize <= 20
      : previous ? projectedSize < 24 : projectedSize <= 18;
    tinyThumbnailStateRef.current.set(card.id, tiny);
    return tiny;
  }, [lodZoom]);

  // Let the transform commit at input priority. The spatial query and the
  // resulting card unmounts can follow at deferred priority after a pan or
  // zoom release, keeping the release frame free of a large reconciliation.
  const cullingViewport = useDeferredValue(viewport);
  const { visibleCards, visibleGroups, visibleCardIdSet } = useVirtualViewport({
    viewport: cullingViewport,
    cards: canvasCards,
    groups: displayGroups,
    membersByBundle,
    origins: originGeometries,
    selectedCardIds,
    selectedGroupIds,
    highlightedCardIds: parentHighlights.cardIds,
    highlightedGroupIds: parentHighlights.bundleIds,
    isInteracting: canvasInteracting,
    bufferPx: 300,
  });
  // Use the committed viewport zoom when a gesture has ended. LOD zoom is
  // intentionally delayed so image bodies do not churn during a gesture, but
  // delaying far-mode here would briefly mount every card at the minimum zoom
  // before the rasterized overview appears.
  const farModeZoom = canvasInteracting ? lodZoom : viewport.zoom;
  const visibleImageCount = useMemo(() => visibleCards.reduce((count, card) => count + Number(!!card.image), 0), [visibleCards]);
  const farModeRef = useRef(shouldUseRasterOverview(false, farModeZoom, visibleCards.length, visibleImageCount));
  if (!canvasInteracting) farModeRef.current = shouldUseRasterOverview(farModeRef.current, farModeZoom, visibleCards.length, visibleImageCount);
  const farMode = farModeRef.current;
  const farCanvasMounted = useRef(false);
  if (farMode) farCanvasMounted.current = true;
  const farDomCardIds = useMemo(() => new Set([...selectedCardIds, ...canvasInteractions.movingCardIds]),
    [selectedCardIds, canvasInteractions.movingCardIds]);
  const farDomGroupIds = useMemo(() => new Set([...selectedGroupIds, ...canvasInteractions.movingGroupIds]),
    [selectedGroupIds, canvasInteractions.movingGroupIds]);
  // A zoom-in release can still have the entire far-view candidate set until
  // deferred culling catches up. Do not mount that set for a single frame.
  const renderCards = useMemo(() => !farMode && !canvasInteracting && viewport.zoom > cullingViewport.zoom
    ? visibleCards.filter((card) => farDomCardIds.has(card.id) || parentHighlights.cardIds.has(card.id) ||
      farCardOnScreen(cardVisualBounds(card), viewport, window.innerWidth, window.innerHeight, 300))
    : visibleCards, [farMode, canvasInteracting, viewport, cullingViewport.zoom, visibleCards,
      farDomCardIds, parentHighlights.cardIds]);
  const { domCards, domCardIds, handoffActive } = useCanvasDomHandoff({ cards: renderCards,
    farMode, interacting: canvasInteracting, immediateIds: farDomCardIds, viewport });
  const rasterGroupIds = useMemo(() => farMode ? farDomGroupIds : new Set(visibleGroups.map(group => group.id)),
    [farMode, farDomGroupIds, visibleGroups]);

  const [promotedImageIds, setPromotedImageIds] = useState<Set<string>>(new Set());
  const MAX_PROMOTED_IMAGE_IDS = 64;
  const promotionTimerRef = useRef<number | null>(null);
  const promotionGenerationRef = useRef(0);
  const visibleImageIdsKey = useMemo(() => visibleCards.filter((card) => !!card.image).map((card) => card.id).join('|'), [visibleCards]);
  useEffect(() => {
    if (promotionTimerRef.current !== null) window.clearTimeout(promotionTimerRef.current);
    promotionTimerRef.current = null;
    promotionGenerationRef.current += 1;
    if (canvasInteracting || handoffActive) return;

    const generation = promotionGenerationRef.current;
    const centerX = (window.innerWidth / 2 - viewport.x) / Math.max(viewport.zoom, 0.01);
    const centerY = (window.innerHeight / 2 - viewport.y) / Math.max(viewport.zoom, 0.01);
    const candidates = visibleCards
      .filter((card) => card.image && !selectedCardIds.has(card.id) &&
        Math.min(card.width, card.height) * lodZoom > 24)
      .sort((a, b) => {
        const aDistance = Math.hypot(a.x + a.width / 2 - centerX, a.y + a.height / 2 - centerY);
        const bDistance = Math.hypot(b.x + b.width / 2 - centerX, b.y + b.height / 2 - centerY);
        return (b.width * b.height - a.width * a.height) * 0.15 + aDistance - bDistance;
      })
      .slice(0, 6);
    let index = 0;
    const promoteNext = () => {
      promotionTimerRef.current = null;
      if (generation !== promotionGenerationRef.current) return;
      const card = candidates[index++];
      if (!card) return;
      setPromotedImageIds((previous) => {
        if (previous.has(card.id)) return previous;
        const next = new Set(previous);
        next.add(card.id);
        while (next.size > MAX_PROMOTED_IMAGE_IDS) {
          const oldest = next.values().next().value;
          if (typeof oldest !== 'string') break;
          next.delete(oldest);
        }
        return next;
      });
      promotionTimerRef.current = window.setTimeout(promoteNext, 90);
    };
    promotionTimerRef.current = window.setTimeout(promoteNext, 220);
    return () => {
      if (promotionTimerRef.current !== null) window.clearTimeout(promotionTimerRef.current);
      promotionTimerRef.current = null;
    };
  }, [canvasInteracting, handoffActive, lodZoom, selectedCardIds, visibleImageIdsKey, viewport.x, viewport.y, viewport.zoom]);
  const bundleContentScales = useMemo(() => new Map(groups
    .filter((group) => group.kind === 'bundle')
    .map((group) => [group.id, (group.outlinePadding ?? 18) / 18])), [groups]);

  const { handleDrop } = useCanvasDrop({
    viewportRef,
    mouseWorldRef,
    cardsRef,
    groupsRef,
    createCardAtCursor: actions.createCardAtCursor,
    handleCardUpdate: actions.handleCardUpdate,
    handleDroppedData,
    showToast,
  });

  const { ready: workspaceReady, error: startupError, retry: retryStartup } = useCanvasInit({ setCards, setGroups, setViewport, maxZIndexRef, replacePins: canvasPins.replacePins });
  const captureInProgressRef = useRef(false);
  const beforeWorkspaceCapture = useCallback(() => {
    if (captureInProgressRef.current) return;
    captureInProgressRef.current = true;
    try {
      // Explicit save/close/pagehide must read the currently visible viewport.
      // Stop animation first, then let the save hooks observe the committed refs.
      flushSync(() => { canvasPins.stopAnimation(); flushWheelZoom(); });
    } finally { captureInProgressRef.current = false; }
  }, [canvasPins.stopAnimation, flushWheelZoom]);
  useWorkspaceDraft(workspaceReady, { cards, groups, viewport, pins: canvasPins.pins }, showToast, beforeWorkspaceCapture);
  const documentState = useDocumentState(workspaceReady, { cards, groups, viewport, pins: canvasPins.pins }, showToast, beforeWorkspaceCapture);
  documentSaveRef.current = documentState.save;

  const handleRestoreWorkspace = async (selection: RecoverySelection) => {
    if (savingDropRef.current) throw new Error('正在处理文件，请稍候');
    savingDropRef.current = true;
    try {
      await openBoardWindow(false, flushWorkspaceDraft, '无法打开新画板，请允许浏览器弹出窗口', async () => {
        const prepared = await workspaceRequest<{ task_id: string }>('/api/workspace/recovery/prepare', selection);
        return prepared.task_id;
      });
      showToast('已打开恢复画板，首次保存请选择文件位置。');
    } finally { savingDropRef.current = false; }
  };

  const handleTextEditStart = useCallback(() => pushHistory(cardsRef.current, groupsRef.current),
    [pushHistory, cardsRef, groupsRef]);

  const handleNewBoard = useCallback(() => {
    void openBoardWindow(false, flushWorkspaceJournal).catch((error) => showToast(`打开失败: ${error.message}`));
  }, [showToast]);

  const openingSelection = useRef<string | null>(null);
  useEffect(() => {
    if (!workspaceReady) return;
    const selection = getOpenSelectionRequest();
    if (selection && openingSelection.current !== selection) {
      openingSelection.current = selection;
      void handleLoadDrop(undefined, selection);
    } else if (consumeOpenFileRequest()) void handleLoadDrop();
  }, [workspaceReady, handleLoadDrop]);

  useEffect(() => {
    if (!workspaceReady || new URLSearchParams(location.search).get('startup') !== '1') return;
    let active = true;
    void workspaceRequest<{ records: import('./utils/workspaceApi').RecoveryRecord[] }>('/api/workspace/startup')
      .then(result => {
        if (!active) return;
        const url = new URL(location.href);
        url.searchParams.delete('startup');
        history.replaceState(history.state, '', url.href);
        if (result.records.length) setStartupRecords(result.records);
      }).catch(error => { if (active) showToast(`启动恢复检查失败：${error.message}，可从“文件 → 恢复”手动选择。`); });
    return () => { active = false; };
  }, [workspaceReady, showToast]);

  const handleCanvasCommand = useCallback((command: CanvasCommand) => {
    if (canvasMenuPosition) {
      mouseScreenRef.current = canvasMenuPosition;
      mouseWorldRef.current = {
        x: (canvasMenuPosition.x - viewportRef.current.x) / viewportRef.current.zoom,
        y: (canvasMenuPosition.y - viewportRef.current.y) / viewportRef.current.zoom,
      };
    }
    setCanvasMenuPosition(null);
    switch (command) {
      case 'note': actions.handleNewCard(); break;
      case 'parent': actions.handleCreateNewParentAtCursor(); break;
      case 'group': bundles.createBundle(); break;
      case 'search': setIsSearchOpen(true); break;
      case 'copy': void clipboard.handleCopy(); break;
      case 'cut': void clipboard.handleCut(); break;
      case 'paste': void pasteFromSystemClipboard(); break;
      case 'new-board': handleNewBoard(); break;
      case 'open': void handleOpenDrop(); break;
      case 'recover': setIsRecoveryOpen(true); break;
      case 'save': void handleSaveDrop(); break;
      case 'save-as': void handleSaveDrop(true); break;
      case 'pin':
        canvasPins.openPinPrompt(
          canvasMenuPosition || mouseScreenRef.current,
          mouseWorldRef.current
        );
        break;
      case 'uniform-width': actions.handleUniformCardWidth(); break;
      case 'reset-size': {
        const id = [...selectedGroupIdsRef.current].find((groupId) =>
          groupsRef.current.some((group) => group.id === groupId && group.kind === 'bundle'))
          || [...selectedCardIdsRef.current][0];
        if (id) resetObjectSize(id);
        break;
      }
      case 'ungroup':
      case 'detach':
      case 'disconnect': {
        pushHistory(cardsRef.current, groupsRef.current);
        const next = applyGroupMenuAction(command, cardsRef.current, groupsRef.current,
          selectedCardIdsRef.current, selectedGroupIdsRef.current);
        actions.commitState(next.cards, next.groups);
        const remaining = new Set(next.groups.map((group) => group.id));
        setSelectedGroupIds(new Set([...selectedGroupIdsRef.current].filter((id) => remaining.has(id))));
        break;
      }
      case 'ocr': handleShortcutImageOCR(); break;
      case 'link': handleShortcutImageLink(); break;
      case 'reparse': handleShortcutReparseLink(); break;
      case 'settings': setIsSettingsOpen(true); break;
    }
  }, [actions, bundles, canvasCards, canvasMenuPosition, canvasPins, clipboard, fitGroups, handleCanvasDoubleClick,
    handleNewBoard, handleOpenDrop, handleSaveDrop, mouseScreenRef, mouseWorldRef, pasteFromSystemClipboard, viewportRef,
    resetObjectSize, handleShortcutDetachFromBundle, handleShortcutDisconnectParent,
    handleShortcutImageOCR, handleShortcutImageLink, handleShortcutReparseLink, pushHistory, setSelectedGroupIds]);

  return (
    <div
      ref={containerRef}
      className={`relative w-screen h-screen overflow-hidden select-none bg-parchment text-ink ${
        canvasInteractions.isZooming ? 'cursor-ns-resize [&_*]:!cursor-ns-resize'
          : canvasInteractions.isPanning ? 'cursor-grabbing [&_*]:!cursor-grabbing' : 'cursor-default'
      }`}
      onWheel={(e) => {
        if ((e.target as HTMLElement).closest('[data-modal="settings"]')) return;
        handleWheel(e);
      }}
      onWheelCapture={(e) => {
        if ((e.target as HTMLElement).closest('[data-desktop-titlebar]')) return;
        if ((e.target as HTMLElement).closest('[data-modal="settings"]')) return;
        if ((e.target as HTMLElement).closest('textarea, input, [contenteditable="true"]')) {
          e.stopPropagation();
          return;
        }
        if ((e.target as HTMLElement).closest('[data-card-id], [data-group-id], [data-bundle-id]')) {
          e.stopPropagation();
          handleWheel(e);
        }
      }}
      onMouseDownCapture={(e) => {
        if ((e.target as HTMLElement).closest('[data-desktop-titlebar]')) return;
        if ((e.target as HTMLElement).closest('[data-modal="settings"]')) return;
        flushWheelZoom();
        if (clipboard.hasPendingPaste && e.button === 0 &&
          (e.target === e.currentTarget || (e.target as HTMLElement).closest('[data-canvas-surface]'))) {
          e.preventDefault();
          e.stopPropagation();
          suppressPasteClickRef.current = true;
          const target = { x: (e.clientX - viewportRef.current.x) / viewportRef.current.zoom,
            y: (e.clientY - viewportRef.current.y) / viewportRef.current.zoom };
          mouseWorldRef.current = target;
          clipboard.commitPendingPaste(target);
          return;
        }
        if (e.button === 2 && (e.target as HTMLElement).closest('[data-pin-id]')) {
          e.preventDefault();
          e.stopPropagation();
          return;
        }
        const object = (e.target as HTMLElement).closest('[data-card-id], [data-group-id], [data-bundle-id]');
        const editable = (e.target as HTMLElement).closest('textarea, input, [contenteditable="true"]');
        if (editable && !(e.button === 2 && object?.hasAttribute('data-card-id'))) return;
        const isOverlayUI = (e.target as HTMLElement).closest(
          '[data-modal], [data-dialog], [role="dialog"], button, select, input, textarea'
        );
        if (isOverlayUI && !object) return;
        if (e.button === 2) {
          e.preventDefault();
          e.stopPropagation();
          if (object) canvasInteractions.handleMouseDown(e);
          else {
            mouseScreenRef.current = { x: e.clientX, y: e.clientY };
            mouseWorldRef.current = { x: (e.clientX - viewportRef.current.x) / viewportRef.current.zoom,
              y: (e.clientY - viewportRef.current.y) / viewportRef.current.zoom };
            setCanvasMenuPosition({ x: e.clientX, y: e.clientY });
          }
          return;
        }
        if (!object) return;
        if (e.button === 1 || (e.button === 0 && (isSpacePressedRef.current || (e.altKey && !e.ctrlKey)))) {
          e.stopPropagation();
          canvasInteractions.handleMouseDown(e);
          return;
        }
        // Keep the control mounted while its own drag gesture is active.
        if ((e.target as HTMLElement).closest('[data-resize-handle]')) return;
        if (e.button === 0) {
          setPressedObject(object.getAttribute('data-card-id') || object.getAttribute('data-group-id') || object.getAttribute('data-bundle-id'));
        }
      }}
      onClickCapture={(e) => {
        if ((e.target as HTMLElement).closest('[data-desktop-titlebar]')) return;
        if ((e.target as HTMLElement).closest('[data-modal="settings"]')) return;
        if (!suppressPasteClickRef.current) return;
        suppressPasteClickRef.current = false;
        e.preventDefault();
        e.stopPropagation();
      }}
      onMouseDown={(e) => {
        if ((e.target as HTMLElement).closest('[data-desktop-titlebar]')) return;
        if ((e.target as HTMLElement).closest('[data-modal="settings"]')) return;
        canvasInteractions.handleMouseDown(e);
      }}
      onDoubleClick={(e) => {
        const target = e.target as HTMLElement;
        if (target.closest('[data-desktop-titlebar]')) return;
        if (target.closest('[data-modal="settings"]')) return;
        if (!target.closest('[data-card-id], [data-group-id], [data-bundle-id], [data-pin-id]')) {
          setIsSearchOpen(true);
        }
      }}
      onDragOver={(e) => {
        if ((e.target as HTMLElement).closest('[data-desktop-titlebar]')) { e.preventDefault(); return; }
        if ((e.target as HTMLElement).closest('[data-modal="settings"]')) return;
        e.preventDefault(); e.dataTransfer.dropEffect = 'copy';
      }}
      onDrop={(e) => {
        if ((e.target as HTMLElement).closest('[data-desktop-titlebar]')) { e.preventDefault(); return; }
        if ((e.target as HTMLElement).closest('[data-modal="settings"]')) return;
        handleDrop(e);
      }}
      onContextMenu={(e) => {
        e.preventDefault();
      }}
    >
      <DesktopWindowControls documentLabel={documentState.label} />
      <DocumentDecisionDialog decision={documentState.decision} />
      {dropRecovery && <DropRecoveryDialog key={dropRecovery.inspection_id} offer={dropRecovery}
        onClose={() => setDropRecovery(null)} onOriginal={handleLoadDrop} onOffer={setDropRecovery} />}
      {farCanvasMounted.current && <FarCanvas active={farMode || handoffActive} cards={renderCards} groups={visibleGroups} membersByBundle={membersByBundle} branchColors={branchColors}
        viewport={viewport} origins={originGeometries} interacting={canvasInteracting} domCardIds={domCardIds}
        handoffActive={handoffActive} movingCardIds={canvasInteractions.movingCardIds}
        domGroupIds={rasterGroupIds} subscribeViewportPreview={subscribeViewportPreview} />}
      <div
        ref={surfaceRef}
        data-canvas-surface
        className="absolute inset-0 origin-top-left pointer-events-auto"
        style={{
          transform: `translate(${viewport.x}px, ${viewport.y}px) scale(${viewport.zoom})`,
          willChange: navigating ? 'transform' : 'auto',
        }}
      >
        <CanvasPinsLayer
          pins={canvasPins.pins}
          selectedPinIds={selectedPinIds}
          onSelect={selectPin}
          onJump={canvasPins.jumpToPin}
          onRemove={canvasPins.removePin}
          onUpdatePosition={canvasPins.updatePinPosition}
          zoom={viewport.zoom}
        />
        <ParentLinkLines
          branchColors={branchColors}
          origins={originGeometries}
          groups={displayGroups}
          cards={cards}
          selectedGroupIds={selectedGroupIds}
          selectedCardIds={selectedCardIds}
          dragOverGroupId={dragOverGroupId}
          interactiveWire={canvasInteractions.interactiveWire}
          visibleCardIdSet={visibleCardIdSet}
          dragPreviewRef={canvasInteractions.dragPreviewRef}
          dragPreviewActive={canvasInteractions.isDragging}
        />

        {visibleGroups.filter((group) => group.kind === 'bundle' && (!farMode || farDomGroupIds.has(group.id))).map((group) => (
          <BundleGroupComponent
            handoffPending={handoffActive}
            branchColors={branchColors}
            key={group.id}
            group={group}
            members={membersByBundle.get(group.id) || []}
            accentColor={branchColors.get(group.id)}
            selected={selectedGroupIds.has(group.id) && pressedObject !== group.id}
            parentHighlighted={parentHighlights.bundleIds.has(group.id)}
            onDrag={(event) => canvasInteractions.handleStartGroupDrag(group, event)}
            onResize={(corner, event) => bundles.startBundleResize(group.id, corner, event)}
            onToggle={() => toggleBundleWithMotion(group.id)}
            onMemberToFront={(cardId) => bundles.bringMemberToFront(group.id, cardId)}
            onHoverCard={revealCollapsedCard}
          />
        ))}

        {visibleGroups.filter((group) => group.kind !== 'bundle' && (!farMode || farDomGroupIds.has(group.id))).map((group) => (
          <GroupComponent
            geometry={originGeometries.get(group.id)!}
            key={group.id}
            group={group}
            accentColor={branchColors.get(group.id)}
            isSelected={selectedGroupIds.has(group.id) && pressedObject !== group.id}
            childCount={originGeometries.get(group.id)!.cardCount}
            isDragOver={dragOverGroupId === group.id}
            onSelect={(e) => canvasInteractions.handleStartGroupDrag(group, e)}
            onRename={renameGroup}
            onUngroup={dissolveParent}
          />
        ))}

        {domCards.map((card) => (
            <CardComponent
              key={card.id}
              card={card}
              contentScale={card.bundleId ? bundleContentScales.get(card.bundleId) ?? 1 : 1}
              accentColor={branchColors.get(card.id)}
              isSelected={selectedCardIds.has(card.id)}
              isDragging={canvasInteractions.movingCardIds.has(card.id)}
              showSelectionControls={selectedCardIds.has(card.id) && pressedObject !== card.id}
              parentHighlighted={parentHighlights.cardIds.has(card.id)}
              onSelect={(e) => canvasInteractions.handleStartCardDrag(card, e)}
              onUpdate={actions.handleCardUpdate}
              onAutoSize={actions.handleCardTextEdit}
              onTextEdit={actions.handleCardTextEdit}
              onTextEditStart={handleTextEditStart}
              onDoubleClick={handleCardDoubleClick}
              onStartScale={(c, clientX) => canvasInteractions.handleStartCardScale(c, clientX)}
              onStartResize={(c, handle, e) => canvasInteractions.handleStartCardResize(c, handle, e)}
              isTinyThumbnail={!!card.bundleId && isTinyThumbnail(card)}
              // ImageCanvasLayer is intentionally not mounted, so keep image
              // cards on the DOM path even when they use thumbnails.
              useCanvasImage={false}
              highQualityImage={(selectedCardIds.has(card.id) || promotedImageIds.has(card.id)) &&
                (card.type === 'image' || card.type === 'web' || card.type === 'file') && !!card.image}
              crispRender={selectedCardIds.has(card.id)}
              onHoverStart={hoveredCollapsedCardId === card.id ? () => revealCollapsedCard(card.id) : undefined}
              onHoverEnd={hoveredCollapsedCardId === card.id ? () => revealCollapsedCard(null) : undefined}
              handoffPending={handoffActive}
            />
        ))}

        <SelectionBox box={selectionRect} />
        <SnapGuides lines={snapLines} />
      </div>

      <CanvasModals
        cards={cards}
        minimapCards={cards}
        groups={displayGroups}
        viewport={viewport}
        setViewport={setViewport}
        setSelectedCardIds={setSelectedCardIds}
        activePieMenu={pieMenu.activePieMenu}
        onConfirmPieDate={pieMenu.handleConfirmPieDate}
        onConfirmPieTitle={pieMenu.handleConfirmPieTitle}
        onTogglePieTag={pieMenu.handleTogglePieTag}
        onGroupColor={pieMenu.handleGroupColor}
        onReparseLink={pieMenu.handleReparseLink}
        onRecognizeImage={pieMenu.handleRecognizeImage}
        onSourceAction={pieMenu.handleSourceAction}
        onUngroupBundle={bundles.ungroupBundle}
        onResetObjectSize={resetObjectSize}
        onDissolveParent={dissolveParent}
        onDetachCardFromBundle={handleDetachCardFromBundle}
        onDisconnectCardParent={handleDisconnectCardParent}
        onDisconnectGroupParent={bundles.disconnectBundleParent}
        onClosePieMenu={pieMenu.closePieMenu}
        onUniformWidth={() => actions.handleUniformCardWidth(pieMenu.activePieMenu?.selectedCardIds)}
        onCanvasCommand={(command, target) => {
          const id = target.kind === 'card' ? target.card.id : target.group.id;
          if (['cut', 'copy', 'group'].includes(command)) {
            const alreadySelected = selectedCardIdsRef.current.has(id) || selectedGroupIdsRef.current.has(id);
            if (!alreadySelected) {
              setSelectedPinIds(new Set());
              selectedCardIdsRef.current = new Set(target.kind === 'card' ? [id] : []);
              selectedGroupIdsRef.current = new Set(target.kind === 'card' ? [] : [id]);
              setSelectedCardIds(selectedCardIdsRef.current);
              setSelectedGroupIds(selectedGroupIdsRef.current);
            }
          }
          mouseScreenRef.current = pieMenu.activePieMenu?.center || mouseScreenRef.current;
          mouseWorldRef.current = {
            x: (mouseScreenRef.current.x - viewportRef.current.x) / viewportRef.current.zoom,
            y: (mouseScreenRef.current.y - viewportRef.current.y) / viewportRef.current.zoom,
          };
          handleCanvasCommand(command);
        }}
        isSearchOpen={isSearchOpen}
        onCloseSearch={() => setIsSearchOpen(false)}
        onSelectSearchCard={(c) => {
          if (c.bundleId && collapsedIds.has(c.bundleId)) toggleBundleWithMotion(c.bundleId);
          selectCard(c.id, false);
          setViewport(computeCardFocusViewport(c, window.innerWidth, window.innerHeight));
        }}
        isMinimapExpanded={minimap.isMinimapExpanded}
        showCornerMinimap={settings.general.minimapMode === 'always'}
        isCanvasInteracting={canvasInteracting}
        subscribeViewportPreview={subscribeViewportPreview}
      />
      {clipboard.pendingPaste && <ClipboardPastePreview snapshot={clipboard.pendingPaste}
        screen={clipboard.pasteScreenPosition} zoom={viewport.zoom} />}
      {canvasMenuPosition && <CanvasCommandMenu position={canvasMenuPosition}
        canCopy={selectedCardIds.size > 0 || selectedGroupIds.size > 0 || selectedPinIds.size > 0}
        canGroup={selectedCardIds.size > 0}
        canUngroup={selectedGroupIds.size > 0}
        canResetSize={selectedCardIds.size > 0 || groups.some((group) => selectedGroupIds.has(group.id) && group.kind === 'bundle')}
        canDetach={cards.some((card) => selectedCardIds.has(card.id) && !!card.bundleId)}
        canDisconnect={cards.some((card) => selectedCardIds.has(card.id) && !!card.groupId)
          || groups.some((group) => selectedGroupIds.has(group.id) && !!group.parentIds?.length)}
        canUniformWidth={cards.length > 1}
        onCommand={handleCanvasCommand}
        onClose={() => setCanvasMenuPosition(null)} />}
      {canvasPins.pinPrompt && (
        <PinInputModal
          prompt={canvasPins.pinPrompt}
          existingPins={canvasPins.pins}
          onConfirm={(num) => canvasPins.addOrUpdatePin(num, canvasPins.pinPrompt!.world, viewport.zoom)}
          onClose={canvasPins.closePinPrompt}
        />
      )}
      <SettingsModal
        isOpen={isSettingsOpen}
        onClose={() => setIsSettingsOpen(false)}
        settings={settings}
        onUpdateShortcuts={updateShortcuts}
        onUpdateGeneral={updateGeneral}
        onResetShortcuts={resetShortcuts}
        onRestoreWorkspace={handleRestoreWorkspace}
        showToast={showToast}
      />
      {isRecoveryOpen && <RecoveryPanel onClose={() => setIsRecoveryOpen(false)} onRestore={handleRestoreWorkspace} />}
      {startupRecords && <RecoveryPanel initialRecords={startupRecords} onClose={() => setStartupRecords(null)}
        onRestore={handleRestoreWorkspace} onOpenFile={() => { setStartupRecords(null); void handleOpenDrop(); }} />}
      {startupError && <div role="alertdialog" aria-modal="true" data-interactive="true"
        className="fixed inset-0 z-[180] bg-ink/30 flex items-center justify-center p-6">
        <div className="border-2 border-ink bg-paper p-6 max-w-[600px] text-[13px]">
          <div className="mb-3 whitespace-pre-wrap">{startupError}</div>
          <button className="border border-ink px-3 py-1 mr-2" onClick={retryStartup}>重试恢复</button>
          <button className="border border-ink px-3 py-1" onClick={() => { completeRecoveryRequest(); retryStartup(); }}>取消恢复</button>
        </div>
      </div>}
      {toast && <div role="status" aria-live="polite"
        className="fixed bottom-6 left-1/2 z-[160] max-w-[min(90vw,640px)] -translate-x-1/2 border border-ink bg-paper px-4 py-3 text-center text-xs text-ink shadow-xl whitespace-pre-line break-words pointer-events-none">
        {toast}
      </div>}
    </div>
  );
}
