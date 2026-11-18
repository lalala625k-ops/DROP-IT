import React, { useRef, useState } from 'react';
import type { Card, Group } from '../types';
import { bundleTitleLayout } from '../utils/bundleStack';
import { imageSourceTitle } from '../hooks/useImageSourceMetadata';
import { SiteLogo } from './SiteLogo';
import { LocalFileIcon } from './LocalFileIcon';
import { IMAGE_FOOTER_BACKGROUND, IMAGE_FOOTER_TEXT } from '../utils/cardLayout';

interface Props {
  group: Group;
  members: Card[];
  branchColors?: ReadonlyMap<string, string>;
  onDrag?: (event: React.MouseEvent) => void;
  onFront?: (cardId: string) => void;
  onHoverCard?: (cardId: string | null) => void;
}

// A collapsed Bundle is a visual stack. Rendering every member creates one
// DOM subtree per card and makes large Bundles expensive to paint and hover.
// The full member list remains available when the Bundle is expanded.
const MAX_RENDERED_STACK_PAGES = 32;

export function bundleMemberTitle(card: Card) {
  return (card.headerTitle || card.title || card.fileSource?.name || (card.url ? imageSourceTitle('', card.url) : '')
    || card.content?.split('\n').find(line => line.trim()) || (card.type === 'image' ? '图片' : '便签'))
    .replace(/^#{1,6}\s+/, '').trim();
}

function StackPage({ card, front, titleHeight, scale, onDrag, onFront, onHoverCard }: {
  card: Card; front: boolean; titleHeight: number; scale: number;
  onDrag?: Props['onDrag']; onFront?: () => void; onHoverCard?: Props['onHoverCard'];
}) {
  const down = useRef<{ x: number; y: number; modified: boolean }>();
  const title = bundleMemberTitle(card);
  return <div data-stack-card-id={card.id} data-stack-front={front}
    className="relative h-full w-full bg-paper border border-ink overflow-hidden pointer-events-auto"
    style={{ borderColor: 'var(--branch-color, #1d1d1d)' }}
    onMouseDown={onDrag} onMouseEnter={() => onHoverCard?.(card.id)} onMouseLeave={() => onHoverCard?.(null)}>
    <button type="button" data-stack-title={card.id} aria-label={`将 ${title} 调到最前面`}
      aria-pressed={front} title={title}
      className={`absolute bottom-0 inset-x-0 flex items-center justify-end min-w-0 border-t border-ink/20 text-right focus-visible:outline focus-visible:outline-2 cursor-pointer select-none overflow-hidden [&_svg]:text-inherit ${
        card.type === 'image' ? 'hover:underline focus-visible:outline-paper' : 'text-ink/80 hover:text-ink focus-visible:outline-ink bg-paper'}`}
      style={{ height: titleHeight - 1, padding: 2 * scale, gap: 2 * scale, fontSize: 11 * scale, lineHeight: `${14 * scale}px`,
        backgroundColor: card.type === 'image' ? IMAGE_FOOTER_BACKGROUND : undefined,
        color: card.type === 'image' ? IMAGE_FOOTER_TEXT : undefined }}
      onMouseDown={event => {
        event.stopPropagation();
        down.current = { x: event.clientX, y: event.clientY,
          modified: event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey };
        if (event.button === 0 && down.current.modified) onDrag?.(event);
      }}
      onClick={event => {
        event.stopPropagation();
        const pointer = down.current;
        down.current = undefined;
        if (event.detail !== 0 && (!pointer || pointer.modified
          || Math.hypot(event.clientX - pointer.x, event.clientY - pointer.y) > 3)) return;
        onFront?.();
      }}>
      <span className={`relative flex items-center justify-end min-w-0 gap-[2px] ${card.type === 'image' ? 'w-full' : ''}`}>
        {card.fileSource ? <LocalFileIcon /> : card.url
          ? <span className="shrink-0" style={{ width: 12 * scale, height: 12 * scale }}>
            <SiteLogo url={card.url} favicon={card.favicon} className="w-full h-full" />
          </span>
          : null}
        <span className={`truncate min-w-0 ${card.type === 'image' ? 'flex-1' : ''}`}>{title}</span>
      </span>
    </button>
  </div>;
}

export const BundleCardStack: React.FC<Props & { offsetX?: number; offsetY?: number }> = (props) => {
  const { group, members, onDrag, onFront, onHoverCard } = props;
  const offsetX = props.offsetX ?? group.x;
  const offsetY = props.offsetY ?? group.y;
  const layout = bundleTitleLayout(members, group);
  const pages = layout.pages.slice(0, MAX_RENDERED_STACK_PAGES);
  return <>{pages.map((page, index) => <div key={page.card.id} className="absolute"
    style={{ left: page.x - offsetX, top: page.y - offsetY,
      width: page.width, height: page.height, zIndex: layout.pages.length - index,
      '--branch-color': props.branchColors?.get(page.card.id) } as React.CSSProperties}>
    <StackPage card={page.card} front={index === 0} titleHeight={layout.titleHeight} scale={layout.scale}
      onDrag={onDrag} onFront={() => onFront?.(page.card.id)} onHoverCard={onHoverCard} />
  </div>)}</>;
};
