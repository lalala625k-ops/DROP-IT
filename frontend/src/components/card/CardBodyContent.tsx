import React, { memo, useState, useRef, useEffect } from 'react';
import { Card } from '../../types';
import { isFeishuUrl } from '../../utils/feishu';
import { linkCardDetail } from '../../utils/linkCardDetail';
import { SiteLogo } from '../SiteLogo';
import { SourceParsingIndicator } from './SourceParsingIndicator';
import { textCardSize } from '../../utils/textCardSize';
import { measureTextCardHeight } from '../../utils/measureTextCardHeight';
import { imageRatioCache } from '../../utils/imageCardRatio';
import { MarkdownView } from '../MarkdownView';
import { getThumbnailUrl } from '../../utils/thumbnail';
import { LocalFileIcon } from '../LocalFileIcon';
import { TextFileSource } from './TextFileSource';
import { isLocalImageUrl } from '../../utils/remoteImage';
import { CARD_TEXT_INSET, TEXT_CARD_MIN_HEIGHT, CARD_SOURCE_HEIGHT, CARD_TAGS_HEIGHT, imageCardFooterHeight, LINK_CARD_FOOTER_HEIGHT } from '../../utils/cardLayout';
import { useImageSourceMetadata } from '../../hooks/useImageSourceMetadata';
import { useVideoCardDetails } from '../../hooks/useVideoCardDetails';
import { FoldedLinkCard, LinkedImageCard } from './FoldedLinkCard';
import { StableImage } from './StableImage';

interface CardBodyContentProps {
  card: Card;
  isSelected: boolean;
  onUpdate: (id: string, updates: Partial<Card>) => void;
  onAutoSize: (id: string, updates: Partial<Card>) => void;
  onTextEdit: (id: string, updates: Partial<Card>) => void;
  onTextEditStart: () => void;
  onTextEditingSize?: (size: { width: number; height: number } | null) => void;
  onWebLinkClick: (e: React.MouseEvent) => void;
  onDescriptionHoverStart?: () => void;
  onDescriptionHoverEnd?: () => void;
  canvasImage?: boolean;
  highQualityImage?: boolean;
  crispRender?: boolean;
  contentScale: number;
  handoffPending?: boolean;
}

