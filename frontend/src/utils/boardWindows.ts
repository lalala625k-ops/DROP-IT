type BoardHost = Window & {
  pywebview?: { api?: { new_board?: (openFile?: boolean, recoveryJob?: string, selectionId?: string) => Promise<void> | void } };
};

/** Launch a separate workspace; checkpoint the caller before the child loads. */
export async function openBoardWindow(
  openFile = false,
  beforeOpen?: () => Promise<void>,
  blockedMessage = '无法打开新画板，请允许浏览器弹出窗口',
  prepareRecovery?: () => Promise<string>,
  selectFile?: () => Promise<string | null>,
): Promise<void> {
  const api = (window as BoardHost).pywebview?.api;
  if (api?.new_board) {
    const selection = await selectFile?.();
    if (selectFile && !selection) return;
    const job = await prepareRecovery?.();
    await beforeOpen?.();
    if (job) await api.new_board(false, job);
    else if (selection) await api.new_board(false, undefined, selection);
    else await api.new_board(openFile);
    return;
  }
  // Reserve the tab during the click, before awaiting a disk checkpoint, so
  // browsers do not treat the eventual navigation as an unsolicited popup.
  const child = window.open('about:blank', '_blank');
  if (!child) throw new Error(blockedMessage);
  child.opener = null;
  try {
    const selection = await selectFile?.();
    if (selectFile && !selection) { child.close(); return; }
    const job = await prepareRecovery?.();
    await beforeOpen?.();
    const url = new URL(window.location.pathname, window.location.origin);
    url.searchParams.set('new-board', '1');
    const boardId = typeof crypto.randomUUID === 'function' ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    url.searchParams.set('board-id', boardId);
    if (job) url.searchParams.set('restore-job', job);
    else if (selection) url.searchParams.set('open-selection', selection);
    else if (openFile) url.searchParams.set('open-file', '1');
    child.location.replace(url.href);
  } catch (error) {
    child.close();
    throw error;
  }
}

export function getOpenSelectionRequest(): string | null {
  const url = new URL(window.location.href);
  return url.searchParams.get('new-board') === '1' ? url.searchParams.get('open-selection') : null;
}

export function completeOpenSelectionRequest(): void {
  const url = new URL(window.location.href);
  url.searchParams.delete('open-selection');
  window.history.replaceState(window.history.state, '', url.href);
}

export function getRecoveryRequest(): string | null {
  const url = new URL(window.location.href);
  return url.searchParams.get('new-board') === '1' ? url.searchParams.get('restore-job') : null;
}

export function completeRecoveryRequest(): void {
  const url = new URL(window.location.href);
  url.searchParams.delete('restore-job');
  window.history.replaceState(window.history.state, '', url.href);
}

/** Consume the child-only open request once, including across F5/HMR. */
export function consumeOpenFileRequest(): boolean {
  const url = new URL(window.location.href);
  if (url.searchParams.get('new-board') !== '1' || url.searchParams.get('open-file') !== '1') return false;
  url.searchParams.delete('open-file');
  window.history.replaceState(window.history.state, '', url.href);
  return true;
}
