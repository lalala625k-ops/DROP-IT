import type { Card, FileSource } from '../types';
import { CARD_SOURCE_HEIGHT, IMAGE_SOURCE_HEIGHT, IMAGE_TITLE_HEIGHT } from './cardLayout';

export type SourceAction = 'open-source' | 'associate-source' | 'remove-source';
export interface WebScreenshotSource { url: string; app?: string }
export type ScreenshotSource = FileSource | WebScreenshotSource;
interface SourceBridge {
  get_dropped_file_source?: (stamp: number, name: string, size: number, modified: number) => Promise<FileSource | null>;
  get_file_preview?: (path: string) => Promise<string | null>;
  get_file_icon?: (path: string) => Promise<string | null>;
  match_screenshot_source?: (image: string) => Promise<ScreenshotSource | null>;
  read_clipboard_image?: () => Promise<string | null>;
  open_source_file?: (path: string) => Promise<{ success: boolean; error?: string }>;
  reveal_source_file?: (path: string) => Promise<{ success: boolean; error?: string }>;
  select_source_file?: () => Promise<{ success: boolean; source?: FileSource; error?: string } | null>;
}

export async function filePreview(path: string): Promise<string | undefined> {
  const api = bridge();
  if (!api?.get_file_preview || !validFileSource({ path, name: 'preview', linkedBy: 'detected' })) return;
  let timeout: ReturnType<typeof window.setTimeout> | undefined;
  try {
    const preview = await Promise.race([api.get_file_preview(path),
      new Promise<null>(resolve => { timeout = window.setTimeout(() => resolve(null), 5000); })]);
    return typeof preview === 'string' && /^data:image\/(?:webp|png|jpeg);base64,/i.test(preview) ? preview : undefined;
  } catch { return; }
  finally { if (timeout !== undefined) window.clearTimeout(timeout); }
}
const bridge = (): SourceBridge | undefined => (window as unknown as { pywebview?: { api?: SourceBridge } }).pywebview?.api;

const icons = new Map<string, Promise<string | undefined>>();
export async function fileIcon(path: string): Promise<string | undefined> {
  const api = bridge();
  if (!api?.get_file_icon || !validFileSource({ path, name: 'icon', linkedBy: 'detected' })) return;
  const cached = icons.get(path);
  if (cached) return cached;
  const pending = (async () => {
    let timeout: ReturnType<typeof window.setTimeout> | undefined;
    try {
      const icon = await Promise.race([api.get_file_icon!(path),
        new Promise<null>(resolve => { timeout = window.setTimeout(() => resolve(null), 5000); })]);
      return typeof icon === 'string' && icon.length <= 256 * 1024
        && /^data:image\/png;base64,[a-z0-9+/]+={0,2}$/i.test(icon) ? icon : undefined;
    } catch { return; }
    finally { if (timeout !== undefined) window.clearTimeout(timeout); }
  })();
  if (icons.size >= 256) icons.delete(icons.keys().next().value!);
  icons.set(path, pending);
  const icon = await pending;
  if (!icon && icons.get(path) === pending) icons.delete(path);
  return icon;
}

export async function readNativeClipboardImage(): Promise<string | undefined> {
  try {
    const image = await bridge()?.read_clipboard_image?.();
    return typeof image === 'string' && image.startsWith('data:image/') ? image : undefined;
  } catch { return; }
}

export async function droppedFileSource(file: File, stamp?: number): Promise<FileSource | undefined> {
  if (stamp === undefined || !Number.isFinite(stamp)) return;
  const api = bridge();
  if (!api?.get_dropped_file_source) return;
  let timeout: ReturnType<typeof window.setTimeout> | undefined;
  try {
    const source = await Promise.race([api.get_dropped_file_source(stamp, file.name, file.size, file.lastModified),
      // The native side waits up to five seconds for this drop's DOM callback.
      new Promise<null>(resolve => { timeout = window.setTimeout(() => resolve(null), 6000); })]);
    return validFileSource(source) ? source : undefined;
  } catch { return; }
  finally { if (timeout !== undefined) window.clearTimeout(timeout); }
}