const CardBodyContentInner: React.FC<CardBodyContentProps> = ({
  card,
  isSelected,
  onUpdate,
  onAutoSize,
  onTextEdit,
  onTextEditStart,
  onTextEditingSize,
  onWebLinkClick,
  onDescriptionHoverStart,
  onDescriptionHoverEnd,
  canvasImage = false,
  highQualityImage = false,
  crispRender = false,
  contentScale,
  handoffPending = false,
}) => {
  const [isEditingTitle, setIsEditingTitle] = useState(false);
  const [isEditingText, setIsEditingText] = useState(!card.content);
  const [textEditorEpoch, setTextEditorEpoch] = useState(0);
  const [titleText, setTitleText] = useState(card.title || '');
  const [imgLoadError, setImgLoadError] = useState(false);
  const [thumbFailed, setThumbFailed] = useState(false);
  // Keep the thumbnail visible while the original is being decoded. Once this
  // card has been promoted, keep that choice during transient LOD changes.
  const [useOriginalImage, setUseOriginalImage] = useState(false);
  const isFeishu = card.type === 'web' && isFeishuUrl(card.url);
  const sourceTitlePending = useImageSourceMetadata(card, onUpdate);
  useVideoCardDetails(card, onUpdate);

  const thumbSrc = getThumbnailUrl(card.image, card.thumbnail);
  const effectiveImageSrc = useOriginalImage && card.image
    ? card.image
    : (!thumbFailed && thumbSrc) ? thumbSrc : card.image;
  const missingImage = !!card.recoveryMedia?.image && !card.image;
  const imageUnavailable = missingImage || (card.type === 'image' && (!card.image || imgLoadError));
  const imageRecoveryPending = card.recoveryMedia?.image?.reason === '图片正在加载';
  const missingPlaceholder = <div data-recovery-missing="true" className="flex flex-col items-center justify-center h-full w-full p-[5px] bg-ash/30 text-ink/60 text-[13px] text-center">
    {card.thumbnail && isLocalImageUrl(card.thumbnail) ? <img src={card.thumbnail} alt="" className="max-h-[75%] max-w-full object-contain mb-2" draggable={false} /> : null}
    <span>{imageRecoveryPending ? '图片加载中…' : '图片资源缺失'}</span>
  </div>;

  const handleImageError = () => {
    if (useOriginalImage && thumbSrc && thumbSrc !== card.image) {
      setUseOriginalImage(false);
      setThumbFailed(false);
      return;
    }
    if (!thumbFailed && thumbSrc && thumbSrc !== card.image) {
      setThumbFailed(true);
    } else {
      setImgLoadError(true);
    }
  };

  const titleInputRef = useRef<HTMLInputElement>(null);
  const footerRef = useRef<HTMLDivElement>(null);
  const adjustedKeyRef = useRef<string | null>(null);
  const textInputRef = useRef<HTMLTextAreaElement>(null);
  const wasSelectedRef = useRef(isSelected);
  const textPointerRef = useRef<{ x: number; y: number; dragged: boolean } | null>(null);
  const suppressTextClickRef = useRef(false);

  useEffect(() => {
    if (card.type !== 'text' || card.sizeLocked || isEditingText) return;
    const bodyHeight = Math.max(TEXT_CARD_MIN_HEIGHT,
      measureTextCardHeight(card.content || '', card.width / contentScale) ?? textCardSize(card.content || '').height);
    const height = (bodyHeight + (card.tags?.length ? CARD_TAGS_HEIGHT : 0)
      + (card.fileSource ? CARD_SOURCE_HEIGHT : 0)) * contentScale;
    if (Math.abs(card.height - height) > 0.5) onAutoSize(card.id, { height });
  }, [card.id, card.type, card.content, card.width, card.height, card.sizeLocked,
    card.tags?.length, card.fileSource, contentScale, isEditingText, onAutoSize]);

  // Only selected text cards need the drag/click guard. Avoid installing two
  // window listeners for every image card in a large board.
  useEffect(() => {
    if (card.type !== 'text' || !isSelected) return;
    const handlePointerMove = (event: MouseEvent) => {
      const pointer = textPointerRef.current;
      if (!pointer || pointer.dragged) return;
      pointer.dragged = Math.hypot(event.clientX - pointer.x, event.clientY - pointer.y) > 3;
    };
    const handlePointerUp = () => {
      const pointer = textPointerRef.current;
      if (!pointer) return;
      suppressTextClickRef.current = pointer.dragged;
      textPointerRef.current = null;
    };
    window.addEventListener('mousemove', handlePointerMove);
    window.addEventListener('mouseup', handlePointerUp);
    return () => {
      window.removeEventListener('mousemove', handlePointerMove);
      window.removeEventListener('mouseup', handlePointerUp);
    };
  }, [card.type, isSelected]);

  const startTextEditing = () => {
    if (card.type !== 'text') return;
    setIsEditingText(true);
    const size = textCardSize(card.content || '');
    onTextEditingSize?.({
      width: Math.max(card.width, size.width * contentScale),
      height: Math.max(card.height, (size.height + ((card.tags?.length ? CARD_TAGS_HEIGHT : 0) + (card.fileSource ? CARD_SOURCE_HEIGHT : 0))) * contentScale),
    });
  };

  const handleTextChange = (content: string) => {
    if (card.type !== 'text') {
      onTextEdit(card.id, { content });
      return;
    }
    const size = textCardSize(content);
    const width = size.width * contentScale;
    const height = (size.height + ((card.tags?.length ? CARD_TAGS_HEIGHT : 0) + (card.fileSource ? CARD_SOURCE_HEIGHT : 0))) * contentScale;
    if (!card.sizeLocked) onTextEditingSize?.({ width, height });
    onTextEdit(card.id, {
      content,
      ...(!card.sizeLocked ? { width, height } : {}),
    });
  };

  const finishTextEdit = (content: string) => {
    if (card.type !== 'text') return;
    const size = textCardSize(content);
    const width = size.width * contentScale;
    const height = (size.height + ((card.tags?.length ? CARD_TAGS_HEIGHT : 0) + (card.fileSource ? CARD_SOURCE_HEIGHT : 0))) * contentScale;
    if (content === (card.content || '') && (card.sizeLocked
      || (card.width === width && card.height === height))) return;
    onTextEdit(card.id, { content,
      ...(!card.sizeLocked ? { width,
        height } : {}),
    });
  };

  const clearTextSelection = (input: HTMLTextAreaElement) => {
    const cursor = input.selectionEnd;
    input.setSelectionRange(cursor, cursor);
    window.getSelection()?.removeAllRanges();
  };

  useEffect(() => {
    if (!isSelected) {
      setIsEditingText(false);
      onTextEditingSize?.(null);
      if (textInputRef.current) {
        if (document.activeElement === textInputRef.current) textInputRef.current.blur();
        clearTextSelection(textInputRef.current);
        setTextEditorEpoch((epoch) => epoch + 1);
      }
      if (wasSelectedRef.current) window.getSelection()?.removeAllRanges();
    }
    wasSelectedRef.current = isSelected;
  }, [isSelected]);

  useEffect(() => {
    if (isEditingText && isSelected && textInputRef.current) {
      textInputRef.current.focus();
    }
  }, [isEditingText, isSelected]);

  useEffect(() => {
    setTitleText(card.title || '');
  }, [card.title]);

  useEffect(() => {
    setImgLoadError(false);
    setThumbFailed(false);
  }, [card.image, card.thumbnail]);

  useEffect(() => {
    setUseOriginalImage(false);
  }, [card.image]);

  useEffect(() => {
    if (!card.image || !highQualityImage) return;
    // StableImage keeps the existing thumbnail node until the original DOM
    // image is decoded; a detached preloader would decode the same source twice.
    setUseOriginalImage(true);
  }, [card.image, highQualityImage]);

  useEffect(() => {
    if (isFeishu && card.image) {
      onUpdate(card.id, { image: '', height: card.sizeLocked ? card.height : 90 });
    }
  }, [isFeishu, card.id, card.image, card.height, card.sizeLocked, onUpdate]);

  useEffect(() => {
    if (!isSelected) {
      if (isEditingTitle) {
        setIsEditingTitle(false);
        if (titleText !== card.title) onUpdate(card.id, { title: titleText, ...(card.type === 'image' ? { sourceTitleUrl: card.url } : {}) });
      }
    }
  }, [isSelected, isEditingTitle, titleText, card.title, card.id, onUpdate]);

  const handleTitleBlur = () => {
    setIsEditingTitle(false);
    if (titleText !== card.title) onUpdate(card.id, { title: titleText, ...(card.type === 'image' ? { sourceTitleUrl: card.url } : {}) });
  };

  const handleTitleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleTitleBlur();
    } else if (e.key === 'Escape') {
      setTitleText(card.title || '');
      setIsEditingTitle(false);
    }
  };

  const fitImageHeight = (ratio: number) => {
    // A saved/grouped web card can be marked size-locked even though its old
    // height includes the legacy multi-row footer. Keep the lock for manual
    // resizing, but still correct that stale image height so contain mode does
    // not create a large white band around the cover.
    const canFitLockedWebImage = card.sizeLocked && card.type === 'web' && !!card.image;
    if (card.sizeLocked && !canFitLockedWebImage) return;
    if (card.type === 'web' || card.type === 'file') {
      const imgHeight = card.width / ratio;
      // Folded web cards use the dedicated two-line information layer. The
      // regular web footer has title, URL and tag rows, so it is a different
      // height and must not be included in the folded card's image height.
      const footerH = footerRef.current?.offsetHeight
        || (card.type === 'web' && card.image ? LINK_CARD_FOOTER_HEIGHT : CARD_SOURCE_HEIGHT);
      const targetHeight = Math.round(imgHeight + footerH * contentScale);
      const key = `${card.id}_${card.image}_${Math.round(card.width)}_${targetHeight}`;
      if (Math.abs(card.height - targetHeight) > 4 && adjustedKeyRef.current !== key) {
        adjustedKeyRef.current = key;
        onAutoSize(card.id, {
          height: targetHeight,
          ...(canFitLockedWebImage ? { defaultHeight: targetHeight / (card.bundleId ? card.contentScale || 1 : 1) } : {}),
        });
      }
    } else if (card.type === 'image') {
      const targetHeight = Math.round(card.width / ratio + imageCardFooterHeight(card) * contentScale);
      const key = `${card.id}_${card.image}_${Math.round(card.width)}_${targetHeight}`;
      if (Math.abs(card.height - targetHeight) > 4 && adjustedKeyRef.current !== key) {
        adjustedKeyRef.current = key;
        onAutoSize(card.id, { height: targetHeight });
      }
    }
  };

  const handleImageLoad = (e: React.SyntheticEvent<HTMLImageElement>) => {
    const img = e.currentTarget;
    if (!img.naturalWidth || !img.naturalHeight) return;
    const ratio = img.naturalWidth / img.naturalHeight;
    imageRatioCache.set(card.id, ratio);
    if (card.image) imageRatioCache.set(card.image, ratio);
    fitImageHeight(ratio);
  };

  useEffect(() => {
    const ratio = card.image ? imageRatioCache.get(card.image) : undefined;
    if (ratio) fitImageHeight(ratio);
  }, [card.image, card.width, card.url, card.title, card.tags, card.sizeLocked, contentScale]);

  // Render Title and Link Footer for Web Cards
  const renderWebFooter = (isCompact = false) => (
    <div
      ref={footerRef}
      data-web-footer
      data-card-detail-trigger onMouseEnter={onDescriptionHoverStart} onMouseLeave={onDescriptionHoverEnd}
      className={`bg-paper flex flex-col justify-center ${
        isCompact ? 'w-full flex-1 relative overflow-hidden' : 'flex-shrink-0 border-t border-ink/20'
      }`}
      style={{
        padding: CARD_TEXT_INSET,
        color: card.textColor || undefined,
        borderTopColor: card.borderColor ? `${card.borderColor}33` : undefined,
      }}
    >
      <div className="flex items-center gap-[5px] min-w-0">
        {card.type === 'file' ? <LocalFileIcon path={card.fileSource?.path} /> : card.isParsing
          ? <SourceParsingIndicator />
          : <SiteLogo url={card.url} favicon={card.favicon} />}
        {isEditingTitle ? (
          <input
            ref={titleInputRef}
            type="text"
            value={titleText}
            autoFocus
            onChange={(e) => setTitleText(e.target.value)}
            onBlur={handleTitleBlur}
            onKeyDown={handleTitleKeyDown}
            onClick={(e) => e.stopPropagation()}
            onMouseDown={(e) => e.stopPropagation()}
            className="w-full min-w-0 bg-paper text-ink text-[13px] p-[5px] border border-ink rounded-[10px] outline-none font-retina"
          />
        ) : (
          <span
            onDoubleClick={(e) => {
              e.stopPropagation();
              if (isSelected) setIsEditingTitle(true);
            }}
            title={isSelected ? '双击可编辑标题' : undefined}
            className={`min-w-0 text-[15px] leading-[1.40] font-medium text-ink text-left line-clamp-2 select-none ${
              isSelected ? 'hover:underline cursor-text' : 'cursor-default'
            }`}
          >
            {card.title || card.fileSource?.name || card.url}
          </span>
        )}
      </div>

      {card.type === 'web' && (card.author || card.description?.startsWith('UP主 / 频道:')) && <div
        data-video-author
        className="mt-[5px] truncate text-[11px] leading-[13px] text-ink/70">{linkCardDetail(card).text}</div>}

      {card.fileSource && (
        <div className="mt-[5px] flex items-center min-w-0">
          <button
            type="button"
            onClick={onWebLinkClick}
            data-source-open={card.fileSource ? true : undefined}
            title={isSelected ? (card.fileSource ? `在文件夹中显示: ${card.fileSource.path}` : `打开: ${card.url}`) : '请先单击高亮卡片'}
            className={`min-w-0 max-w-full text-[11px] leading-[14px] font-mono flex items-center gap-[5px] transition-colors truncate select-none text-left ${
              isSelected
                ? 'text-ink/80 hover:text-ink hover:underline cursor-pointer'
                : 'text-ink/40 cursor-default'
            }`}
          >
            <svg className="w-3 h-3 flex-shrink-0 text-ink/70" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
            </svg>
            <span className="truncate">{card.fileSource.path}</span>
          </button>
        </div>
      )}

      {card.tags && card.tags.length > 0 && (
        <div className="mt-[5px] flex flex-wrap gap-[5px]">
          {card.tags.map((t) => (
            <span
              key={t}
              className="p-[5px] text-[11px] leading-[12px] font-bold uppercase tracking-[0.05em] text-ink bg-paper border border-ink/30 rounded-[10px] select-none hover:bg-ink hover:text-paper transition-colors"
            >
              #{t}
            </span>
          ))}
        </div>
      )}
    </div>
  );

  switch (card.type) {
    case 'image':
      return (
        <LinkedImageCard card={card} imageSrc={imageUnavailable ? '' : effectiveImageSrc || card.image || ''}
          fallbackImageSrc={!imageUnavailable && useOriginalImage && thumbSrc !== card.image ? thumbSrc : undefined}
          placeholder={imageUnavailable && !card.isParsing ? missingPlaceholder : undefined}
          isSelected={isSelected} canvasImage={canvasImage} crispRender={crispRender} sourceTitlePending={sourceTitlePending || !!card.isParsing}
          onImageLoad={handleImageLoad} onImageError={handleImageError} onWebLinkClick={onWebLinkClick}
          onDescriptionHoverStart={onDescriptionHoverStart} onDescriptionHoverEnd={onDescriptionHoverEnd}
          handoffPending={handoffPending} />
      );

    case 'file':
    case 'web':
      const showHeaderArea = card.type === 'file' || (!isFeishu && ((card.image && !imgLoadError) || missingImage));
      if (card.type === 'web' && card.image && !imgLoadError && !missingImage && !card.isParsing) {
        return (
          <FoldedLinkCard card={card} imageSrc={effectiveImageSrc || card.image}
            fallbackImageSrc={useOriginalImage && thumbSrc !== card.image ? thumbSrc : undefined}
            isSelected={isSelected} canvasImage={canvasImage} crispRender={crispRender}
            onImageLoad={handleImageLoad} onImageError={handleImageError} onWebLinkClick={onWebLinkClick}
            onDescriptionHoverStart={onDescriptionHoverStart} onDescriptionHoverEnd={onDescriptionHoverEnd}
            handoffPending={handoffPending} />
        );
      }
      return (
        <div className={`w-full h-full flex flex-col overflow-hidden rounded-none text-ink select-none ${handoffPending && card.image ? 'bg-transparent' : 'bg-paper'}`}>
          {showHeaderArea ? (
            <>
              <div className={`w-full flex-1 overflow-hidden relative flex items-center justify-center pointer-events-none min-h-0 ${handoffPending && card.image ? 'bg-transparent' : 'bg-paper'}`}>
                {card.type === 'file' && !card.image && !missingImage && (
                  <div className="flex h-full w-full flex-col items-center justify-center gap-3 bg-stone/15 text-ink/70">
                    <LocalFileIcon path={card.fileSource?.path} className="h-16 w-16" />
                    <div className="max-w-[85%] truncate text-center text-[18px] font-medium" title={card.fileSource?.name || card.title}>
                      {card.fileSource?.name || card.title || '本地文件'}
                    </div>
                    <div className="text-[11px] uppercase tracking-[0.12em] text-ink/45">{(card.fileSource?.name || card.title || '').split('.').pop()}</div>
                  </div>
                )}
                {missingImage && missingPlaceholder}
                {card.image && !imgLoadError && (
                  <StableImage
                    src={effectiveImageSrc || card.image || ''}
                    fallbackSrc={useOriginalImage && thumbSrc !== card.image ? thumbSrc : undefined}
                    alt={card.title || 'Web preview'}
                    className="absolute inset-0 w-full h-full object-contain pointer-events-none"
                    referrerPolicy="no-referrer"
                    loading={crispRender ? 'eager' : 'lazy'}
                    decoding="async"
                    fetchPriority={crispRender ? 'high' : 'auto'}
                    onLoad={handleImageLoad}
                    onError={handleImageError}
                    draggable={false}
                  />
                )}
              </div>
              {renderWebFooter(false)}
            </>
          ) : (
            renderWebFooter(true)
          )}
        </div>
      );

    case 'text':
    default:
      const shouldShowEditor = isSelected && (isEditingText || !card.content);
      return (
        <div
          data-card-detail-trigger onMouseEnter={onDescriptionHoverStart} onMouseLeave={onDescriptionHoverEnd}
          className="w-full h-full flex flex-col rounded-none overflow-hidden bg-paper text-ink"
          style={{
            color: card.textColor || undefined,
          }}
        >
          <div
            data-text-body
            className={`flex-1 min-h-0 flex flex-col overflow-hidden bg-paper font-medium ${isSelected ? 'pointer-events-auto' : 'pointer-events-none select-none'}`}
            style={{ padding: CARD_TEXT_INSET }}
            onMouseDown={(event) => {
              if (event.button === 0 && isSelected) {
                textPointerRef.current = { x: event.clientX, y: event.clientY, dragged: false };
              }
            }}
            onClick={() => {
              if (suppressTextClickRef.current) {
                suppressTextClickRef.current = false;
                return;
              }
              if (isSelected && !isEditingText) {
                startTextEditing();
              }
            }}
          >
            {shouldShowEditor ? (
              <textarea
                key={textEditorEpoch}
                ref={textInputRef}
                data-text-editor
                value={card.content || ''}
                readOnly={!isSelected}
                tabIndex={isSelected ? 0 : -1}
                placeholder="空白便签（支持 Markdown）"
                onFocus={onTextEditStart}
                onChange={(event) => handleTextChange(event.target.value)}
                onBlur={(event) => {
                  clearTextSelection(event.target);
                  finishTextEdit(event.target.value);
                  setIsEditingText(false);
                  onTextEditingSize?.(null);
                  setTextEditorEpoch((epoch) => epoch + 1);
                }}
                onMouseDown={(event) => { if (isSelected && !event.ctrlKey && !event.metaKey) event.stopPropagation(); }}
                onDoubleClick={(event) => event.stopPropagation()}
                onKeyDown={(event) => {
                  if (event.key === 'Escape') {
                    event.stopPropagation();
                    setIsEditingText(false);
                    textInputRef.current?.blur();
                  }
                }}
                className="w-full h-full min-h-0 bg-transparent text-ink text-[15px] leading-[1.40] font-retina font-normal text-left resize-none border-0 outline-none p-0 m-0 placeholder:text-ink/40 placeholder:italic overflow-auto select-text cursor-text"
                style={{ overflowWrap: 'anywhere', color: card.textColor || undefined }}
              />
            ) : (
              <div
                className="w-full h-full cursor-text overflow-hidden"
                onDoubleClick={(e) => {
                  e.stopPropagation();
                  startTextEditing();
                }}
              >
                {card.content ? (
                  <MarkdownView content={card.content} className="text-card-markdown" color={card.textColor || undefined} style={{ display: 'flow-root' }} />
                ) : (
                  <span className="italic opacity-40 text-[15px] leading-[1.40] font-retina font-normal select-none">空白便签（支持 Markdown）</span>
                )}
              </div>
            )}
          </div>
          {card.fileSource && <TextFileSource source={card.fileSource} selected={isSelected} onClick={onWebLinkClick} />}
          {card.tags && card.tags.length > 0 && (
            <div
              className="p-[5px] flex flex-wrap gap-[5px] border-t border-ink/20 bg-paper flex-shrink-0 select-none"
              style={{
                borderTopColor: card.borderColor ? `${card.borderColor}33` : undefined,
              }}
            >
              {card.tags.map((t) => (
                <span
                  key={t}
                  className="p-[5px] text-[11px] leading-[12px] font-bold uppercase tracking-[0.05em] text-ink bg-paper border border-ink/30 rounded-[10px] hover:bg-ink hover:text-paper transition-colors"
                  style={{
                    color: card.textColor || undefined,
                    borderColor: card.borderColor ? `${card.borderColor}4D` : undefined,
                  }}
                >
                  #{t}
                </span>
              ))}
            </div>
          )}
        </div>
      );
  }
};

