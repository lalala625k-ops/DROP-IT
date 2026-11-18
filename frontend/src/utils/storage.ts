import { Card, Group, Viewport } from '../types';
import type { CanvasPin } from '../hooks/useCanvasPins';
import { restorePendingImages } from './pendingImages';
import { browserBoardId, getWorkspaceId, setWorkspaceId, workspaceRequest, workspaceUrl, LoadedWorkspace, workspaceWritesSuspended } from './workspaceApi';
import { readWorkspaceCache, writeWorkspaceCache, sameWorkspaceObjects, clearWorkspaceCache } from './workspaceCache';
import { getRecoveryRequest, completeRecoveryRequest, completeOpenSelectionRequest } from './boardWindows';
import { DropRecoveryRequired } from './dropRecovery';

export const STORAGE_KEY = 'pinboard_cards_v1';
const boardParams = new URLSearchParams(window.location.search);
const NEW_BOARD_MODE = boardParams.get('new-board') === '1';
const DESKTOP_MODE = boardParams.get('desktop') === '1';
const boardId = boardParams.get('board-id');
// A new board is intentionally isolated from the current workspace in both
// browser and desktop windows. It keeps its own localStorage key and must not
// overwrite the shared SQLite board while the second window is open.
const IS_EPHEMERAL_BROWSER_BOARD = !!browserBoardId;
const BOARD_STORAGE_KEY = NEW_BOARD_MODE && boardId
  ? `${STORAGE_KEY}_${boardId}` : STORAGE_KEY;
const TEMPLATE_MARKER = 'pinboard_project_template_loaded_v1';
const RELEASE_EMPTY = (import.meta as ImportMeta & { env?: { VITE_RELEASE_EMPTY?: string } })
  .env?.VITE_RELEASE_EMPTY === '1';

/**
 * The first empty workspace is a small, editable example file.  It replaces
 * the old tutorial flow while keeping the same canvas primitives users will
 * use for their own notes.
 */
export const INITIAL_GUIDE_CARDS: Card[] = [
  { id: 'guide-canvas-1', type: 'text', x: -520, y: -190, width: 230, height: 112, zIndex: 1, bundleId: 'guide-canvas', content: '画布漫游\n中键 / 右键拖动，或按住 Space + 左键。滚轮以光标为中心缩放。' },
  { id: 'guide-canvas-2', type: 'text', x: -265, y: -190, width: 230, height: 112, zIndex: 2, bundleId: 'guide-canvas', content: '快速摄入\nCtrl + V 粘贴图片、网页或文本；Ctrl + N 新建便签。' },
  { id: 'guide-canvas-3', type: 'text', x: -520, y: -45, width: 230, height: 112, zIndex: 3, bundleId: 'guide-canvas', content: '框选与编辑\n空白处拖拽框选，双击卡片进入编辑，完成后自动收起。' },

  { id: 'guide-organize-1', type: 'text', x: 115, y: -190, width: 230, height: 112, zIndex: 4, bundleId: 'guide-organize', content: '分组\n多选卡片后按 Ctrl + G，生成可折叠的 Group。' },
  { id: 'guide-organize-2', type: 'text', x: 370, y: -190, width: 230, height: 112, zIndex: 5, bundleId: 'guide-organize', content: '连接\n拖动连接点，把卡片或 Group 接到另一个节点。' },
  { id: 'guide-organize-3', type: 'text', x: 115, y: -45, width: 230, height: 112, zIndex: 6, bundleId: 'guide-organize', content: '原点\nCtrl + J 创建原点；它可以承载多个功能分组。' },

  { id: 'guide-layout-1', type: 'text', x: -520, y: 245, width: 230, height: 112, zIndex: 7, bundleId: 'guide-layout', content: '排版\nCtrl + 方向键按边缘对齐。' },
  { id: 'guide-layout-2', type: 'text', x: -265, y: 245, width: 230, height: 112, zIndex: 8, bundleId: 'guide-layout', content: '导航\n图钉支持 Ctrl + 1~8 快速跳转；小地图用于定位。' },

  { id: 'guide-settings-1', type: 'text', x: 115, y: 245, width: 230, height: 112, zIndex: 9, bundleId: 'guide-settings', content: '设置\n打开设置面板调整快捷键、外观和画布行为。' },
  { id: 'guide-settings-2', type: 'text', x: 370, y: 245, width: 230, height: 112, zIndex: 10, bundleId: 'guide-settings', content: '存储\nCtrl + S 保存 .drop 文件；Ctrl + Shift + S 存为，选择文件位置与名称。' },
];

