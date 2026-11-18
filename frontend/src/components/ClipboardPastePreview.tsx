import { resolveBranchColors, branchStroke } from '../utils/branchColors';
import React, { useMemo } from 'react';
import { CanvasClipboardSnapshot, clipboardBounds } from '../utils/canvasClipboard';
import { bundleOutline } from '../hooks/useBundleGroups';
import { bundleDisplayOutlinePoints } from '../utils/bundleGeometry';
import { bundleTitleLayout } from '../utils/bundleStack';
import { bundleMemberTitle } from './BundleCardStack';
import { IMAGE_FOOTER_BACKGROUND, IMAGE_FOOTER_TEXT } from '../utils/cardLayout';
import { getBundleParentIds } from '../utils/groupRelations';
import { linkEndpoints } from '../utils/linkEndpoints';
import { buildOriginGeometries } from '../utils/originGeometry';
import { originFrame, ORIGIN_TITLE_GAP, ORIGIN_TITLE_HEIGHT, ORIGIN_TITLE_WIDTH } from '../utils/originFrame';
import { ORIGIN_STROKE_WIDTH } from '../utils/originStroke';
import { DirectionalLink } from './DirectionalLink';
import { parseMarkdownHeading } from '../utils/headingUtils';
import { PIN_PATH, PIN_SIZE } from '../utils/canvasPinGeometry';
import { SiteLogo } from './SiteLogo';
import { LocalFileIcon } from './LocalFileIcon';
import { LinkedImageCard } from './card/FoldedLinkCard';

interface Props {
  snapshot: CanvasClipboardSnapshot;
  screen: { x: number; y: number };
  zoom: number;
}