const positionFields = new Set<keyof Card>(['x', 'y', 'zIndex']);
function sameBodyCard(previous: Card, next: Card) {
  if (previous === next) return true;
  const keys = new Set<keyof Card>([
    ...Object.keys(previous) as (keyof Card)[],
    ...Object.keys(next) as (keyof Card)[],
  ]);
  for (const key of keys) {
    if (!positionFields.has(key) && previous[key] !== next[key]) return false;
  }
  return true;
}

// Position belongs to the outer wrapper. Moving an image should reuse the
// existing image/body DOM instead of reconciling its contents every frame.
export const CardBodyContent = memo(CardBodyContentInner, (previous, next) =>
  sameBodyCard(previous.card, next.card) &&
  previous.isSelected === next.isSelected && previous.canvasImage === next.canvasImage &&
  previous.highQualityImage === next.highQualityImage && previous.crispRender === next.crispRender &&
  previous.contentScale === next.contentScale && previous.onUpdate === next.onUpdate && previous.onAutoSize === next.onAutoSize &&
  previous.handoffPending === next.handoffPending &&
  previous.onTextEdit === next.onTextEdit && previous.onTextEditStart === next.onTextEditStart &&
  previous.onTextEditingSize === next.onTextEditingSize && previous.onWebLinkClick === next.onWebLinkClick &&
  previous.onDescriptionHoverStart === next.onDescriptionHoverStart &&
  previous.onDescriptionHoverEnd === next.onDescriptionHoverEnd);
