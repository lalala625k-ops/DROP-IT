import { useEffect, useRef } from 'react';
import type { WorkspaceState, FileSettings } from '../utils/workspaceApi';
import { browserBoardId, getFileSettings, getWorkspaceId, setDraftFlushHandler, setDraftSuspendHandler, workspaceWritesSuspended, workspaceRequest, workspaceUrl } from '../utils/workspaceApi';
import { flushWorkspaceSync, currentServerRevision, acknowledgeServerRevision, settleObjectWrites } from '../utils/storage';
import { writeWorkspaceCache } from '../utils/workspaceCache';

export function useWorkspaceDraft(ready: boolean, state: WorkspaceState, showToast: (message: string) => void,
  beforeCapture?: () => void) {
  const latest = useRef(state);
  latest.current = state;
  const beforeCaptureRef = useRef(beforeCapture); beforeCaptureRef.current = beforeCapture;
  const options = useRef<FileSettings | null>(null);
  const generation = useRef(0);
  const savedGeneration = useRef(-1);
  const firstChange = useRef(0);
  const timer = useRef<number | null>(null);
  const journalTimer = useRef<number | null>(null);
  const cacheTimer = useRef<number | null>(null);
  const running = useRef<Promise<void> | null>(null);
  const journalRunning = useRef<Promise<void> | null>(null);
  const journalGeneration = useRef(-1);
  const lastError = useRef('');
  const remember = (pending: boolean, revision = generation.current) => writeWorkspaceCache({ ...latest.current,
    workspace_id: getWorkspaceId(), client_revision: revision, database_revision: currentServerRevision(), pending_draft: pending });
  // Gestures can update the canvas once per animation frame. Coalesce cache
  // writes so serializing the full workspace does not block the main thread.
  // Explicit saves and pagehide still flush synchronously through rememberNow.
  const rememberNow = (pending: boolean, revision = generation.current) => {
    if (cacheTimer.current !== null) {
      window.clearTimeout(cacheTimer.current);
      cacheTimer.current = null;
    }
    remember(pending, revision);
  };
  const scheduleRemember = (pending: boolean) => {
    if (cacheTimer.current !== null) return;
    cacheTimer.current = window.setTimeout(() => {
      cacheTimer.current = null;
      remember(pending, generation.current);
    }, 250);
  };

  const appendJournal = async (force = false): Promise<void> => {
    if (workspaceWritesSuspended()) return;
    if (journalRunning.current) { await journalRunning.current; return appendJournal(force); }
    if (!ready || generation.current === journalGeneration.current || (!force && !options.current?.autosave_enabled)) return;
    // Card-level synchronization and the recovery journal share the same
    // database revision. Drain that queue before capturing base_revision;
    // otherwise a queued /api/cards/changes request can commit first and make
    // this journal request look like a change from another window.
    await settleObjectWrites();
    const captured = latest.current, id = getWorkspaceId(), revision = generation.current;
    if (!id) throw new Error('工作区标识尚未载入');
    const operation = (async () => {
      const result = await workspaceRequest<{ success: boolean; disabled?: boolean }>('/api/workspace/journal', {
        ...captured, cards: captured.cards.map(({ isParsing: _parsing, ...card }) => card),
        workspace_id: id, client_revision: revision, base_revision: browserBoardId ? null : currentServerRevision(), force,
      });
      if (!result.success) { if (result.disabled) return; throw new Error('暂存日志未完成'); }
      journalGeneration.current = revision;
    })();
    journalRunning.current = operation;
    try { await operation; }
    catch (error) {
      const reason = error instanceof Error ? error.message.replace(/^(?:暂存日志失败[：:]\s*)+/, '') : '无法写入文件';
      const message = `暂存日志失败：${reason}`;
      if (message !== lastError.current) showToast(message);
      lastError.current = message;
      throw error;
    } finally { journalRunning.current = null; }
  };
  const appendJournalRef = useRef(appendJournal); appendJournalRef.current = appendJournal;

  const save = async (force = false): Promise<void> => {
    if (workspaceWritesSuspended()) return;
    if (running.current) { await running.current; return save(force); }
    if (!ready || generation.current === savedGeneration.current || (!force && !options.current?.autosave_enabled)) return;
    const captured = latest.current, id = getWorkspaceId(), revision = generation.current;
    if (!id) throw new Error('工作区标识尚未载入');
    rememberNow(true);
    const operation = (async () => {
      await flushWorkspaceSync(captured.cards, captured.groups);
      const result = await workspaceRequest<{ success: boolean; disabled?: boolean; revision?: number }>('/api/workspace/draft', {
        ...captured, cards: captured.cards.map(({ isParsing: _parsing, ...card }) => card),
        workspace_id: id, client_revision: revision, base_revision: browserBoardId ? null : currentServerRevision(), force,
      });
      if (!result.success) { if (result.disabled) return; throw new Error('暂存未完成'); }
      acknowledgeServerRevision(result.revision);
      savedGeneration.current = revision;
      if (generation.current === revision) { firstChange.current = 0; remember(false, revision); }
      lastError.current = '';
    })();
    running.current = operation;
    try { await operation; }
    catch (error) {
      const reason = error instanceof Error ? error.message.replace(/^(?:暂存失败[：:]\s*)+/, '') : '无法写入文件';
      const message = `暂存失败：${reason}`;
      if (message !== lastError.current) showToast(message);
      lastError.current = message;
      throw error;
    } finally { running.current = null; }
    if (force && generation.current !== savedGeneration.current) await save(true);
  };
  const saveRef = useRef(save); saveRef.current = save;

  useEffect(() => {
    if (!ready) return;
    const applyOptions = (event: Event) => { options.current = (event as CustomEvent<FileSettings>).detail; };
    void getFileSettings().then((value) => { options.current = value; }).catch((error) => showToast(`暂存设置读取失败：${error.message}`));
    window.addEventListener('pinboard-file-settings', applyOptions);
    const flush = async (full = true) => {
      if (workspaceWritesSuspended()) return;
      beforeCaptureRef.current?.();
      await appendJournalRef.current(true);
      if (full) await saveRef.current(true);
    };
    setDraftFlushHandler(flush);
    setDraftSuspendHandler(async () => {
      for (const ref of [timer, journalTimer, cacheTimer]) {
        if (ref.current !== null) window.clearTimeout(ref.current);
        ref.current = null;
      }
      await Promise.allSettled([journalRunning.current, running.current]);
    });
    const host = window as Window & { pinboardFlushDraft?: () => Promise<boolean> };
    host.pinboardFlushDraft = async () => { try { await flush(); return true; } catch { return false; } };
    const checkpoint = window.setInterval(() => {
      if (firstChange.current && Date.now() - firstChange.current >= (options.current?.max_seconds || 30) * 1000) {
        void saveRef.current().catch(() => {});
      }
    }, 1000);
    const unload = () => {
      if (workspaceWritesSuspended()) return;
      beforeCaptureRef.current?.();
      if (generation.current === savedGeneration.current) return;
      rememberNow(true);
      // Best effort for browser unload; native close waits for the real disk write.
      const payload = { ...latest.current, workspace_id: getWorkspaceId(), client_revision: generation.current,
        base_revision: browserBoardId ? null : currentServerRevision(), force: true };
      navigator.sendBeacon?.(workspaceUrl('/api/workspace/draft'), new Blob([JSON.stringify(payload)], { type: 'application/json' }));
    };
    const cacheError = () => showToast('本地暂存缓存写入失败，请保持窗口打开并检查磁盘暂存状态。');
    const closeError = () => showToast('关闭前暂存未完成，窗口已保留。请检查目录或连接后再次关闭。');
    window.addEventListener('pagehide', unload);
    window.addEventListener('pinboard-draft-cache-failed', cacheError);
    window.addEventListener('pinboard-close-failed', closeError);
    return () => {
      setDraftFlushHandler(null); delete host.pinboardFlushDraft;
      setDraftSuspendHandler(null);
      window.clearInterval(checkpoint);
      if (timer.current !== null) window.clearTimeout(timer.current);
      if (journalTimer.current !== null) window.clearTimeout(journalTimer.current);
      if (cacheTimer.current !== null) window.clearTimeout(cacheTimer.current);
      window.removeEventListener('pagehide', unload);
      window.removeEventListener('pinboard-file-settings', applyOptions);
      window.removeEventListener('pinboard-draft-cache-failed', cacheError);
      window.removeEventListener('pinboard-close-failed', closeError);
    };
  }, [ready, showToast]);

  useEffect(() => {
    if (!ready || workspaceWritesSuspended()) return;
    generation.current = Math.max(Date.now(), generation.current + 1);
    if (!firstChange.current) firstChange.current = Date.now();
    scheduleRemember(true);
    if (timer.current !== null) window.clearTimeout(timer.current);
    if (journalTimer.current === null) journalTimer.current = window.setTimeout(() => {
      journalTimer.current = null;
      void appendJournalRef.current().catch(() => {});
    }, 250);
    timer.current = window.setTimeout(() => { void saveRef.current().catch(() => {}); }, (options.current?.idle_seconds || 5) * 1000);
  }, [ready, state.cards, state.groups, state.viewport, state.pins]);
}
