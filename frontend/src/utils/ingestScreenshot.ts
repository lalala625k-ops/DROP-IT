import { Card, FileSource } from '../types';
import { removePendingImage, storePendingImage } from './pendingImages';
import { screenshotSource, sourceCardUpdates, validFileSource, validWebScreenshotSource } from './fileSource';
import { getWorkspaceId, workspaceUrl } from './workspaceApi';
import { CARD_SOURCE_HEIGHT, IMAGE_SOURCE_HEIGHT } from './cardLayout';

export interface ImageActions {
  createCard: (data: Partial<Card>) => Card;
  updateCard: (id: string, data: Partial<Card>) => void;
  getCard: (id: string) => Card | undefined;
  showToast: (message: string) => void;
  position: { x: number; y: number };
  initialWidth?: number;
  sourceUrl?: string;
  sourceTitle?: string;
  fileSource?: FileSource;
  pendingFileSource?: Promise<FileSource | undefined>;
  matchClipboardSource?: boolean;
  existingCard?: { id: string; image: string; url?: string };
}

const readImage = (file: File) => new Promise<string>((resolve, reject) => {
  const reader = new FileReader();
  reader.onload = () => resolve(reader.result as string);
  reader.onerror = () => reject(new Error('图片读取失败'));
  reader.readAsDataURL(file);
});

const imageSize = (src: string) => new Promise<{ width: number; height: number }>((resolve, reject) => {
  const image = new Image();
  const timeout = window.setTimeout(() => {
    image.onload = image.onerror = null;
    reject(new Error('图片读取超时'));
  }, 10000);
  image.referrerPolicy = 'no-referrer';
  image.onload = () => {
    window.clearTimeout(timeout);
    resolve({ width: image.naturalWidth, height: image.naturalHeight });
  };
  image.onerror = () => {
    window.clearTimeout(timeout);
    reject(new Error('图片读取失败'));
  };
  image.src = src;
});

export async function ingestScreenshot(file: File, actions: ImageActions) {
  const workspace = getWorkspaceId();
  let dataUrl: string;
  let size: { width: number; height: number };
  try {
    dataUrl = await readImage(file);
    size = await imageSize(dataUrl);
  } catch {
    actions.showToast('图片读取失败');
    return false;
  }

  const ownsExisting = () => {
    if (!actions.existingCard) return true;
    const current = actions.getCard(actions.existingCard.id);
    return getWorkspaceId() === workspace && current?.type === 'image'
      && current.image === actions.existingCard.image && current.url === actions.existingCard.url;
  };
  if (!ownsExisting()) return false;
  const id = actions.existingCard?.id || `card-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  const backedUp = await storePendingImage(id, dataUrl);
  if (!ownsExisting()) return false;
  const width = actions.initialWidth ?? Math.min(size.width, 360);
  const matchedSource = actions.matchClipboardSource ? await screenshotSource(dataUrl) : undefined;
  const fileSource = validFileSource(actions.fileSource) ? actions.fileSource
    : validFileSource(matchedSource) ? matchedSource : undefined;
  const sourceUrl = actions.sourceUrl || (validWebScreenshotSource(matchedSource) ? matchedSource.url : undefined);
  const height = width * size.height / size.width + (fileSource ? CARD_SOURCE_HEIGHT : sourceUrl ? IMAGE_SOURCE_HEIGHT : 0);
  if (actions.existingCard) actions.updateCard(id, { image: dataUrl, thumbnail: undefined });
  else actions.createCard({ id, type: fileSource ? 'file' : 'image', fileSource, title: fileSource?.name || actions.sourceTitle,
    url: sourceUrl, image: dataUrl, width, height,
    x: actions.position.x - width / 2, y: actions.position.y - height / 2 });

  const images = new Set([dataUrl]);
  const sourceReady = actions.pendingFileSource?.then(async source => {
    if (!validFileSource(source)) return;
    // Let React commit the newly created card before consulting its latest state.
    await new Promise<void>(resolve => window.setTimeout(resolve, 0));
    const current = actions.getCard(id);
    if (getWorkspaceId() !== workspace || !current || current.type !== 'image'
      || current.fileSource || current.url || current.isParsing || !images.has(current.image || '')) return;
    const updates = sourceCardUpdates(current, source);
    if (current.title !== actions.sourceTitle) updates.title = current.title;
    actions.updateCard(id, updates);
  }).catch(() => { /* An unavailable source never discards the imported image. */ });

  let uploaded = false;
  try {
    const response = await fetch(workspaceUrl('/api/upload-asset'), {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ image: dataUrl }),
    });
    if (!response.ok) throw new Error('图片上传失败');
    const asset = await response.json();
    if (!asset.success || typeof asset.url !== 'string' || !asset.url.startsWith('/api/assets/')) {
      throw new Error('图片上传失败');
    }
    const assetUrl = workspaceUrl(asset.url);
    const thumbnailUrl = typeof asset.thumbnail_url === 'string' ? workspaceUrl(asset.thumbnail_url) : undefined;
    uploaded = true;
    // A successful upload response alone does not guarantee that the static
    // resource is readable. Keep the embedded original and its durable backup
    // until the URL has actually decoded as an image.
    await imageSize(assetUrl);
    const current = actions.getCard(id);
    if (getWorkspaceId() === workspace && current && (current.type === 'image' || current.type === 'file')
      && images.has(current.image || '')) {
      images.add(assetUrl);
      actions.updateCard(id, { image: assetUrl, thumbnail: thumbnailUrl });
      window.setTimeout(() => { void removePendingImage(id); }, 2000);
    } else {
      void removePendingImage(id);
    }
  } catch {
    actions.showToast(uploaded
      ? '图片资源暂不可读，已保留本地原图'
      : backedUp ? '图片已暂存本地，后端未连接' : '图片已显示，但暂存失败；请启动后端');
  }
  await sourceReady;
  return true;
}
