import React, { forwardRef } from 'react';
import type { Card } from '../../types';
import { imageSourceLabel } from '../../hooks/useImageSourceMetadata';
import { IMAGE_SOURCE_INSET, IMAGE_FOOTER_BACKGROUND, IMAGE_FOOTER_TEXT } from '../../utils/cardLayout';
import { SiteLogo } from '../SiteLogo';
import { SourceParsingIndicator } from './SourceParsingIndicator';

interface Props {
  card: Card;
  selected: boolean;
  onClick: (event: React.MouseEvent) => void;
  pending?: boolean;
}

export function ImageSourceStatus({ card, pending }: { card: Card; pending?: boolean }) {
  return pending ? <SourceParsingIndicator sourceTitle />
    : <SiteLogo url={card.url} favicon={card.favicon} className="h-3 w-3" />;
}

export const ImageSourceFooter = forwardRef<HTMLDivElement, Props>(({ card, selected, onClick, pending }, ref) => {
  const title = imageSourceLabel(card.title, card.url);
  return <div ref={ref} data-web-footer data-image-source
    className="relative overflow-hidden shrink-0 min-w-0 flex border-t border-ink"
    style={{ padding: IMAGE_SOURCE_INSET, backgroundColor: IMAGE_FOOTER_BACKGROUND, color: IMAGE_FOOTER_TEXT }}>
    <button type="button" onClick={onClick} onDoubleClick={event => event.stopPropagation()}
      aria-label={`打开网页：${title}`} title={title}
      className={`relative w-full min-w-0 flex items-center gap-[2px] text-[11px] leading-[14px] font-medium select-none text-right [&_svg]:text-inherit ${
        selected ? 'hover:underline cursor-pointer' : 'cursor-default'}`}>
      <ImageSourceStatus card={card} pending={pending} />
      <span className="flex-1 min-w-0 truncate">{title}</span>
    </button>
  </div>;
});
