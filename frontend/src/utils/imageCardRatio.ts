import { Card } from '../types';
import { CARD_SOURCE_HEIGHT, imageCardFooterHeight, LINK_CARD_FOOTER_HEIGHT } from './cardLayout';

export const imageRatioCache = new Map<string, number>();

export function getImageRatio(card: Card): number {
  const cached = imageRatioCache.get(card.id) || (card.image ? imageRatioCache.get(card.image) : undefined);
  if (cached && cached > 0) return cached;

  if (typeof document !== 'undefined') {
    const cardEl = document.querySelector(`[data-card-id="${card.id}"]`);
    const imgEl = cardEl?.querySelector('img') as HTMLImageElement | null;
    if (imgEl && imgEl.naturalWidth && imgEl.naturalHeight) {
      const ratio = imgEl.naturalWidth / imgEl.naturalHeight;
      imageRatioCache.set(card.id, ratio);
      if (card.image) imageRatioCache.set(card.image, ratio);
      return ratio;
    }
  }

  const textH = getImageCardTextHeight(card);
  const imgH = Math.max(20, card.height - textH);
  return card.width / imgH;
}

export function getImageCardTextHeight(card: Card): number {
  if (typeof document !== 'undefined') {
    const cardEl = document.querySelector(`[data-card-id="${card.id}"]`);
    if (cardEl) {
      const titleEl = cardEl.querySelector('[data-card-title]') as HTMLElement | null;
      const footerEl = cardEl.querySelector('[data-web-footer]') as HTMLElement | null;
      if (titleEl || footerEl) return ((titleEl?.offsetHeight || 0) + (footerEl?.offsetHeight || 0)) * (card.contentScale || 1);
    }
  }
  if (card.type === 'image') return imageCardFooterHeight(card) * (card.contentScale || 1);
  if (card.type === 'web' || card.type === 'file') return card.image
    ? (card.type === 'web' ? LINK_CARD_FOOTER_HEIGHT : CARD_SOURCE_HEIGHT) * (card.contentScale || 1) : 0;
  return 0;
}
