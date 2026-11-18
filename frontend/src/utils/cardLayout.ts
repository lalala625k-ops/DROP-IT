import type { Card } from '../types';

// Text insets in unscaled card coordinates. Image pixels stay edge to edge.
export const CARD_TEXT_INSET = 5;
export const TEXT_CARD_MIN_HEIGHT = 21 + CARD_TEXT_INSET * 2;
export const IMAGE_SOURCE_INSET = 1;
export const IMAGE_SOURCE_HEIGHT = 18; // 16px title row + 1px below + separator.
export function imageCardFooterHeight(card: Pick<Card, 'title' | 'url' | 'fileSource'>): number {
  return card.title || card.url || card.fileSource ? IMAGE_SOURCE_HEIGHT : 0;
}
// A folded web card keeps one compact detail row above its compact title row.
// This is deliberately separate from the one-line footer used by image cards.
export const LINK_CARD_FOOTER_HEIGHT = 31;
export const LINK_CARD_DEFAULT_WIDTH = 280;
export const IMAGE_FOOTER_BACKGROUND = '#1d1d1d';
export const IMAGE_FOOTER_TEXT = '#d1d1d1';
export const IMAGE_TITLE_HEIGHT = 25; // 14px line + 5px on each side + separator.
export const CARD_SOURCE_HEIGHT = 51; // Single title line, source line and 5px insets.
export const CARD_TAGS_HEIGHT = 35;
