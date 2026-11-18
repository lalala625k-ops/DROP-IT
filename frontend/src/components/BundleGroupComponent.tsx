import React from 'react';
import { branchStroke } from '../utils/branchColors';
import { Card, Group } from '../types';
import { bundleDisplayOutlinePoints, bundleResizeHandles, BundleResizeCorner } from '../hooks/useBundleGroups';
import { parseMarkdownHeading } from '../utils/headingUtils';
import { BundleCardStack } from './BundleCardStack';

interface Props {
  group: Group;
  members: Card[];
  selected: boolean;
  parentHighlighted?: boolean;
  accentColor?: string;
  branchColors?: ReadonlyMap<string, string>;
  onDrag: (event: React.MouseEvent) => void;
  onResize: (corner: BundleResizeCorner, event: React.MouseEvent) => void;
  onToggle: () => void;
  onMemberToFront: (cardId: string) => void;
  onHoverCard?: (cardId: string | null) => void;
  handoffPending?: boolean;
}

const BundleGroupComponentInner: React.FC<Props> = ({ group, members, selected, parentHighlighted = false, accentColor, branchColors, onDrag, onResize, onToggle, onMemberToFront, onHoverCard, handoffPending = false }) => {
  const tags = group.tags || [];
  const collapsed = !!group.collapsed;
  const parsedTitle = parseMarkdownHeading(group.title);
  const titleScale = (group.outlinePadding ?? 18) / 18;
  // App passes the already projected display group (including collapsed
  // stack bounds), so do not recompute the member geometry here.
  const bounds = group;
  const points = bundleDisplayOutlinePoints(members, group);
  const outline = `M ${points.map(point => `${point.x + group.x - bounds.x} ${point.y + group.y - bounds.y}`).join(' L ')} Z`;
  const topLeftOutlinePoint = (() => {
    const boxLeft = Math.min(...points.map((point) => point.x));
    const boxTop = Math.min(...points.map((point) => point.y));
    return points.reduce((best, point) => {
      const distance = (point.x - boxLeft) ** 2 + (point.y - boxTop) ** 2;
      const bestDistance = (best.x - boxLeft) ** 2 + (best.y - boxTop) ** 2;
      return distance < bestDistance ? point : best;
    });
  })();
  const topLeftButtonPoint = {
    x: topLeftOutlinePoint.x + group.x - bounds.x,
    y: topLeftOutlinePoint.y + group.y - bounds.y,
  };
  const openMenu = (event: React.MouseEvent) => {
    event.preventDefault();
    event.stopPropagation();
  };
  const handleOutlineMouseDown = (event: React.MouseEvent) => {
    if (event.button === 2) { event.preventDefault(); event.stopPropagation(); return; }
    onDrag(event);
  };

  return <div data-bundle-id={group.id} data-bundle-anchor={group.collapsedAnchor ?? 'nw'} className="absolute pointer-events-none z-[0]"
    style={{ left: bounds.x, top: bounds.y, width: bounds.width, height: bounds.height,
      backgroundColor: 'transparent', color: '#1d1d1d', '--branch-color': accentColor } as React.CSSProperties}>
    <svg className="absolute inset-0 w-full h-full overflow-visible pointer-events-none" viewBox={`0 0 ${bounds.width} ${bounds.height}`}>
      <path d={outline} fill="#ffffff" fillOpacity={handoffPending ? 0 : 0.2} stroke="transparent" strokeWidth="16" className="pointer-events-auto cursor-move"
        onMouseDown={handleOutlineMouseDown} onContextMenu={openMenu} />
      <path d={outline} fill="none" data-bundle-outline stroke={branchStroke(accentColor, selected || parentHighlighted)} strokeOpacity={selected || parentHighlighted ? 1 : 0.8} strokeWidth={parentHighlighted ? 4 : 2} strokeDasharray="7 5" pointerEvents="none" />
    </svg>
    {collapsed && <BundleCardStack branchColors={branchColors} group={group} members={members} offsetX={bounds.x} offsetY={bounds.y}
      onDrag={handleOutlineMouseDown} onFront={onMemberToFront} onHoverCard={onHoverCard} />}
    {!collapsed && selected && bundleResizeHandles(members, group).map(({ corner, point }) => (
      <button key={corner} type="button" data-resize-handle={corner} title={`拖动缩放 Group（${corner.toUpperCase()}）`}
        aria-label={`缩放 Group ${corner.toUpperCase()}`}
        className={`absolute z-40 h-3 w-3 -translate-x-1/2 -translate-y-1/2 border-2 border-ink bg-paper pointer-events-auto ${
          corner === 'nw' || corner === 'se' ? 'cursor-nwse-resize' : 'cursor-nesw-resize'
        }`}
        style={{ left: point.x, top: point.y }}
        onMouseDown={(event) => onResize(corner, event)} />
    ))}
    {parsedTitle.cleanText && <div data-bundle-motion-part="title" className="absolute bottom-full right-0 pointer-events-auto select-none cursor-move font-retina"
      style={{ left: 40 * titleScale, marginBottom: 6 * titleScale,
        fontSize: (parsedTitle.level === 2 ? 18 : 24) * titleScale,
        lineHeight: parsedTitle.level === 2 ? 1.2 : 1.15,
        fontWeight: parsedTitle.level === 2 ? 700 : 900 }}
      onMouseDown={handleOutlineMouseDown} onContextMenu={openMenu} title={parsedTitle.cleanText}>
      <span className="line-clamp-2">{parsedTitle.cleanText}</span>
    </div>}
    <button type="button" data-bundle-motion-part="toggle" className="absolute left-0 -top-9 w-7 h-7 rounded-none bg-paper border border-ink text-sm font-bold cursor-pointer pointer-events-auto"
      style={{ left: topLeftButtonPoint.x - 14, top: topLeftButtonPoint.y - 36, zIndex: members.length + 10 }}
      title={collapsed ? '展开 Group' : '收起 Group'}
      onMouseDown={(event) => event.stopPropagation()} onContextMenu={openMenu}
      onClick={(event) => { event.stopPropagation(); onToggle(); }}>{collapsed ? '▸' : '▾'}</button>
    {collapsed && !members.length && <div className="absolute inset-0 flex items-center justify-center text-xs pointer-events-none">空 Group</div>}
    {!collapsed && tags.length > 0 && <div className="absolute top-10 left-2 flex flex-wrap gap-1 pointer-events-none">
      {tags.map((tag) => <span key={tag} className="bg-stone px-1.5 py-0.5 text-[10px] font-bold">#{tag}</span>)}
    </div>}
  </div>;
};

export const BundleGroupComponent = React.memo(BundleGroupComponentInner, (previous, next) =>
  previous.group === next.group && previous.members === next.members &&
  previous.handoffPending === next.handoffPending &&
  previous.branchColors === next.branchColors && previous.accentColor === next.accentColor && previous.selected === next.selected && previous.parentHighlighted === next.parentHighlighted &&
  previous.onHoverCard === next.onHoverCard);
