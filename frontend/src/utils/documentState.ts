import type { WorkspaceState } from './workspaceApi';

// Preserve object extensions; omit only transient parsing and absent values.
const serialized = new WeakMap<object, string>();
function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value)
    .filter(([key, child]) => key !== 'isParsing' && child != null)
    .sort(([a], [b]) => a.localeCompare(b)).map(([key, child]) => [key, canonical(child)]));
  return value;
}
function objectKey(value: object, group = false) {
  let key = serialized.get(value);
  if (key === undefined) {
    const item = value as { zIndex?: number; collapsed?: boolean };
    key = JSON.stringify(canonical(group ? { ...value, zIndex: item.zIndex ?? 0, collapsed: item.collapsed ?? false } : value));
    serialized.set(value, key);
  }
  return key;
}
export function documentKey(state: WorkspaceState) {
  return JSON.stringify([state.cards.map(item => objectKey(item)), state.groups.map(item => objectKey(item, true)),
    state.pins.map(item => objectKey(item)), canonical(state.viewport || null)]);
}

export interface DocumentStatus {
  workspace_id: string; source_path: string | null; external_changed: boolean;
  missing?: boolean; stamp: Record<string, unknown> | null; saved_state?: WorkspaceState | null;
}

export function documentLabel(source: string | null, dirty: boolean, saving: boolean, external: boolean) {
  const name = source?.split(/[\\/]/).pop() || '未保存';
  return `${name}${dirty ? ' ●' : ''}${saving ? ' · 保存中' : external ? ' · 外部已改' : ''}`;
}
