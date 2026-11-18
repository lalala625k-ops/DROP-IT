import { useEffect, useRef, useState } from 'react';
import type { DocumentDecision } from '../components/DocumentDecisionDialog';
import { waitForClose, CloseWaitChoice } from '../utils/closeWait';
import { documentKey, documentLabel, DocumentStatus } from '../utils/documentState';
import { saveDropFile, DocumentConflict, clearDiscardedCache, settleObjectWrites } from '../utils/storage';
import { changeFileSettings, flushWorkspaceDraft, getFileSettings, getWorkspaceId,
  resumeWorkspaceWrites, suspendWorkspaceWrites, workspaceRequest, WorkspaceState } from '../utils/workspaceApi';

export function useDocumentState(ready: boolean, state: WorkspaceState, toast: (message: string) => void,
  beforeCapture?: () => void) {
  const workspaceId = getWorkspaceId();
  const latest = useRef(state); latest.current = state;
  const beforeCaptureRef = useRef(beforeCapture); beforeCaptureRef.current = beforeCapture;
  const [decision, setDecision] = useState<DocumentDecision | null>(null);
  const [timeoutDecision, setTimeoutDecision] = useState<DocumentDecision | null>(null);
  const dismissTimeout = useRef<(() => void) | null>(null);
  const [label, setLabel] = useState('未保存');
  const baseline = useRef<string | null>(null);
  const status = useRef<DocumentStatus | null>(null);
  const saving = useRef(false), closing = useRef(false), disposed = useRef(false);
  const closeAttempt = useRef<{ cancelled: boolean } | null>(null);
  const operation = useRef<Promise<boolean> | null>(null);
  const initialized = useRef<Promise<void> | null>(null);
  const updateLabel = () => {
    const dirty = baseline.current === null
      ? !!(latest.current.cards.length || latest.current.groups.length || latest.current.pins.length)
      : documentKey(latest.current) !== baseline.current;
    const value = documentLabel(status.current?.source_path || null, dirty, saving.current, !!status.current?.external_changed);
    setLabel(value); document.title = `${value} — DropIt`;
    return dirty;
  };
  const ask = (title: string, message: string, options: DocumentDecision['options'], remember = false) =>
    new Promise<{ id: string; remember: boolean }>(resolve => setDecision({ title, message, options, remember,
      resolve: (id, remembered) => { setDecision(null); resolve({ id, remember: remembered }); } }));
  const refresh = async (includeState = false) => {
    const next = await workspaceRequest<DocumentStatus>(`/api/storage/document?include_state=${includeState}`);
    if (disposed.current || next.workspace_id !== getWorkspaceId()) return;
    status.current = next;
    if (includeState) baseline.current = next.saved_state ? documentKey(next.saved_state) : null;
    updateLabel();
  };
  const resetDocument = async (action: 'reload' | 'discard', stamp: Record<string, unknown> | null, cancelled = () => false) => {
    try {
      await suspendWorkspaceWrites();
      await settleObjectWrites();
      if (cancelled()) { resumeWorkspaceWrites(); return false; }
      await workspaceRequest(`/api/storage/${action}`, { workspace_id: getWorkspaceId(), stamp });
      clearDiscardedCache();
      baseline.current = documentKey(latest.current);
      return true;
    } catch (error) {
      resumeWorkspaceWrites();
      toast(`${action === 'reload' ? '重新加载' : '丢弃'}失败：${error instanceof Error ? error.message : error}`);
      return false;
    }
  };
  const save = async (saveAs = false): Promise<boolean> => {
    if (operation.current) return false;
    const work = async (): Promise<boolean> => {
      saving.current = true; updateLabel();
      try {
        await initialized.current;
        beforeCaptureRef.current?.();
        const captured = latest.current;
        const capturedKey = documentKey(captured);
        let overwrite: Record<string, unknown> | undefined;
        for (;;) {
          try {
            const result = await saveDropFile(captured.cards, captured.groups, captured.viewport || undefined,
              captured.pins, saveAs, overwrite);
            if (!result.success) return false;
            baseline.current = capturedKey;
            status.current = { workspace_id: getWorkspaceId(), source_path: result.path, external_changed: false, stamp: null };
            toast(`保存成功，文件已保存到：\n${result.path}`);
            return true;
          } catch (error) {
            if (!(error instanceof DocumentConflict)) throw error;
            status.current = { ...status.current!, external_changed: true };
            const answer = await ask(error.missing ? '原文件已不存在' : '文件已在外部修改',
              error.missing ? '可以在原位置重建，或保留当前内容并另存。' : '请选择要保留的版本。重新加载会丢弃本画板尚未保存的修改。', [
                { id: 'cancel', label: '取消' }, { id: 'save-as', label: '另存为' },
                ...(!error.missing ? [{ id: 'reload', label: '重新加载' }] : []),
                { id: 'overwrite', label: error.missing ? '在原处重建' : '覆盖' },
              ]);
            if (answer.id === 'cancel') return false;
            if (answer.id === 'reload') {
              if (await resetDocument('reload', error.stamp)) window.location.reload();
              return false;
            }
            saveAs = answer.id === 'save-as';
            overwrite = answer.id === 'overwrite' ? error.stamp || { missing: true } : undefined;
          }
        }
      } catch (error) { toast(`保存失败：${error instanceof Error ? error.message : error}`); return false; }
      finally { saving.current = false; updateLabel(); }
    };
    const pending = work(); operation.current = pending;
    try { return await pending; } finally { operation.current = null; }
  };
  const requestClose = async (attempt: { cancelled: boolean }) => {
    if (closing.current) return false;
    closing.current = true; closeAttempt.current = attempt;
    try {
      if (operation.current) await operation.current;
      if (attempt.cancelled) return false;
      if (!ready) return false;
      await initialized.current;
      if (attempt.cancelled) return false;
      beforeCaptureRef.current?.();
      if (!updateLabel()) { await flushWorkspaceDraft(); return !updateLabel(); }
      const options = await getFileSettings();
      if (attempt.cancelled) return false;
      let answer: { id: string; remember: boolean } = { id: options.close_behavior || 'ask', remember: false };
      if (answer.id === 'ask') answer = await ask('保存画板的修改？', status.current?.source_path || '未保存的画板', [
        { id: 'cancel', label: '取消' }, { id: 'discard', label: '丢弃' }, { id: 'save', label: '保存' },
      ], true);
      if (answer.id === 'cancel') return false;
      if (answer.remember) await changeFileSettings({ close_behavior: answer.id as 'save' | 'discard' });
      if (answer.id === 'discard') {
        await refresh();
        return await resetDocument('discard', status.current?.stamp || null, () => attempt.cancelled);
      }
      if (!await save()) return false;
      if (attempt.cancelled) return false;
      // Edits made while the file was being saved must not be silently closed.
      if (updateLabel()) { toast('保存期间有新的修改，请再次关闭以处理。'); return false; }
      await flushWorkspaceDraft();
      return !updateLabel();
    } catch (error) { toast(`关闭失败：${error instanceof Error ? error.message : error}`); return false; }
    finally { if (closeAttempt.current === attempt) closing.current = false; }
  };
  const requestCloseWithTimeout = () => {
    const attempt = { cancelled: false };
    let clean = false;
    const host = window as Window & { pinboardCloseClean?: boolean };
    host.pinboardCloseClean = false;
    const work = requestClose(attempt).then(result => { clean = result && !attempt.cancelled; return result; });
    return waitForClose(work, {
    deciding: () => !!document.querySelector('[data-modal]'),
    dismiss: () => { dismissTimeout.current?.(); dismissTimeout.current = null; },
    prompt: () => new Promise<CloseWaitChoice>(resolve => {
      const finish = (id: string) => { setTimeoutDecision(null); dismissTimeout.current = null; resolve(id as CloseWaitChoice); };
      dismissTimeout.current = () => finish('wait');
      setTimeoutDecision({ title: '关闭前的磁盘处理仍未完成',
        message: '可以继续等待或取消关闭。强制关闭可能丢失尚未落盘的修改。',
        options: [{ id: 'cancel', label: '取消关闭' }, { id: 'wait', label: '继续等待' }, { id: 'force', label: '强制关闭' }],
        resolve: finish });
    }),
    }).then(result => { host.pinboardCloseClean = result && clean; return result; }).finally(() => {
      attempt.cancelled = true;
      if (closeAttempt.current === attempt) closing.current = false;
    });
  };
  const closeRef = useRef(requestCloseWithTimeout); closeRef.current = requestCloseWithTimeout;
  useEffect(() => {
    disposed.current = false;
    if (ready) {
      initialized.current = refresh(true);
      void initialized.current.catch(error => toast(`保存状态读取失败：${error.message}`));
    }
    const focus = () => { if (!saving.current && !closing.current) void refresh().catch(() => {}); };
    const host = window as Window & { pinboardRequestClose?: () => Promise<boolean> };
    host.pinboardRequestClose = () => closeRef.current();
    window.addEventListener('focus', focus);
    return () => { disposed.current = true; delete host.pinboardRequestClose; window.removeEventListener('focus', focus); };
  }, [ready, workspaceId]);
  useEffect(() => { if (ready) { const timer = window.setTimeout(updateLabel, 250); return () => clearTimeout(timer); } },
    [ready, state.cards, state.groups, state.pins, state.viewport]);
  return { save, decision: decision || timeoutDecision, label };
}
