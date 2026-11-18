import type { Card, Rect, Viewport } from '../types';
import { imageCardFooterHeight, LINK_CARD_FOOTER_HEIGHT, CARD_SOURCE_HEIGHT, IMAGE_FOOTER_BACKGROUND } from './cardLayout';
import { getThumbnailUrl } from './thumbnail';
import { isFeishuUrl } from './feishu';
import type { FarImageCache, FarImageRequest } from './farImageCache';

export function farImageRequest(card: Card, zoom: number, ratio: number): FarImageRequest | undefined {
  if (card.type === 'text' || (card.type === 'web' && isFeishuUrl(card.url))) return;
  const source = getThumbnailUrl(card.image, card.thumbnail);
  if (!source) return;
  return { source, fallback: card.image && card.image !== source ? card.image : undefined,
    edge: Math.max(card.width, card.height) * zoom * ratio };
}

export function farCardOnScreen(card: Rect, viewport: Viewport, width: number, height: number, buffer = 0) {
  return viewport.x + (card.x + card.width) * viewport.zoom >= -buffer &&
    viewport.y + (card.y + card.height) * viewport.zoom >= -buffer &&
    viewport.x + card.x * viewport.zoom <= width + buffer && viewport.y + card.y * viewport.zoom <= height + buffer;
}

export function drawFarCard(context: CanvasRenderingContext2D, card: Card, viewport: Viewport, cache: FarImageCache, ratio: number, accentColor?: string) {
  const x = viewport.x + card.x * viewport.zoom;
  const y = viewport.y + card.y * viewport.zoom;
  const width = card.width * viewport.zoom;
  const height = card.height * viewport.zoom;
  const request = farImageRequest(card, viewport.zoom, ratio);
  const bitmap = request && cache.get(request);
  const footer = Math.min(height, (card.type === 'image' ? imageCardFooterHeight(card) :
    card.type === 'web' ? LINK_CARD_FOOTER_HEIGHT : card.type === 'file' ? CARD_SOURCE_HEIGHT : 0) *
    (card.contentScale ?? 1) * viewport.zoom);
  context.fillStyle = '#fffefa';
  context.fillRect(x, y, width, height);
  if (bitmap && height > footer) {
    const scale = Math.min(width / bitmap.sourceWidth, (height - footer) / bitmap.sourceHeight);
    const imageWidth = bitmap.sourceWidth * scale;
    context.drawImage(bitmap, x + (width - imageWidth) / 2, y, imageWidth, bitmap.sourceHeight * scale);
  } else if (!request && width > 12 && height > 10) {
    context.fillStyle = '#77736c';
    context.fillRect(x + 3, y + 4, Math.max(3, width * 0.6), 1);
  }
  if (card.type === 'image' && footer > 0) {
    context.fillStyle = IMAGE_FOOTER_BACKGROUND;
    context.fillRect(x, y + height - footer, width, footer);
  }
  context.strokeStyle = accentColor || '#373633';
  // A fixed 1px border would obscure almost all image pixels at 1% zoom.
  context.lineWidth = Math.min(1, viewport.zoom * 3);
  context.strokeRect(x, y, width, height);
}
