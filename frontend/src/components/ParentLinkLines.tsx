import React from 'react';
import { branchStroke, resolveBranchColors } from '../utils/branchColors';
import { Card, Group } from '../types';
import { linkEndpoints } from '../utils/linkEndpoints';
import type { OriginGeometries } from '../utils/originGeometry';
import { ORIGIN_STROKE_WIDTH } from '../utils/originStroke';
import { DirectionalLink } from './DirectionalLink';
import { buildParentLinkTopology, projectParentLinks } from '../utils/parentLinkProjection';

export interface DragPreviewState {
  cardDx: number;
  cardDy: number;
  groupDx: number;
  groupDy: number;
  nodeOffsets: Map<string, { dx: number; dy: number }>;
}

function bundleLinkProgress(memberCount: number): number {
  return Math.min(Math.max(memberCount - 1, 0), 9) / 9;
}

export interface InteractiveWire {
  startX: number;
  startY: number;
  targetX: number;
  targetY: number;
  sourceCardId: string;
  isSnapping?: boolean;
}

interface ParentLinkLinesProps {
  groups: Group[];
  branchColors?: ReadonlyMap<string, string>;
  origins: OriginGeometries;
  cards: Card[];
  selectedGroupIds: Set<string>;
  selectedCardIds: Set<string>;
  dragOverGroupId: string | null;
  interactiveWire?: InteractiveWire | null;
  visibleCardIdSet?: Set<string>;
  dragPreviewRef?: React.MutableRefObject<DragPreviewState>;
  dragPreviewActive?: boolean;
}

export const ParentLinkLines = React.memo(function ParentLinkLines({
  groups,
  branchColors,
  origins,
  cards,
  selectedGroupIds,
  selectedCardIds,
  dragOverGroupId,
  interactiveWire,
  visibleCardIdSet,
  dragPreviewRef,
  dragPreviewActive = false,
}: ParentLinkLinesProps) {
  const fallbackColors = React.useMemo(() => branchColors || resolveBranchColors(cards, groups), [branchColors, cards, groups]);
  // Dragging uses direct DOM transforms for cards/groups to keep image-heavy
  // canvases responsive. Keep the lightweight link layer in sync through its
  // own frame loop instead of forcing the whole canvas through React renders.
  const [previewTick, setPreviewTick] = React.useState(0);
  const previewOffsets = dragPreviewActive && dragPreviewRef?.current.nodeOffsets.size
    ? dragPreviewRef.current.nodeOffsets : null;
  React.useEffect(() => {
    if (!dragPreviewActive || !dragPreviewRef) return;
    let frame: number | null = null;
    let lastOffsets = previewOffsets;
    const tick = () => {
      const offsets = dragPreviewRef.current.nodeOffsets;
      const nextOffsets = offsets.size ? offsets : null;
      if (nextOffsets !== lastOffsets) {
        lastOffsets = nextOffsets;
        setPreviewTick((value) => value + 1);
      }
      frame = window.requestAnimationFrame(tick);
    };
    frame = window.requestAnimationFrame(tick);
    return () => { if (frame !== null) window.cancelAnimationFrame(frame); };
  }, [dragPreviewActive, dragPreviewRef]);

  const topology = React.useMemo(() => buildParentLinkTopology(cards, groups), [cards, groups]);
  const { cards: renderCards, groups: renderGroups, origins: renderOrigins, lookup } = React.useMemo(() =>
    projectParentLinks(topology, origins, previewOffsets), [topology, origins, previewOffsets, previewTick]);
  const { parentById, links: baseLinks } = topology;

  const selectedBranches = React.useMemo(() => {
    const selected = new Set<string>();
    for (const link of baseLinks) {
      const seen = new Set<string>();
      let current: string | null = link.childId;
      while (current && !seen.has(current)) {
        if (selectedCardIds.has(current) || selectedGroupIds.has(current)) { selected.add(link.childId); break; }
        seen.add(current);
        current = parentById.get(current) || null;
      }
    }
    return selected;
  }, [baseLinks, parentById, selectedCardIds, selectedGroupIds]);

  const links = React.useMemo(() => baseLinks.filter((link) => link.bundleMemberCount !== undefined || !visibleCardIdSet ||
    visibleCardIdSet.has(link.childId) || selectedCardIds.has(link.childId) ||
    selectedCardIds.has(link.parentId) || selectedGroupIds.has(link.parentId)).map((link) => {
      const endpoints = linkEndpoints(link.parentId, link.childId, renderCards, renderGroups, renderOrigins, lookup);
      if (!endpoints) return null;
      return {
        ...link,
        gx: endpoints.start.x,
        gy: endpoints.start.y,
        cx: endpoints.end.x,
        cy: endpoints.end.y,
        isSelected: selectedBranches.has(link.childId),
        isHighlighted: selectedBranches.has(link.childId) || dragOverGroupId === link.parentId || dragOverGroupId === link.childId,
      };
    }).filter((link): link is NonNullable<typeof link> => link !== null),
  [baseLinks, visibleCardIdSet, selectedCardIds, selectedGroupIds, renderCards, renderGroups, renderOrigins,
    lookup, selectedBranches, dragOverGroupId]);

  if (links.length === 0 && !interactiveWire) return null;

  return (
    <svg className="absolute inset-0 pointer-events-none overflow-visible w-full h-full z-0">
      {links.map((link) => {
        const isBold = link.isSelected || link.isHighlighted;
        const progress = link.bundleMemberCount === undefined ? 0 : bundleLinkProgress(link.bundleMemberCount);
        const strokeColor = branchStroke(fallbackColors.get(link.parentId), isBold, link.bundleMemberCount);
        const strokeWidth = isBold ? ORIGIN_STROKE_WIDTH : link.bundleMemberCount === undefined ? 1 : 1 + progress;
        const origin = renderOrigins.get(link.parentId);

        return (
          <g key={`${link.parentId}-${link.childId}`} opacity={isBold && origin ? 1 : 0.8}>
            <DirectionalLink child={{ x: link.cx, y: link.cy }} parent={{ x: link.gx, y: link.gy }}
              childBounds={lookup.cardById?.get(link.childId)} color={strokeColor}
              strokeWidth={strokeWidth} squareSize={isBold ? 7 : 5}
              parentId={link.parentId} childId={link.childId} />
          </g>
        );
      })}

      {interactiveWire && (
        <DirectionalLink child={{ x: interactiveWire.startX, y: interactiveWire.startY }}
          parent={{ x: interactiveWire.targetX, y: interactiveWire.targetY }}
          childBounds={lookup.cardById?.get(interactiveWire.sourceCardId)} color={fallbackColors.get(interactiveWire.sourceCardId) || '#1d1d1d'}
          strokeWidth={interactiveWire.isSnapping ? 3.5 : 2} squareSize={7} />
      )}
    </svg>
  );
});