export const INITIAL_GUIDE_GROUPS: Group[] = [
  { id: 'guide-dropit', title: 'DROP-IT', kind: 'parent', x: -35, y: 35, width: 140, height: 140, color: '#FACB0E', zIndex: 100 },
  { id: 'guide-canvas', title: '画布与摄入', kind: 'bundle', x: -545, y: -220, width: 540, height: 420, parentIds: ['guide-dropit'], outlinePadding: 18, zIndex: 20 },
  { id: 'guide-organize', title: '分组与连接', kind: 'bundle', x: 90, y: -220, width: 540, height: 420, parentIds: ['guide-dropit'], outlinePadding: 18, zIndex: 21 },
  { id: 'guide-layout', title: '排版与导航', kind: 'bundle', x: -545, y: 215, width: 540, height: 220, parentIds: ['guide-dropit'], outlinePadding: 18, zIndex: 22 },
  { id: 'guide-settings', title: '设置与归档', kind: 'bundle', x: 90, y: 215, width: 540, height: 220, parentIds: ['guide-dropit'], outlinePadding: 18, zIndex: 23 },
];

let debounceTimer: number | null = null;
let pendingState: { cards: Card[]; groups: Group[]; revision: number } | null = null;
let lastRevision = 0;
let syncQueue: Promise<void> = Promise.resolve();
let serverRevision = 0;
let syncedCards: Card[] = [];
let syncedGroups: Group[] = [];
let conflict = false;
// Card and group objects are kept immutable by the React state updates. Cache
// their serialized form by object identity so a small edit does not stringify
// every large image payload again during incremental sync.
const serializedObjectCache = new WeakMap<object, string>();

interface StoredData {
  cards: Card[];
  groups: Group[];
  revision?: number;
  pendingSync?: boolean;
  baseServerRevision?: number;
}

function withoutParsingState(cards: Card[]): Card[] {
  if (!cards.some((card) => card.isParsing !== undefined)) return cards;
  return cards.map((card) => {
    if (card.isParsing === undefined) return card;
    const { isParsing: _isParsing, ...persisted } = card;
    return persisted;
  });
}

function serializedObject(value: object): string {
  const cached = serializedObjectCache.get(value);
  if (cached !== undefined) return cached;
  const serialized = JSON.stringify(value);
  serializedObjectCache.set(value, serialized);
  return serialized;
}

export function getLocalData(): StoredData | null {
  try {
    const raw = localStorage.getItem(BOARD_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      return { cards: withoutParsingState(parsed), groups: [] };
    }
    return {
      cards: Array.isArray(parsed.cards) ? withoutParsingState(parsed.cards) : [],
      groups: Array.isArray(parsed.groups) ? parsed.groups : [],
      revision: typeof parsed.revision === 'number' ? parsed.revision : undefined,
      pendingSync: parsed.pendingSync === true,
      baseServerRevision: typeof parsed.baseServerRevision === 'number' ? parsed.baseServerRevision : undefined,
    };
  } catch (e) {
    console.error('Failed to read localStorage:', e);
    return null;
  }
}

export function writeLocalData(cards: Card[], groups: Group[], revision?: number, pendingSync = false, baseRevision = serverRevision) {
  const persistedCards = withoutParsingState(cards);
  const data = { cards: persistedCards, groups, revision, pendingSync, baseServerRevision: baseRevision };
  try {
    localStorage.setItem(BOARD_STORAGE_KEY, JSON.stringify(data));
  } catch (e) {
    try {
      // Strip large Base64 images for LocalStorage backup only so metadata is never lost
      const slimCards = persistedCards.map((c) => {
        if (c.image && c.image.startsWith('data:image/') && c.image.length > 50000) {
          return { ...c, image: undefined };
        }
        return c;
      });
      localStorage.setItem(BOARD_STORAGE_KEY, JSON.stringify({ ...data, cards: slimCards }));
    } catch {
      console.warn('LocalStorage quota exceeded; local backup could not be updated.');
    }
  }
}