export function validFileSource(source: unknown): source is FileSource {
  if (!source || typeof source !== 'object' || Array.isArray(source)) return false;
  const value = source as FileSource;
  return typeof value.path === 'string' && /^[a-z]:[\\/]/i.test(value.path) && !/[\0\r\n]/.test(value.path)
    && typeof value.name === 'string' && !!value.name && ['detected', 'selected'].includes(value.linkedBy)
    && (value.app == null || typeof value.app === 'string');
}

export function validWebScreenshotSource(source: unknown): source is WebScreenshotSource {
  if (!source || typeof source !== 'object' || Array.isArray(source) || 'path' in source) return false;
  const value = source as WebScreenshotSource;
  if (typeof value.url !== 'string' || !/^https?:\/\//i.test(value.url) || /[\s\\\0]/.test(value.url)
    || (value.app != null && typeof value.app !== 'string')) return false;
  try {
    const url = new URL(value.url);
    return !!url.hostname && !url.username && !url.password;
  } catch { return false; }
}

export async function screenshotSource(image: string): Promise<ScreenshotSource | undefined> {
  const api = bridge();
  if (!api?.match_screenshot_source) return;
  let timeout: ReturnType<typeof window.setTimeout> | undefined;
  try {
    const source = await Promise.race([api.match_screenshot_source(image),
      new Promise<null>((resolve) => { timeout = window.setTimeout(() => resolve(null), 2500); })]);
    return validFileSource(source) || validWebScreenshotSource(source) ? source : undefined;
  } catch { return; }
  finally { if (timeout !== undefined) window.clearTimeout(timeout); }
}

export async function openSource(source: FileSource) {
  const api = bridge();
  if (!api?.open_source_file) throw new Error('请在 Windows 桌面版打开本地来源文件');
  const result = await api.open_source_file(source.path);
  if (!result?.success) throw new Error(result?.error || '原文件打开失败，请重新关联');
}

export async function revealSource(source: FileSource) {
  const api = bridge();
  if (!api?.reveal_source_file) throw new Error(api
    ? '桌面文件接口尚未更新，请完整退出并重启桌面版'
    : '请在 Windows 桌面版定位本地来源文件');
  const result = await api.reveal_source_file(source.path);
  if (!result?.success) throw new Error(result?.error || '原文件定位失败，请重新关联');
}

export async function selectSource(): Promise<FileSource | undefined> {
  const api = bridge();
  if (!api?.select_source_file) throw new Error('请在 Windows 桌面版关联本地来源文件');
  const result = await api.select_source_file();
  if (!result) return;
  if (!result.success || !validFileSource(result.source)) throw new Error(result.error || '无法关联文件');
  return result.source;
}

export function sourceCardUpdates(card: Card, source?: FileSource): Partial<Card> {
  const sourceTitle = card.title === card.fileSource?.name ? undefined : card.title;
  const imageFooter = card.type === 'text' ? 0 : card.url ? IMAGE_SOURCE_HEIGHT : (source ? card.title : sourceTitle) ? IMAGE_TITLE_HEIGHT : 0;
  const delta = CARD_SOURCE_HEIGHT - imageFooter;
  const footer = delta * (card.contentScale || 1);
  const adding = !!source && !card.fileSource;
  const removing = !source && !!card.fileSource;
  const height = Math.max(20, card.height + (adding ? footer : removing ? -footer : 0));
  return { fileSource: source || null, type: card.type === 'text' ? 'text' : source ? 'file' : 'image',
    ...((adding || removing) ? { height,
      defaultHeight: Math.max(20, (card.defaultHeight || card.height / (card.contentScale || 1)) + (adding ? delta : -delta)) } : {}),
    ...(source && card.type !== 'text' ? { title: source.name } : {}),
    ...(removing && card.type !== 'text' && card.title === card.fileSource?.name ? { title: undefined } : {}) };
}

export function sourceError(error: unknown) {
  window.dispatchEvent(new CustomEvent('pinboard-file-error', { detail: error instanceof Error ? error.message : '来源文件操作失败' }));
}
