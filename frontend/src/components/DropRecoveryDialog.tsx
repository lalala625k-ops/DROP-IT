import { useEffect, useRef, useState } from 'react';
import { canOpenOriginal, DropRecoveryOffer, DropOpenChoice } from '../utils/dropRecovery';
import { openBoardWindow } from '../utils/boardWindows';
import { flushWorkspaceDraft, workspaceRequest } from '../utils/workspaceApi';

const names = { original: '正式文件', backup: '备份', draft: '暂存', salvage: '抢救内容', temporary: '中断保存的临时文件' };
const states = { complete: '完整', partial: '部分恢复', unrecoverable: '无法恢复' };
export function DropRecoveryDialog({ offer, onClose, onOriginal, onOffer }: {
  offer: DropRecoveryOffer; onClose: () => void; onOriginal: (choice: DropOpenChoice) => Promise<void>;
  onOffer: (offer: DropRecoveryOffer) => void;
}) {
  const [id, setId] = useState(offer.recommended_id || offer.candidates[0]?.id);
  const panel = useRef<HTMLElement>(null);
  const [allowMissing, setAllowMissing] = useState(false);
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  const selected = offer.candidates.find(item => item.id === id);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const key = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault(); event.stopImmediatePropagation();
      if (!busy) onClose();
    };
    window.addEventListener('keydown', key, true);
    return () => { window.removeEventListener('keydown', key, true); previous?.focus(); };
  }, [busy, onClose]);
  const open = async () => {
    if (!selected) return;
    setBusy(true); setError('');
    const choice = { inspection_id: offer.inspection_id, candidate_id: selected.id };
    try {
      if (canOpenOriginal(selected)) await onOriginal(choice);
      else await openBoardWindow(false, flushWorkspaceDraft, '无法打开恢复画板，请允许弹出窗口', async () => {
        const result = await workspaceRequest<{ task_id: string }>('/api/storage/recovery/prepare', { ...choice, allow_missing: allowMissing });
        return result.task_id;
      });
      onClose();
    } catch (failure) { setError(failure instanceof Error ? failure.message : '恢复失败'); }
    finally { setBusy(false); }
  };
  return <div data-modal="drop-recovery" className="fixed inset-0 z-[10001] flex items-center justify-center bg-ink/30 p-4"
    onMouseDown={event => event.stopPropagation()} onMouseUp={event => event.stopPropagation()}
    onWheel={event => event.stopPropagation()} onContextMenu={event => { event.preventDefault(); event.stopPropagation(); }}>
    <section ref={panel} role="dialog" aria-modal="true" aria-label="选择文件恢复版本"
      onKeyDown={event => {
        event.stopPropagation();
        if (event.key !== 'Tab') return;
        const controls = [...panel.current!.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled)')];
        const index = controls.indexOf(document.activeElement as HTMLElement);
        event.preventDefault();
        controls[(index + (event.shiftKey ? -1 : 1) + controls.length) % controls.length]?.focus();
      }}
      className="w-full max-w-2xl max-h-[85vh] overflow-auto border-2 border-ink bg-white p-5 text-sm text-ink">
      <h2 className="text-lg font-bold">选择文件恢复版本</h2>
      <p className="my-3 break-all">{offer.source_path}</p>
      <p className="mb-3">检测到文件异常或较新的暂存。备份、暂存和抢救内容将在新画板打开。</p>
      <div className="space-y-2">{offer.candidates.map(item => <label key={item.id}
        className={`flex gap-3 border p-3 ${id === item.id ? 'border-ink' : 'border-ash'}`}>
        <input type="radio" name="drop-version" checked={id === item.id} disabled={busy}
          onChange={() => { setId(item.id); setAllowMissing(false); }} />
        <span className="min-w-0"><strong>{names[item.kind]}</strong> · {states[item.status]}{offer.recommended_id === item.id ? ' · 推荐' : ''}
          <span className="block text-ink/60">{item.saved_at ? new Date(item.saved_at).toLocaleString() : '时间未知'} · {item.cards} 张便签 · {item.groups} 个 Group / 原点 · {item.pins} 个图钉</span>
          <span className="block break-all text-ink/60">{item.path}</span>
          {item.reason && <span className="block">{item.reason}</span>}
        </span>
      </label>)}</div>
      {selected?.warnings.map((message, index) => <p key={index} className="mt-3">{message}</p>)}
      {!!selected?.issues.length && <ul className="mt-3 list-disc pl-5">{selected.issues.map((issue, index) => <li key={index} className="break-all">{issue.url}：{issue.reason}</li>)}</ul>}
      {selected?.status === 'partial' && <label className="mt-4 flex gap-2"><input type="checkbox" checked={allowMissing}
        disabled={busy} onChange={event => setAllowMissing(event.target.checked)} />确认部分恢复，缺失图片保留占位</label>}
      {error && <p role="alert" className="mt-3 text-red-700">{error}</p>}
      <div className="mt-4 flex justify-end gap-2">
        <button disabled={busy} className="mr-auto border border-ink px-3 py-2" onClick={() => {
          setBusy(true); setError('');
          void workspaceRequest<DropRecoveryOffer>('/api/storage/recovery/refresh', { inspection_id: offer.inspection_id })
            .then(onOffer).catch(failure => setError(failure.message)).finally(() => setBusy(false));
        }}>重新检查</button>
        <button autoFocus disabled={busy} className="border border-ink px-3 py-2" onClick={onClose}>取消</button>
        <button disabled={busy || !selected || selected.status === 'unrecoverable' || (selected.status === 'partial' && !allowMissing)}
          className="border border-ink px-3 py-2 disabled:opacity-40" onClick={() => void open()}>
          {busy ? '正在处理…' : selected && canOpenOriginal(selected) ? '打开正式文件' : '在新画板恢复'}
        </button>
      </div>
    </section>
  </div>;
}