export function syncToBackend(cards: Card[], groups: Group[], revision?: number): Promise<boolean> {
  if (IS_EPHEMERAL_BROWSER_BOARD) return Promise.resolve(true);
  // Serialize writes and send only changed objects. Never overwrite an unknown revision.
  const operation = syncQueue.then(async () => {
    if (workspaceWritesSuspended()) return false;
    if (conflict) return false;
    try {
      const oldCards = new Map(syncedCards.map((item) => [item.id, serializedObject(item)]));
      const oldGroups = new Map(syncedGroups.map((item) => [item.id, serializedObject(item)]));
      const nextCards = withoutParsingState(cards);
      const nextCardIds = new Set(nextCards.map((item) => item.id));
      const nextGroupIds = new Set(groups.map((item) => item.id));
      const upsertCards = nextCards.filter((item) => oldCards.get(item.id) !== serializedObject(item));
      const upsertGroups = groups.filter((item) => oldGroups.get(item.id) !== serializedObject(item));
      const deleteCardIds = syncedCards.filter((item) => !nextCardIds.has(item.id)).map((item) => item.id);
      const deleteGroupIds = syncedGroups.filter((item) => !nextGroupIds.has(item.id)).map((item) => item.id);
      if (!upsertCards.length && !upsertGroups.length && !deleteCardIds.length && !deleteGroupIds.length) {
        const local = getLocalData();
        if (local?.pendingSync && local.revision === revision) writeLocalData(local.cards, local.groups, revision, false);
        return true;
      }
      const response = await fetch(workspaceUrl('/api/cards/changes'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          baseRevision: serverRevision,
          upsertCards, upsertGroups, deleteCardIds, deleteGroupIds,
        }),
      });
      if (response.status === 409) {
        conflict = true;
        window.dispatchEvent(new Event('pinboard-sync-conflict'));
        return false;
      }
      if (!response.ok) return false;
      const result = await response.json();
      serverRevision = result.revision;
      syncedCards = nextCards;
      syncedGroups = groups;
      const cache = readWorkspaceCache();
      if (cache?.workspace_id === getWorkspaceId()) {
        writeWorkspaceCache({ ...cache, database_revision: serverRevision });
      }
      const local = getLocalData();
      if (local?.pendingSync && local.revision === revision) {
        writeLocalData(local.cards, local.groups, revision, false);
      }
      return true;
    } catch {
      // Keep the local pending flag so the next load retries this state.
      return false;
    }
  });
  // Keep the queue usable after a failed request, while allowing this caller
  // to distinguish its own result from newer edits that arrive concurrently.
  syncQueue = operation.then(() => undefined, () => undefined);
  return operation;
}

export function saveStateDebounced(cards: Card[], groups: Group[], delay = 400) {
  if (workspaceWritesSuspended()) return;
  const revision = Math.max(Date.now(), lastRevision + 1);
  lastRevision = revision;
  pendingState = { cards, groups, revision };
  writeLocalData(cards, groups, revision, true);

  if (debounceTimer) {
    clearTimeout(debounceTimer);
  }

  debounceTimer = window.setTimeout(() => {
    if (pendingState) {
      syncToBackend(pendingState.cards, pendingState.groups, pendingState.revision);
      pendingState = null;
    }
    debounceTimer = null;
  }, delay);
}

type DropSaveResult = { success: true; path: string; filename: string }
  | { success: false; cancelled: true };

export class DocumentConflict extends Error {
  constructor(public stamp: Record<string, unknown> | null, public missing = false) { super('文件已在外部修改'); }
}

export async function settleObjectWrites() {
  if (debounceTimer) window.clearTimeout(debounceTimer);
  debounceTimer = null; pendingState = null;
  await syncQueue;
}

export function clearDiscardedCache() {
  localStorage.removeItem(BOARD_STORAGE_KEY);
  const board = new URLSearchParams(location.search).get('board-id');
  for (const key of ['pinboard_viewport_v1', 'pinboard_canvas_pins_v1']) {
    localStorage.removeItem(`${key}${board ? `_${board}` : ''}`);
  }
  clearWorkspaceCache();
}