export const ClipboardPastePreview: React.FC<Props> = ({ snapshot, screen, zoom }) => {
  const bounds = useMemo(() => clipboardBounds(snapshot), [snapshot]);
  const origins = useMemo(() => buildOriginGeometries(snapshot.cards, snapshot.groups), [snapshot]);
  const cardById = useMemo(() => new Map(snapshot.cards.map((card) => [card.id, card])), [snapshot]);
  const colors = useMemo(() => resolveBranchColors(snapshot.cards, snapshot.groups), [snapshot]);
  if (!bounds) return null;
  const groups = new Map(snapshot.groups.map((group) => [group.id, group]));
  const links: { child: { x: number; y: number }; parent: { x: number; y: number };
    parentId: string; childId: string; origin: boolean }[] = [];
  const visibleNodes = [
    ...snapshot.cards.filter((card) => !card.bundleId || !groups.has(card.bundleId)),
    ...snapshot.groups.filter((group) => group.kind === 'bundle'),
  ];
  visibleNodes.forEach((node) => {
    const parentId = groups.has(node.id)
      ? getBundleParentIds(snapshot.cards, groups.get(node.id)!)[0] : (node as typeof snapshot.cards[number]).groupId;
    if (!parentId) return;
    const endpoints = linkEndpoints(parentId, node.id, snapshot.cards, snapshot.groups, origins);
    if (endpoints) {
      links.push({ child: endpoints.end, parent: endpoints.start, parentId,
        childId: node.id, origin: origins.has(parentId) });
    }
  });

  return <svg className="fixed z-[10001] pointer-events-none overflow-visible drop-shadow-lg"
    aria-hidden="true" style={{ left: screen.x - bounds.width * zoom / 2,
      top: screen.y - bounds.height * zoom / 2, width: bounds.width * zoom,
      height: bounds.height * zoom, opacity: 0.78 }}
    viewBox={`${bounds.x} ${bounds.y} ${bounds.width} ${bounds.height}`}>
    {links.map((link) => <DirectionalLink key={`${link.parentId}:${link.childId}`}
      child={link.child} parent={link.parent} childBounds={cardById.get(link.childId)}
      parentId={link.parentId} childId={link.childId} color={branchStroke(colors.get(link.parentId), true)}
      strokeWidth={link.origin ? ORIGIN_STROKE_WIDTH : 3} squareSize={7} />)}
    {snapshot.groups.filter((group) => group.kind === 'bundle').map((group) => {
      const members = snapshot.cards.filter((card) => card.bundleId === group.id);
      if (!group.collapsed) {
        return <path key={group.id} d={bundleOutline(members, group)}
          transform={`translate(${group.x} ${group.y})`} fill="#ffffff"
          fillOpacity="0.35" stroke={branchStroke(colors.get(group.id))} strokeOpacity="0.8" strokeWidth="2" strokeDasharray="7 5" />;
      }
      const stack = bundleTitleLayout(members, group);
      const outline = bundleDisplayOutlinePoints(members, group);
      const outlinePath = outline.map((point, index) =>
        `${index ? 'L' : 'M'} ${group.x + point.x} ${group.y + point.y}`).join(' ') + ' Z';
      return <g key={group.id}>
        <path d={outlinePath} fill="#ffffff" fillOpacity="0.2"
          stroke={branchStroke(colors.get(group.id))} strokeOpacity="0.8" strokeWidth="2" strokeDasharray="7 5" />
        {stack.pages.slice().reverse().map((page) => {
          const title = bundleMemberTitle(page.card);
          return <g key={page.card.id}>
            <rect x={page.x} y={page.y} width={page.width} height={page.height}
              fill={page.card.type === 'image' ? IMAGE_FOOTER_BACKGROUND : '#ffffff'}
              fillOpacity={page.card.type === 'image' ? 1 : 0.9} stroke={colors.get(page.card.id) || '#1d1d1d'} strokeOpacity="0.2" />
            <foreignObject x={page.x} y={page.y} width={page.width} height={page.height}>
              <div className="h-full flex items-center justify-end text-right overflow-hidden [&_svg]:text-inherit"
                style={{ padding: 2 * stack.scale, gap: 2 * stack.scale, fontSize: 11 * stack.scale, lineHeight: `${14 * stack.scale}px`,
                  color: page.card.type === 'image' ? IMAGE_FOOTER_TEXT : '#1d1d1d' }}>
                {page.card.type === 'image' && (page.card.fileSource || page.card.url) &&
                  <span className="shrink-0" style={{ width: 12 * stack.scale, height: 12 * stack.scale }}>
                    {page.card.fileSource ? <LocalFileIcon className="w-full h-full" />
                      : <SiteLogo url={page.card.url} favicon={page.card.favicon} className="w-full h-full" />}
                  </span>}
                <span className={`min-w-0 truncate ${page.card.type === 'image' ? 'flex-1' : ''}`}>{title}</span>
              </div>
            </foreignObject>
          </g>;
        })}
      </g>;
    })}
    {snapshot.cards.filter((card) => !card.bundleId || !groups.get(card.bundleId)?.collapsed)
      .map((card) => {
        const contentScale = card.contentScale ?? 1;
        if (card.type === 'image') return <foreignObject key={card.id} x={card.x} y={card.y}
          width={card.width} height={card.height}>
          <div style={{ width: card.width / contentScale, height: card.height / contentScale,
            transform: `scale(${contentScale})`, transformOrigin: 'top left',
            '--branch-color': colors.get(card.id) } as React.CSSProperties}>
            <LinkedImageCard card={card} imageSrc={card.image || ''} isSelected={false}
              canvasImage={false} crispRender={false} onImageLoad={() => {}} onImageError={() => {}}
              onWebLinkClick={() => {}} />
          </div>
        </foreignObject>;
        return <g key={card.id}>
          <rect x={card.x} y={card.y} width={card.width} height={card.height}
            fill="#ffffff" stroke={colors.get(card.id) || '#1d1d1d'} strokeWidth="2" />
          {card.image && card.type !== 'text'
            ? <image href={card.image} x={card.x + 3} y={card.y + 3}
              width={card.width - 6} height={Math.max(1, card.height - 6)} preserveAspectRatio="xMidYMid meet" />
            : <path d={`M ${card.x + 14} ${card.y + 20} h ${Math.max(0, card.width - 28)}
              M ${card.x + 14} ${card.y + 36} h ${Math.max(0, card.width * 0.65)}`}
              stroke="#1d1d1d" strokeWidth="3" opacity="0.5" />}
        </g>;
      })}
    {snapshot.groups.filter((group) => group.kind !== 'bundle').map((group) => {
      const geometry = origins.get(group.id)!;
      const frame = originFrame(geometry);
      const heading = parseMarkdownHeading(group.title);
      const level = heading.hasMarkdownPrefix ? heading.level : 0;
      return <g key={group.id} data-clipboard-origin={group.id}>
        <path d={frame.path} fill={frame.hasInterior ? colors.get(group.id) || '#1d1d1d' : 'none'} fillRule="evenodd"
          stroke={frame.hasInterior ? 'none' : colors.get(group.id) || '#1d1d1d'} strokeWidth={ORIGIN_STROKE_WIDTH} strokeLinejoin="miter" />
        {frame.hasInterior && <text x={frame.countCenter.x} y={frame.countCenter.y}
          textAnchor="middle" dominantBaseline="central" fill="#1d1d1d" fontSize="11" fontWeight="700" className="font-mono">
          {geometry.cardCount}
        </text>}
        <foreignObject x={frame.countCenter.x - ORIGIN_TITLE_WIDTH / 2}
          y={geometry.bounds.y + geometry.bounds.height + ORIGIN_TITLE_GAP}
          width={ORIGIN_TITLE_WIDTH} height={ORIGIN_TITLE_HEIGHT}>
          <div className="text-center text-ink font-retina break-words overflow-hidden tracking-tight"
            style={{ fontSize: level === 1 ? 20 : level === 2 ? 16 : 12, fontWeight: level === 1 ? 900 : 700,
              lineHeight: level === 1 ? 1.15 : 1.2, display: '-webkit-box', WebkitBoxOrient: 'vertical',
              WebkitLineClamp: level === 1 ? 2 : 3 }}>{heading.cleanText || group.title}</div>
          {!frame.hasInterior && <div className="text-center text-ink text-[11px] font-bold font-mono">{geometry.cardCount}</div>}
        </foreignObject>
      </g>;
    })}
    {(snapshot.pins || []).map((pin) => <g key={pin.id} transform={`translate(${pin.x - PIN_SIZE / 2} ${pin.y - PIN_SIZE / 2})`}>
      <path d={PIN_PATH} fill="#1d1d1d" />
      <circle cx="66.5" cy="66.5" r="9.5" fill="#1d1d1d" />
      <text x="66.5" y="66.5" textAnchor="middle" dominantBaseline="central" fill="#ffffff" fontSize="11">{pin.index}</text>
    </g>)}
  </svg>;
};
