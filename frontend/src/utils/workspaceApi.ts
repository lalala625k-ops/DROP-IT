import type { Card, Group, Viewport } from '../types';
import type { CanvasPin } from '../hooks/useCanvasPins';

const params = new URLSearchParams(typeof location === 'undefined' ? '' : location.search);
export const browserBoardId = params.get('new-board') === '1' && params.get('desktop') !== '1'
  ? params.get('board-id') : null;
export const workspaceUrl = (path: string) => {
  if (!browserBoardId) return path;
  const [base, fragment] = path.split('#');
  const [pathname, query] = base.split('?');
  const values = new URLSearchParams(query);
  values.set('board_id', browserBoardId);
  return `${pathname}?${values}${fragment === undefined ? '' : `#${fragment}`}`;
};

export interface WorkspaceState { cards: Card[]; groups: Group[]; viewport?: Viewport | null; pins: CanvasPin[] }
export interface LoadedWorkspace extends WorkspaceState {
  success: boolean; workspace_id: string; revision: number; source_path?: string | null; initialized?: boolean;
  draft_client_revision?: number | null;
}
export interface FileSettings {
  close_behavior: 'ask' | 'save' | 'discard';
  save_dir: string; temp_dir: string; autosave_enabled: boolean; idle_seconds: number;
  max_seconds: number; retention_count: number; defaults: Omit<FileSettings, 'defaults' | 'migration_error'>;
  migration_error?: string;
}
export interface RecoveryRecord {
  record_id: string; workspace_id: string; snapshot_id: string; saved_at?: string | null; name: string;
  source_path?: string; draft_path: string; resource_dir?: string; card_count: number;
  group_count: number; origin_count: number; pin_count: number;
  status: 'unchecked' | 'complete' | 'partial' | 'unrecoverable'; reason?: string;
  issues: { url: string; digest?: string; reason: string; objects: { id: string; title: string }[] }[];
}
export interface RecoverySelection { record_id: string; resource_dir?: string; allow_missing: boolean }
let activeWorkspaceId = '';
export const getWorkspaceId = () => activeWorkspaceId;
export const setWorkspaceId = (id: string) => { activeWorkspaceId = id; };

export async function workspaceRequest<T>(path: string, body?: unknown, method = 'POST'): Promise<T> {
  const response = await fetch(workspaceUrl(path), body === undefined ? undefined : {
    method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(result.detail || `服务返回异常（HTTP ${response.status}）`);
  return result as T;
}

export const getFileSettings = () => workspaceRequest<FileSettings>('/api/settings/files');
export async function changeFileSettings(changes: Partial<Omit<FileSettings, 'defaults'>>) {
  const result = await workspaceRequest<FileSettings>('/api/settings/files', changes, 'PATCH');
  window.dispatchEvent(new CustomEvent('pinboard-file-settings', { detail: result }));
  return result;
}

let flushHandler: ((full?: boolean) => Promise<void>) | null = null;
let suspendHandler: (() => Promise<void>) | null = null;
let writesSuspended = false;
const auxiliaryWrites = new Set<Promise<unknown>>();
export async function trackWorkspaceWrite<T>(pending: Promise<T>): Promise<T> {
  auxiliaryWrites.add(pending);
  try { return await pending; } finally { auxiliaryWrites.delete(pending); }
}
export const workspaceWritesSuspended = () => writesSuspended;
export const setDraftSuspendHandler = (handler: (() => Promise<void>) | null) => { suspendHandler = handler; };
export async function suspendWorkspaceWrites() {
  writesSuspended = true;
  await suspendHandler?.();
  await Promise.allSettled([...auxiliaryWrites]);
}
export const resumeWorkspaceWrites = () => { writesSuspended = false; };
export const setDraftFlushHandler = (handler: ((full?: boolean) => Promise<void>) | null) => { flushHandler = handler; };
export async function flushWorkspaceDraft(full = true) {
  if (!flushHandler) throw new Error('画板尚未载入完成，请稍候');
  await flushHandler(full);
}

/** Persist the current board to the fsynced recovery journal without creating
 * a full snapshot. Used before opening an independent new board. */
export const flushWorkspaceJournal = () => flushWorkspaceDraft(false);