export type DropOpenResult = {
  success: true;
  path: string;
  filename: string;
  cards: Card[];
  groups: Group[];
  viewport?: { x: number; y: number; zoom: number } | null;
  pins?: CanvasPin[];
  revision?: number;
  workspace_id?: string;
  progressive_task_id?: string;
} | { success: false; cancelled: true };

export interface ProgressiveOpenUpdate { url: string; ready: boolean; reason?: string; }

/** Poll the metadata-first open task and yield each image as it is published. */
export async function hydrateProgressiveOpen(
  taskId: string,
  onUpdate: (update: ProgressiveOpenUpdate) => void,
): Promise<{ failed: number; total: number; error?: string }> {
  let cursor = 0;
  for (;;) {
    const response = await fetch(workspaceUrl(`/api/storage/open-progress/${taskId}?cursor=${cursor}`));
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(result.detail || `图片加载服务返回异常（HTTP ${response.status}）`);
    for (const update of Array.isArray(result.updates) ? result.updates : []) onUpdate(update);
    cursor = typeof result.next_cursor === 'number' ? result.next_cursor : cursor;
    if (result.status === 'complete' || result.status === 'failed') {
      return { failed: Number(result.failed) || 0, total: Number(result.total) || 0, error: result.error };
    }
    await new Promise(resolve => window.setTimeout(resolve, 80));
  }
}

