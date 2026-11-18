import React from 'react';
import type { Card } from '../../types';
import { imageSourceTitle, imageSourceLabel } from '../../hooks/useImageSourceMetadata';
import { ImageSourceStatus } from './ImageSourceFooter';
import { LocalFileIcon } from '../LocalFileIcon';
import { SiteLogo } from '../SiteLogo';
import { imageCardFooterHeight, LINK_CARD_FOOTER_HEIGHT } from '../../utils/cardLayout';
import { linkCardDetail } from '../../utils/linkCardDetail';
import { StableImage } from './StableImage';

const FRAME = 'var(--branch-color, #1d1d1d)';

interface FoldedLinkCardProps {
  card: Card;
  imageSrc: string;
  fallbackImageSrc?: string;
  isSelected: boolean;
  canvasImage: boolean;
  crispRender: boolean;
  sourceTitlePending?: boolean;
  placeholder?: React.ReactNode;
  onImageLoad: (event: React.SyntheticEvent<HTMLImageElement>) => void;
  onImageError: () => void;
  onWebLinkClick: (event: React.MouseEvent) => void;
  onDescriptionHoverStart?: () => void;
  onDescriptionHoverEnd?: () => void;
  handoffPending?: boolean;
}

function insetPoints(points: Array<[number, number]>, insetX: number, insetY: number): Array<[number, number]> {
  const [topLeft, topRight, rightFold, diagonalEnd, bottomLeft] = points;
  return [
    [topLeft[0] + insetX, topLeft[1] + insetY],
    [topRight[0] - insetX, topRight[1] + insetY],
    [rightFold[0] - insetX, rightFold[1] + insetY],
    [diagonalEnd[0] + insetX, diagonalEnd[1] - insetY],
    [bottomLeft[0] + insetX, bottomLeft[1] - insetY],
  ];
}

function polygonPath(points: Array<[number, number]>) {
  return `M ${points.map(([x, y]) => `${x} ${y}`).join(' L ')} Z`;
}

function LinkCardFooter({ card, isSelected, onWebLinkClick, sourceTitlePending, onDescriptionHoverStart, onDescriptionHoverEnd }: Pick<FoldedLinkCardProps,
  'card' | 'isSelected' | 'onWebLinkClick' | 'sourceTitlePending' | 'onDescriptionHoverStart' | 'onDescriptionHoverEnd'>) {
  const imageOnly = card.type === 'image';
  const title = imageOnly
    ? (card.url ? imageSourceLabel(card.title, card.url) : card.title || card.fileSource?.name || '')
    : imageSourceTitle(card.title, card.url);
  const detail = linkCardDetail(card);
  const clickable = isSelected && !!(card.url || card.fileSource);
  return (
    <div className="relative h-full w-full overflow-hidden bg-white text-ink" data-web-footer data-link-card-footer
      data-card-detail-trigger onMouseEnter={onDescriptionHoverStart} onMouseLeave={onDescriptionHoverEnd}
      data-image-source={imageOnly && !!(card.url || card.fileSource) ? true : undefined}>
      {detail.text && <button type="button" data-video-author
        onClick={onWebLinkClick} onDoubleClick={(event) => event.stopPropagation()}
        aria-label={`查看详情：${detail.text}`}
        className={`absolute inset-x-[1px] bottom-[17px] block truncate text-right text-[11px] leading-[13px] text-ink/70 ${isSelected ? 'cursor-pointer hover:underline' : 'cursor-default'}`}>
        {detail.text}
      </button>}
      <button type="button" onClick={onWebLinkClick} onDoubleClick={(event) => event.stopPropagation()}
        aria-label={`${card.fileSource ? '在文件夹中显示' : card.url ? '打开网页' : '图片标题'}：${title}`} title={title}
        data-source-open={card.fileSource ? true : undefined}
        className={`absolute inset-x-[1px] bottom-[1px] flex h-[16px] min-w-0 items-end justify-end text-right text-[12.5px] font-bold leading-[14px] tracking-[-0.025em] ${clickable ? 'cursor-pointer hover:underline' : 'cursor-default'}`}>
        {imageOnly ? (card.url || card.fileSource) && <span className="absolute bottom-0 left-0 inline-flex h-3 w-3 items-center justify-center">
          {card.fileSource ? <LocalFileIcon path={card.fileSource.path} className="h-3 w-3" />
            : <ImageSourceStatus card={card} pending={sourceTitlePending} />}
        </span> : <SiteLogo url={card.url} favicon={card.favicon} className="absolute bottom-0 left-0 h-3 w-3" />}
        <span className="min-w-0 max-w-[80%] truncate">{title}</span>
      </button>
    </div>
  );
}

