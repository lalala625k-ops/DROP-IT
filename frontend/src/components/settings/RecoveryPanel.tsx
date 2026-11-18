import { useEffect, useMemo, useRef, useState } from 'react';
import { RecoveryRecord, RecoverySelection, workspaceRequest } from '../../utils/workspaceApi';

const tr = (text: string) => text;
const statuses = { unchecked: '待检查', complete: '完整', partial: '部分资源缺失', unrecoverable: '无法恢复' };
const recordName = (record: RecoveryRecord) => record.source_path || record.status === 'unrecoverable'
  ? record.name : `${tr('未命名画板')} ${record.workspace_id.slice(0, 6)}`;

export function RecoveryPanel({ onClose, onRestore, initialRecords, onOpenFile }: {
  onClose: () => void; onRestore: (selection: RecoverySelection) => Promise<void>;
  initialRecords?: RecoveryRecord[]; onOpenFile?: () => void;
}) {
  const [records, setRecords] = useState<RecoveryRecord[]>(initialRecords || []);
  const panel = useRef<HTMLDivElement>(null);
  const [selected, setSelected] = useState<RecoveryRecord | null>(null);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [allowMissing, setAllowMissing] = useState(false);
  useEffect(() => {
    if (initialRecords) { setLoading(false); return; }
    let active = true;
    void workspaceRequest<{ records: RecoveryRecord[] }>('/api/workspace/recoveries')
      .then(data => { if (active) setRecords(data.records); })
      .catch(failure => { if (active) setError(failure.message); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, []);
  useEffect(() => {
    const escape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault(); event.stopImmediatePropagation();
      if (!busy) onClose();
    };
    window.addEventListener('keydown', escape, true);
    return () => window.removeEventListener('keydown', escape, true);
  }, [busy, onClose]);
  const groups = useMemo(() => {
    const grouped = new Map<string, RecoveryRecord[]>();
    for (const record of records) {
      const key = record.workspace_id;
      grouped.set(key, [...(grouped.get(key) || []), record]);
    }
    return [...grouped.values()].map(group => group.sort((a, b) =>
      (b.saved_at || b.snapshot_id).localeCompare(a.saved_at || a.snapshot_id)))
      .sort((a, b) => (b[0].saved_at || b[0].snapshot_id).localeCompare(a[0].saved_at || a[0].snapshot_id));
  }, [records]);
  const run = async (operation: () => Promise<void>) => {
    setBusy(true); setError('');
    try { await operation(); }
    catch (failure) { setError(failure instanceof Error ? failure.message : tr('恢复失败')); }
    finally { setBusy(false); }
  };
  const inspect = async (record: RecoveryRecord, resourceDir = record.resource_dir) => {
    setAllowMissing(false);
    const checked = await workspaceRequest<RecoveryRecord>('/api/workspace/recovery/inspect', {
      record_id: record.record_id, resource_dir: resourceDir,
    });
    setSelected(checked);
    setRecords(items => items.map(item => item.record_id === checked.record_id ? checked : item));
  };
  const choose = (kind: 'file' | 'folder') => void run(async () => {
    const result = await workspaceRequest<{ cancelled?: boolean; records?: RecoveryRecord[] }>('/api/workspace/recovery/select', { kind });
    if (result.cancelled) return;
    const imported = result.records || [];
    setRecords(items => [...items.filter(item => !imported.some(other => other.record_id === item.record_id)), ...imported]);
    if (imported.length) await inspect(imported[0]);
    else setError(tr('所选文件夹没有暂存记录'));
  });
  const chooseResources = () => void run(async () => {
    const result = await workspaceRequest<{ cancelled?: boolean; path?: string }>('/api/workspace/recovery/select', { kind: 'resources' });
    if (selected && !result.cancelled && result.path) await inspect(selected, result.path);
  });
  const restore = () => void run(async () => {
    if (!selected) return;
    await onRestore({ record_id: selected.record_id, resource_dir: selected.resource_dir, allow_missing: allowMissing });
    onClose();
  });
  const button = 'border border-ink px-3 py-1 disabled:opacity-40';
  return <div className="fixed inset-0 z-[80] bg-ink/30 flex items-center justify-center p-6" onClick={() => { if (!busy) onClose(); }}>
    <div ref={panel} role="dialog" aria-label={initialRecords ? '上次未正常关闭的画板' : tr('文件恢复')} aria-modal="true" data-modal="recovery" data-interactive="true"
      onKeyDown={event => {
        event.stopPropagation();
        if (event.key !== 'Tab') return;
        const controls = [...panel.current!.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled)')];
        const index = controls.indexOf(document.activeElement as HTMLElement);
        event.preventDefault();
        controls[(index + (event.shiftKey ? -1 : 1) + controls.length) % controls.length]?.focus();
      }}
      className="w-full max-w-[880px] max-h-[85vh] bg-paper border-2 border-ink flex flex-col text-[13px]"
      onClick={event => event.stopPropagation()} onWheel={event => event.stopPropagation()} onMouseDown={event => event.stopPropagation()}>
      <div className="flex items-center justify-between border-b border-ash p-4"><span>{initialRecords ? '上次未正常关闭的画板' : tr('文件恢复')}</span>
        <button autoFocus={!!initialRecords} disabled={busy} className={button} onClick={onClose}>{initialRecords ? '使用空白画板' : tr('关闭')}</button></div>
      {initialRecords && <p className="px-4 pt-3">检测到异常退出留下的内容。请选择要恢复的画板，也可以继续使用空白画板或打开其他文件。</p>}
      <div className="flex flex-wrap gap-2 border-b border-ash p-4">
        {onOpenFile && <button disabled={busy} className={button} onClick={onOpenFile}>打开其他文件</button>}
        <button disabled={busy || loading} className={button} onClick={() => choose('file')}>{tr('选择暂存文件')}</button>
        <button disabled={busy || loading} className={button} onClick={() => choose('folder')}>{tr('选择暂存文件夹')}</button>
        <span className="self-center text-ink/60">{tr('恢复结果在新画板打开')}</span>
      </div>
      {error && <div role="alert" className="px-4 pt-3 text-red-700 whitespace-pre-wrap">{error}</div>}
      <div className="flex flex-col md:flex-row overflow-auto min-h-0">
        <div className="p-4 md:w-1/2 shrink-0 md:overflow-auto">
          <div className="mb-3">{tr('历史记录')}</div>
          {loading ? tr('读取中') : records.length === 0 ? tr('暂无恢复记录') : null}
          {groups.map(group => <div key={group[0].workspace_id} className="mb-4">
            <div className="break-words mb-1">{recordName(group.find(record => record.status !== 'unrecoverable') || group[0])}</div>
            {group.map(record => <button key={record.record_id} disabled={busy || loading}
              onClick={() => void run(() => inspect(record))} title={record.draft_path}
              className={`block w-full text-left border-b border-ash p-2 disabled:opacity-40 ${selected?.record_id === record.record_id ? 'bg-ash/40' : ''}`}>
              <div>{record.saved_at ? new Date(record.saved_at).toLocaleString() : record.snapshot_id}</div>
              <div className="text-ink/60">{record.card_count} {tr('张便签')} · {tr(statuses[record.status])}</div>
            </button>)}
          </div>)}
        </div>
        <div className="p-4 md:w-1/2 md:overflow-auto border-t md:border-t-0 md:border-l border-ash">
          {!selected ? tr('选择一个版本查看恢复详情') : <>
            <div className="break-words mb-2">{recordName(selected)}</div>
            <div className="text-ink/60 mb-2">{selected.saved_at ? new Date(selected.saved_at).toLocaleString() : selected.snapshot_id}</div>
            <div>{tr(statuses[selected.status])}</div>
            <div className="my-2 text-ink/60">{selected.card_count} {tr('张便签')} · {selected.group_count} Group · {selected.origin_count} {tr('个原点')} · {selected.pin_count} {tr('个图钉')}</div>
            <div className="text-ink/60 break-all mb-3">{selected.draft_path}</div>
            {selected.reason && <div role="alert" className="mb-3">{tr(selected.reason)}</div>}
            {selected.status === 'partial' && <>
              <button disabled={busy} className={button} onClick={chooseResources}>{tr('指定资源文件夹')}</button>
              <ul className="my-3 space-y-2">{selected.issues.map(issue => <li key={issue.url} className="break-words">
                {issue.objects.map(object => object.title).join('、') || issue.url}: {tr(issue.reason)}
              </li>)}</ul>
              <label className="flex gap-2 my-3 items-start"><input type="checkbox" disabled={busy} checked={allowMissing}
                onChange={event => setAllowMissing(event.target.checked)} />{tr('继续恢复可用内容，缺失图片显示占位')}</label>
            </>}
            <button disabled={busy || selected.status === 'unrecoverable' || (selected.status === 'partial' && !allowMissing)}
              className={button} onClick={restore}>{busy ? tr('正在处理…') : tr('在新画板恢复')}</button>
          </>}
        </div>
      </div>
    </div>
  </div>;
}
