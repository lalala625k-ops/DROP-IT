import React, { useState, useRef, useEffect, useMemo } from 'react';
import { Group } from '../types';
import { parseMarkdownHeading } from '../utils/headingUtils';
import { OriginGeometry, originPoints } from '../utils/originGeometry';
import { originFrame, ORIGIN_TITLE_WIDTH, ORIGIN_TITLE_GAP } from '../utils/originFrame';
import { ORIGIN_STROKE_WIDTH } from '../utils/originStroke';

interface GroupComponentProps {
  group: Group;
  geometry: OriginGeometry;
  isSelected: boolean;
  accentColor?: string;
  childCount: number;
  isDragOver: boolean;
  onSelect: (e: React.MouseEvent) => void;
  onRename: (id: string, newTitle: string) => void;
  onUngroup?: (id: string) => void;
}

const GroupComponentInner: React.FC<GroupComponentProps> = ({
  group,
  geometry,
  isSelected,
  accentColor,
  childCount,
  isDragOver,
  onSelect,
  onRename,
  onUngroup,
}) => {
  const [isEditingTitle, setIsEditingTitle] = useState(false);
  const [title, setTitle] = useState(group.title);
  const inputRef = useRef<HTMLInputElement>(null);

  const size = group.width || 120;
  const frame = useMemo(() => originFrame(geometry), [geometry]);
  const countCenter = frame.countCenter;
  const captionX = countCenter.x - group.x;
  const captionY = geometry.bounds.y + geometry.bounds.height - group.y + ORIGIN_TITLE_GAP;

  useEffect(() => {
    setTitle(group.title);
  }, [group.title]);

  useEffect(() => {
    if (isEditingTitle && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [isEditingTitle]);

  const handleFinishRename = () => {
    setIsEditingTitle(false);
    if (title.trim() && title !== group.title) {
      onRename(group.id, title.trim());
    } else {
      setTitle(group.title);
    }
  };

  return (
    <div
      data-group-id={group.id}
      title="拖动时整体移动关联卡片；Ctrl 拖动仅移动原点；双击重命名"
      className="origin-node group absolute top-0 left-0 select-none text-ink pointer-events-none"
      data-origin-branches={geometry.branches.length}
      data-origin-size-scale={geometry.sizeScale}
      data-origin-selected={isSelected}
      style={{
        transform: `translate(${group.x}px, ${group.y}px)`,
        width: size,
        height: size,
        zIndex: group.zIndex ?? 5,
        willChange: 'transform',
      } as React.CSSProperties}
      onMouseDown={(e) => {
        if (e.button !== 0) return;
        e.stopPropagation();
        onSelect(e);
      }}
      onDoubleClick={(e) => {
        e.stopPropagation();
        setIsEditingTitle(true);
      }}
      onContextMenu={(e) => {
        e.preventDefault();
        e.stopPropagation();
      }}
    >
      <svg className="absolute overflow-visible" width={size} height={size}
        style={{ left: 0, top: 0 }} viewBox={`${group.x} ${group.y} ${size} ${size}`}>
        {geometry.vertices.length
          ? <polygon data-origin-hit points={originPoints(geometry)} fill="transparent"
              style={{ pointerEvents: 'fill' }} className="cursor-grab active:cursor-grabbing" />
          : <circle data-origin-hit cx={geometry.center.x} cy={geometry.center.y} r={geometry.baseRadius}
              fill="transparent" style={{ pointerEvents: 'fill' }} className="cursor-grab active:cursor-grabbing" />}
        <path data-origin-shape={geometry.vertices.length ? 'polygon' : 'circle'}
          data-outer-points={geometry.vertices.length ? originPoints(geometry) : undefined}
          d={frame.path} fill={frame.hasInterior ? accentColor || '#1d1d1d' : 'none'} fillRule="evenodd"
          stroke={frame.hasInterior ? 'none' : accentColor || '#1d1d1d'} strokeWidth={ORIGIN_STROKE_WIDTH} strokeLinejoin="miter"
          style={{ pointerEvents: 'none' }} />
        {!isDragOver && frame.hasInterior && <text data-origin-count
          x={countCenter.x} y={countCenter.y} textAnchor="middle" dominantBaseline="central"
          fill="#1d1d1d" fontSize={11} fontWeight={700} className="font-mono pointer-events-none">
          {childCount}
        </text>}
      </svg>
      {/* Dissolve / Delete button on hover */}
      {onUngroup && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onUngroup(group.id);
          }}
          title="解散原点 (保留子卡片)"
          className="absolute w-4 h-4 rounded-full bg-paper text-ink border border-ink hover:bg-ink hover:text-paper flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity z-30 cursor-pointer pointer-events-auto"
          style={{ left: geometry.bounds.x + geometry.bounds.width - group.x - 8, top: geometry.bounds.y - group.y - 8 }}
        >
          <svg className="w-2 h-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      )}

      {isDragOver && <div className="absolute pointer-events-none" style={{
        left: countCenter.x - group.x - 12, top: countCenter.y - group.y - 12,
      }}><svg className="w-6 h-6 text-ink" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M19 14l-7 7m0 0l-7-7m7 7V3" />
      </svg></div>}
      <div data-origin-caption className="absolute flex flex-col items-center gap-1 text-center pointer-events-auto cursor-grab active:cursor-grabbing"
        style={{ left: captionX, top: captionY, width: ORIGIN_TITLE_WIDTH, transform: 'translateX(-50%)' }}>
          {isEditingTitle ? (
            <input
              ref={inputRef}
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              onBlur={handleFinishRename}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleFinishRename();
                if (e.key === 'Escape') {
                  setTitle(group.title);
                  setIsEditingTitle(false);
                }
              }}
              className="w-full px-1 py-0.5 text-[11px] font-bold text-center text-ink bg-paper border border-ink rounded-[10px] outline-none font-retina pointer-events-auto"
              onClick={(e) => e.stopPropagation()}
              onMouseDown={(e) => e.stopPropagation()}
            />
          ) : (() => {
            const parsedHeading = parseMarkdownHeading(group.title);
            const isL1 = parsedHeading.hasMarkdownPrefix && parsedHeading.level === 1;
            const isL2 = parsedHeading.hasMarkdownPrefix && parsedHeading.level === 2;
            const headingSize = isL1 ? '20px' : isL2 ? '16px' : '12px';
            const headingWeight = isL1 ? 900 : 700;
            const headingLeading = isL1 ? 1.15 : 1.2;
            return (
              <div
                className="w-full overflow-hidden break-words font-retina tracking-tight"
                style={{
                  display: '-webkit-box',
                  WebkitBoxOrient: 'vertical',
                  WebkitLineClamp: isL1 ? 2 : 3,
                  fontSize: headingSize,
                  fontWeight: headingWeight,
                  lineHeight: headingLeading,
                }}
                title={parsedHeading.cleanText || group.title}
              >
                {parsedHeading.cleanText || group.title}
              </div>
            );
          })()}
          {!frame.hasInterior && <div className="text-[11px] leading-none font-bold font-mono">{childCount}</div>}
      </div>
    </div>
  );
};

export const GroupComponent = React.memo(GroupComponentInner, (previous, next) =>
  previous.accentColor === next.accentColor && previous.group === next.group && previous.isSelected === next.isSelected &&
  previous.geometry === next.geometry &&
  previous.childCount === next.childCount && previous.isDragOver === next.isDragOver);