export const FoldedLinkCard: React.FC<FoldedLinkCardProps> = ({
  card, imageSrc, fallbackImageSrc, isSelected, canvasImage, crispRender, onImageLoad, onImageError, onWebLinkClick,
  sourceTitlePending, placeholder, onDescriptionHoverStart, onDescriptionHoverEnd, handoffPending = false,
}) => {
  const imageOnly = card.type === 'image';
  const cardHeight = Math.max(card.height, 1);
  const contentScale = card.contentScale || 1;
  const footerPixelHeight = imageOnly ? imageCardFooterHeight(card) : LINK_CARD_FOOTER_HEIGHT;
  const layoutCardHeight = Math.max(cardHeight / contentScale, 1);
  const scaledFooterHeight = footerPixelHeight * contentScale;
  const edge = Math.max(30, 100 - (scaledFooterHeight / cardHeight) * 100);
  const fold = 3.75;
  const imageWidth = Math.max(card.width / contentScale, 1);
  // Convert the diagonal using the full card aspect ratio to keep a 45° fold.
  const cardAspect = imageWidth / layoutCardHeight;
  const triangleHeight = fold * 1.874 * cardAspect;
  const x = 100 - fold;
  const y = edge - triangleHeight;
  const triangleX = x - fold * 0.874;
  const outerPoints: Array<[number, number]> = [[0, 0], [100, 0], [100, y], [triangleX, edge], [0, edge]];
  const frameInsetX = (1 / imageWidth) * 100;
  const frameInsetY = (1 / layoutCardHeight) * 100;
  const innerPoints = insetPoints(outerPoints, frameInsetX, frameInsetY);
  // Preserve the link card's existing cover mask. Image cards have no detail
  // row, so their cover ends directly above the compact title footer.
  const overlapPixels = imageOnly ? 0 : Math.round(Math.min(20, Math.max(16, footerPixelHeight * 0.42)));
  const imageViewportHeight = Math.max(layoutCardHeight - footerPixelHeight + overlapPixels, 1);
  const imageViewportEdge = Math.max(1, 100 - ((footerPixelHeight - overlapPixels) / layoutCardHeight) * 100);
  const imageOuterPoints: Array<[number, number]> = outerPoints.map(([pointX, pointY]) => [
    pointX, Math.max(0, Math.min(100, (pointY / imageViewportEdge) * 100)),
  ]);
  const imageInnerPoints = insetPoints(imageOuterPoints, frameInsetX, (1 / imageViewportHeight) * 100);
  const clipPath = `polygon(${imageInnerPoints.map(([pointX, pointY]) => `${pointX}% ${pointY}%`).join(', ')})`;

  return (
    <div className="relative h-full w-full overflow-hidden bg-paper text-ink"
      style={handoffPending ? { backgroundColor: 'transparent' } : undefined} data-folded-link-card>
      {placeholder ? <div className="absolute left-0 top-0 z-50 w-full overflow-hidden"
        style={{ height: imageViewportHeight, clipPath }}>{placeholder}</div> : !canvasImage && imageSrc && (
        <StableImage src={imageSrc} fallbackSrc={fallbackImageSrc} alt={card.title || (imageOnly ? 'Image' : 'Web preview')}
          className="pointer-events-none absolute left-0 top-0 z-50 w-full object-contain object-top bg-transparent"
          style={{ height: `calc(100% - ${footerPixelHeight - overlapPixels}px)`, objectPosition: 'center top',
            clipPath, transform: 'translate(0% 0%) scale(1)' }}
          referrerPolicy="no-referrer" draggable={false}
          loading={crispRender ? 'eager' : 'lazy'} decoding="async"
          fetchPriority={crispRender ? 'high' : 'auto'}
          onLoad={onImageLoad} onError={onImageError} />
      )}
      {!canvasImage && (
        <svg className="pointer-events-none absolute inset-0 z-[60] h-full w-full" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
          <path d={`${polygonPath(outerPoints)} ${polygonPath(innerPoints)}`} fill={FRAME} fillRule="evenodd" clipRule="evenodd" />
          <polygon points={`${x},${y} 100,${y} ${triangleX},${edge}`} fill={FRAME} />
        </svg>
      )}
      {footerPixelHeight > 0 && <div className="absolute bottom-0 left-0 z-40 w-full" style={{ height: footerPixelHeight }}>
        <LinkCardFooter card={card} isSelected={isSelected} onWebLinkClick={onWebLinkClick} sourceTitlePending={sourceTitlePending}
          onDescriptionHoverStart={onDescriptionHoverStart} onDescriptionHoverEnd={onDescriptionHoverEnd} />
      </div>}
    </div>
  );
};

export const LinkedImageCard = FoldedLinkCard;