export async function saveDropFile(
  cards: Card[],
  groups: Group[],
  viewport?: { x: number; y: number; zoom: number },
  pins?: unknown[],
  saveAs = false,
  overwriteStamp?: Record<string, unknown>,
): Promise<DropSaveResult> {
  const payload = {
    cards: withoutParsingState(cards),
    groups,
    viewport,
    pins,
    save_as: saveAs,
    overwrite_stamp: overwriteStamp,
  };

  let response: Response;
  try {
    response = await fetch(workspaceUrl('/api/storage/save'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
  } catch (error) {
    throw new Error(error instanceof Error ? `无法连接保存服务：${error.message}` : '无法连接保存服务');
  }

  const data = await response.json().catch(() => ({}));
  if (response.status === 409 && data.detail?.code === 'external_changed') {
    throw new DocumentConflict(data.detail.stamp || null, data.detail.missing === true);
  }
  if (response.ok && data.cancelled) return { success: false, cancelled: true };
  // A download request cannot confirm where a file was written. Only the
  // backend's completed disk write may produce a save-success notification.
  if (response.ok && data.success && typeof data.path === 'string' && data.path) {
    return data as { success: true; path: string; filename: string };
  }
  if (response.status === 404 || response.status === 405) {
    throw new Error('保存服务需要更新，请重新启动应用');
  }
  throw new Error(typeof data.detail === 'string'
    ? data.detail
    : `保存服务返回异常（HTTP ${response.status}）`);
}

export async function selectDropFile(): Promise<string | null> {
  const result = await workspaceRequest<{ selection_id?: string; cancelled?: boolean }>('/api/storage/select-open', {});
  if (result.cancelled) return null;
  if (!result.selection_id) throw new Error('文件选择服务需要更新，请完整重启应用');
  return result.selection_id;
}

export async function openDropFile(choice?: import('./dropRecovery').DropOpenChoice, selectionId?: string): Promise<DropOpenResult> {
  let response: Response;
  try {
    const requestBody = choice ? choice : { ...(selectionId ? { selection_id: selectionId } : {}), progressive: true };
    response = await fetch(workspaceUrl('/api/storage/open'), { method: 'POST',
      headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(requestBody) });
  } catch (error) {
    throw new Error(error instanceof Error ? `无法连接打开服务：${error.message}` : '无法连接打开服务');
  }
  const data = await response.json().catch(() => ({}));
  if (response.status === 409 && data.detail?.code === 'recovery_required') {
    if (selectionId) completeOpenSelectionRequest();
    throw new DropRecoveryRequired(data.detail);
  }
  if (response.ok && data.cancelled) return { success: false, cancelled: true };
  if (response.ok && data.success && Array.isArray(data.cards) && Array.isArray(data.groups)) {
    if (selectionId) completeOpenSelectionRequest();
    return data as DropOpenResult & { success: true };
  }
  if (response.status === 404 || response.status === 405) {
    throw new Error('打开服务需要更新，请重新启动应用');
  }
  throw new Error(typeof data.detail === 'string'
    ? data.detail
    : `打开服务返回异常（HTTP ${response.status}）`);
}

/** Adopt a workspace returned by the native open dialog for subsequent saves. */
export function acceptLoadedWorkspace(cards: Card[], groups: Group[], revision?: number, workspaceId?: string) {
  if (debounceTimer) window.clearTimeout(debounceTimer);
  debounceTimer = null;
  pendingState = null;
  if (workspaceId) setWorkspaceId(workspaceId);
  syncedCards = withoutParsingState(cards);
  syncedGroups = groups;
  serverRevision = typeof revision === 'number' ? revision : serverRevision;
  lastRevision = Math.max(lastRevision, serverRevision);
  conflict = false;
  writeLocalData(cards, groups);
}

export function flushStoredCards() {
  if (pendingState) {
    // The local pending snapshot is durable and will retry on next launch.
    pendingState = null;
  }
}

export async function flushWorkspaceSync(cards: Card[], groups: Group[]) {
  if (IS_EPHEMERAL_BROWSER_BOARD) return;
  if (debounceTimer) window.clearTimeout(debounceTimer);
  debounceTimer = null;
  pendingState = null;
  const revision = Math.max(Date.now(), lastRevision + 1);
  lastRevision = revision;
  writeLocalData(cards, groups, revision, true);
  const synced = await syncToBackend(cards, groups, revision);
  if (!synced || conflict) throw new Error('工作区同步未完成，本地修改仍保留');
}

export async function loadInitialData(): Promise<{ cards: Card[]; groups: Group[]; viewport?: Viewport; pins?: CanvasPin[] }> {
  const recoveryJob = getRecoveryRequest();
  if (recoveryJob) {
    const loaded = await workspaceRequest<LoadedWorkspace>('/api/workspace/recovery/apply', { task_id: recoveryJob });
    acceptLoadedWorkspace(loaded.cards, loaded.groups, loaded.revision, loaded.workspace_id);
    writeWorkspaceCache({ ...loaded, client_revision: 0, database_revision: loaded.revision, pending_draft: false });
    completeRecoveryRequest();
    return { ...loaded, viewport: loaded.viewport || undefined };
  }
  let local = getLocalData();
  let serverData: LoadedWorkspace | null = null;
  try {
    serverData = await workspaceRequest<LoadedWorkspace>('/api/workspace/current');
    setWorkspaceId(serverData.workspace_id);
  } catch { /* server offline */ }
  if (serverData) {
    serverRevision = serverData.revision || 0;
    syncedCards = withoutParsingState(serverData.cards || []);
    syncedGroups = serverData.groups || [];
    conflict = false;
  }
  const cache = readWorkspaceCache();
  if (serverData && cache && cache.workspace_id !== serverData.workspace_id) local = null;
  if (cache?.pending_draft && (!serverData || cache.workspace_id === serverData.workspace_id)) {
    setWorkspaceId(cache.workspace_id);
    const cards = await restorePendingImages(cache.cards);
    const ownCheckpoint = serverData?.draft_client_revision === cache.client_revision;
    const acknowledged = serverData && sameWorkspaceObjects({ ...cache, cards }, serverData);
    if (ownCheckpoint || acknowledged) writeLocalData(cards, cache.groups, cache.client_revision, false);
    if (serverData && cache.database_revision !== serverRevision && local?.pendingSync && !ownCheckpoint && !acknowledged) {
      conflict = true;
      window.setTimeout(() => window.dispatchEvent(new Event('pinboard-sync-conflict')), 0);
    }
    return { cards, groups: cache.groups, viewport: cache.viewport || undefined, pins: cache.pins };
  }
  if (local?.pendingSync) {
    lastRevision = Math.max(lastRevision, local.revision || 0);
    const cards = await restorePendingImages(local.cards);
    if (cards.some((card, index) => card.image !== local.cards[index].image)) {
      writeLocalData(cards, local.groups, local.revision, true, local.baseServerRevision ?? 0);
    }
    if (serverData && sameWorkspaceObjects({ cards, groups: local.groups, pins: [] }, serverData)) {
      writeLocalData(cards, local.groups, local.revision, false);
    } else if (serverData && (local.baseServerRevision ?? 0) === serverRevision) {
      void syncToBackend(cards, local.groups, local.revision);
    } else if (serverData) {
      conflict = true;
      window.setTimeout(() => window.dispatchEvent(new Event('pinboard-sync-conflict')), 0);
    }
    return { cards, groups: local.groups, viewport: cache?.viewport || serverData?.viewport || undefined,
      pins: cache?.pins || serverData?.pins || [] };
  }

  if (NEW_BOARD_MODE && !serverData?.initialized) return { cards: [], groups: [], pins: [] };

  // No unsynced local edits: load the server's current state.
  try {
    if (serverData) {
      const data = serverData;
      const serverCards = withoutParsingState(Array.isArray(data.cards) ? data.cards : (Array.isArray(data) ? data : []));
      const cards = await restorePendingImages(serverCards);
      const groups = Array.isArray(data.groups) ? data.groups : [];
      if (data.initialized || cards.length > 0 || groups.length > 0) {
        if (cards.some((card, index) => card.image !== serverCards[index].image)) {
          const revision = Math.max(Date.now(), lastRevision + 1);
          lastRevision = revision;
          writeLocalData(cards, groups, revision, true);
          void syncToBackend(cards, groups, revision);
        } else writeLocalData(cards, groups);
        return { cards, groups, viewport: data.viewport || undefined, pins: data.pins || [] };
      }
    }
  } catch (e) {
    // 后端不可用或离线
  }

  // 2. 降级读取 LocalStorage
  if (cache && (!serverData || cache.workspace_id === serverData.workspace_id)) {
    setWorkspaceId(cache.workspace_id);
    return { cards: await restorePendingImages(cache.cards), groups: cache.groups,
      viewport: cache.viewport || undefined, pins: cache.pins };
  }
  if (local && (local.cards.length > 0 || local.groups.length > 0)) {
    return { cards: await restorePendingImages(local.cards), groups: local.groups, pins: serverData?.pins || [] };
  }

  // If the database is empty, recover the last explicit .drop save before
  // showing the built-in first-run example.
  try {
      const dropResponse = await fetch(workspaceUrl('/api/storage/load'));
      if (dropResponse.ok) {
        const drop = await dropResponse.json();
        if (drop.success && drop.is_template && localStorage.getItem(TEMPLATE_MARKER) === '1') {
          return { cards: [], groups: [] };
        }
        if (drop.success && (drop.cards?.length > 0 || drop.groups?.length > 0)) {
          if (drop.is_template) localStorage.setItem(TEMPLATE_MARKER, '1');
          const cards = await restorePendingImages(drop.cards || []);
          const groups = drop.groups || [];
          // Keep the first-run example after refresh, including before the
          // initial backend write finishes.
          saveStateDebounced(cards, groups);
          return { cards, groups, viewport: drop.viewport, pins: Array.isArray(drop.pins) ? drop.pins : [] };
        }
      }
  } catch { /* storage endpoint unavailable */ }

  // 3. 两者均为空时，加载可编辑的 DROP-IT 示例画布
  return RELEASE_EMPTY || DESKTOP_MODE
    ? { cards: [], groups: [] }
    : { cards: INITIAL_GUIDE_CARDS, groups: INITIAL_GUIDE_GROUPS };
}

export async function getRemoteRevision(): Promise<number | null> {
  if (IS_EPHEMERAL_BROWSER_BOARD) return null;
  try {
    const response = await fetch(workspaceUrl('/api/cards/revision'));
    return response.ok ? (await response.json()).revision : null;
  } catch { return null; }
}

export function currentServerRevision() { return serverRevision; }

/** Accept a revision assigned by a full workspace checkpoint. */
export function acknowledgeServerRevision(revision?: number) {
  if (typeof revision === 'number' && Number.isFinite(revision)) {
    serverRevision = Math.max(serverRevision, revision);
    lastRevision = Math.max(lastRevision, serverRevision);
  }
}
