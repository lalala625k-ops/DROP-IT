import { cacheRemoteImage } from './remoteImage';
import { readDroppedImageFile, readableDroppedImage } from './droppedImageRecovery';
import { ingestScreenshot, type ImageActions } from './ingestScreenshot';
import { getWorkspaceId } from './workspaceApi';
import { IMAGE_SOURCE_HEIGHT, LINK_CARD_DEFAULT_WIDTH } from './cardLayout';

// Preview and durable caching race independently; neither waits for page titles.
export async function ingestDroppedImage(source: string, actions: ImageActions) {
  actions = { ...actions, initialWidth: LINK_CARD_DEFAULT_WIDTH };
  const workspace = getWorkspaceId();
  const sourceUrl = actions.sourceUrl || source;
  const original = readableDroppedImage(source).then(size => size ? { image: source, size, thumbnail: undefined } : null);
  const cached = cacheRemoteImage(source, sourceUrl).then(async asset => {
    if (!asset) return null;
    const size = await readableDroppedImage(asset.image);
    return size ? { ...asset, size } : null;
  });
  const first = await new Promise<Awaited<typeof original> | Awaited<typeof cached>>(resolve => {
    let remaining = 2;
    for (const task of [original, cached]) void task.then(result => {
      if (result) resolve(result);
      else if (!--remaining) resolve(null);
    });
  });
  if (getWorkspaceId() !== workspace) return;
  if (!first) {
    const file = await readDroppedImageFile(source);
    if (getWorkspaceId() !== workspace) return;
    if (file && await ingestScreenshot(file, actions)) return;
    actions.showToast('原图和图片缓存均无法读取，请稍后重新拖入');
    return;
  }
  const width = LINK_CARD_DEFAULT_WIDTH;
  const height = width * first.size.height / first.size.width + IMAGE_SOURCE_HEIGHT;
  const created = actions.createCard({ type: 'image', image: first.image, thumbnail: first.thumbnail,
    url: sourceUrl, title: actions.sourceTitle, width, height,
    x: actions.position.x - width / 2, y: actions.position.y - height / 2 });
  if (first.image !== source) return;
  const stillOwned = () => {
    const current = actions.getCard(created.id);
    return getWorkspaceId() === workspace && current?.type === 'image'
      && current.image === source && current.url === sourceUrl;
  };
  const asset = await cached;
  if (!stillOwned()) return;
  if (asset) {
    actions.updateCard(created.id, { image: asset.image, thumbnail: asset.thumbnail });
    return;
  }
  const file = await readDroppedImageFile(source);
  if (!stillOwned()) return;
  if (file && await ingestScreenshot(file, { ...actions, existingCard: { id: created.id, image: source, url: sourceUrl } })) return;
  if (stillOwned()) actions.showToast('原图已显示，但尚未缓存到本地，离线可能无法查看');
}
