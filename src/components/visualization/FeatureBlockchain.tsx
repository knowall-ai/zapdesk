'use client';

import { useState, useRef, useCallback, useMemo, useEffect } from 'react';
import { ExternalLink } from 'lucide-react';
import type { Feature, WorkItem, TicketPriority } from '@/types';
import { WorkItemBoard, WORKITEM_COLUMNS } from '@/components/tickets';

// Format hours to avoid floating-point precision issues (e.g., 3.199999999 -> "3.2")
function formatHours(value: number): string {
  return Number(value.toFixed(1)).toString();
}

// Grid-based bin-packing layout (like mempool.space)
// Packs work items into rows on a fixed grid
interface BlockRect {
  x: number;
  y: number;
  width: number;
  height: number;
  item: WorkItem;
}

// Filter to only leaf work items (exclude container types like User Story, Feature, Epic)
const containerTypes = new Set(['user story', 'feature', 'epic']);

function isLeafWorkItem(item: WorkItem): boolean {
  const type = (item.workItemType || '').toLowerCase();
  return !containerTypes.has(type);
}

// Grid-based bin-packing like mempool.space
// fillPercentage affects grid sizing: 100% = items fill container, 50% = items fill half
function layoutBlocks(
  items: WorkItem[],
  containerSize: number,
  fillPercentage: number | null
): BlockRect[] {
  const leafItems = items.filter(isLeafWorkItem);
  if (leafItems.length === 0) return [];

  // Fixed 2px padding (creates 4px gaps between adjacent blocks)
  const padding = 2;

  // Clamp fill percentage: minimum 10%, cap at 100% for grid calculation
  const targetFill = Math.min(100, Math.max(10, fillPercentage ?? 100)) / 100;

  // Calculate block sizes based on work hours using specific thresholds
  // Size relationships: 0.5-1h is 4x area of 0-0.25h, 6-8h is 4x area of 2-4h
  const itemsWithSize = leafItems.map((item) => {
    const hours = (item.completedWork || 0) + (item.remainingWork || 0);
    // Thresholds with 4x area jumps: size 1→2 (4x area), size 4→8 (4x area), size 8→16 (4x area)
    let size: number;
    if (hours <= 0.25) {
      size = 1; // 0 - 0.25h
    } else if (hours <= 0.5) {
      size = 1; // 0.25 - 0.5h
    } else if (hours <= 1) {
      size = 2; // 0.5 - 1h (4x area of 0-0.25h)
    } else if (hours <= 2) {
      size = 3; // 1 - 2h
    } else if (hours <= 4) {
      size = 4; // 2 - 4h
    } else if (hours <= 6) {
      size = 6; // 4 - 6h
    } else if (hours <= 8) {
      size = 8; // 6 - 8h (4x area of 2-4h)
    } else {
      size = 16; // 8h+ (4x area of 6-8h)
    }
    return { item, size, hours };
  });

  // Calculate total grid cells needed
  const totalCells = itemsWithSize.reduce((sum, { size }) => sum + size * size, 0);

  // Find largest item to determine minimum grid size
  const maxItemSize = Math.max(...itemsWithSize.map((i) => i.size));

  // Grid size based on fill percentage:
  // - 100% fill: grid = sqrt(totalCells) so items fill the container
  // - 50% fill: grid = sqrt(totalCells/0.5) so items fill half the container
  const gridForFill = Math.ceil(Math.sqrt(totalCells / targetFill));
  // Minimum grid must fit the largest item, maximum 32
  const gridColumns = Math.max(maxItemSize, Math.min(32, gridForFill));

  const gridSize = containerSize / gridColumns; // Size of each grid cell

  // Sort by size descending (largest first, like mempool)
  itemsWithSize.sort((a, b) => b.size - a.size);

  // Track which grid cells are occupied (use more rows for overflow)
  const gridRows = gridColumns * 2; // Allow vertical overflow for placement
  const grid: boolean[][] = Array.from({ length: gridRows }, () => Array(gridColumns).fill(false));

  const rects: BlockRect[] = [];

  // Place each item using first-fit algorithm (top-down initially)
  for (const { item, size } of itemsWithSize) {
    const actualSize = Math.min(size, gridColumns);
    let placed = false;

    // Scan grid for first available position
    for (let row = 0; row <= gridRows - actualSize && !placed; row++) {
      for (let col = 0; col <= gridColumns - actualSize && !placed; col++) {
        let canFit = true;
        for (let r = row; r < row + actualSize && canFit; r++) {
          for (let c = col; c < col + actualSize && canFit; c++) {
            if (grid[r][c]) canFit = false;
          }
        }

        if (canFit) {
          for (let r = row; r < row + actualSize; r++) {
            for (let c = col; c < col + actualSize; c++) {
              grid[r][c] = true;
            }
          }

          // Create rect with padding for 4px gaps
          rects.push({
            x: col * gridSize + padding,
            y: row * gridSize + padding,
            width: actualSize * gridSize - padding * 2,
            height: actualSize * gridSize - padding * 2,
            item,
          });
          placed = true;
        }
      }
    }

    if (!placed) {
      console.warn(`Could not place work item ${item.id} in grid`);
    }
  }

  // Flip Y axis so full rows are at bottom, gaps at top
  // Then shift to bottom of container
  if (rects.length > 0) {
    const maxYExtent = Math.max(...rects.map((r) => r.y + r.height + padding));

    // Flip Y: items placed first (full rows) go to bottom, last row (may have gaps) goes to top
    for (const rect of rects) {
      rect.y = maxYExtent - rect.y - rect.height - padding * 2;
    }

    // Now shift everything to bottom of container
    const newMaxY = Math.max(...rects.map((r) => r.y + r.height + padding));
    const shiftAmount = containerSize - newMaxY;
    if (shiftAmount > 0) {
      for (const rect of rects) {
        rect.y += shiftAmount;
      }
    }
  }

  return rects;
}

interface EpicInfo {
  id: number;
  title: string;
  state: string;
  description?: string;
  completedWork: number;
  remainingWork: number;
  devOpsUrl: string;
}

interface FeatureTimechainProps {
  features: Feature[];
  epic?: EpicInfo;
  onFeatureClick?: (feature: Feature) => void;
}

// Map Feature state to category: New, In Progress, Done
function getStateCategory(state: string): 'new' | 'inProgress' | 'done' {
  const normalizedState = state.toLowerCase();
  if (normalizedState === 'done' || normalizedState === 'closed' || normalizedState === 'removed') {
    return 'done';
  }
  if (
    normalizedState === 'active' ||
    normalizedState === 'in progress' ||
    normalizedState === 'doing' ||
    normalizedState === 'resolved'
  ) {
    return 'inProgress';
  }
  return 'new';
}

// Color scheme: Purple (Done), Green (In Progress), Grey (New)
interface BlockColors {
  gradient: string;
  accent: string;
  topFace: string;
  rightFace: string;
  border: string;
  text: string;
  subtext: string;
}

function getStateColors(state: string): BlockColors {
  const category = getStateCategory(state);
  switch (category) {
    case 'done':
      return {
        gradient: 'linear-gradient(180deg, #1e1b4b 0%, #312e81 100%)',
        accent: '#a78bfa',
        topFace: '#4c1d95',
        rightFace: '#1e1b4b',
        border: '#6366f1',
        text: '#c4b5fd',
        subtext: '#a78bfa',
      };
    case 'inProgress':
      return {
        gradient: 'linear-gradient(180deg, #052e16 0%, #14532d 100%)',
        accent: '#4ade80',
        topFace: '#166534',
        rightFace: '#052e16',
        border: '#22c55e',
        text: '#bbf7d0',
        subtext: '#4ade80',
      };
    case 'new':
    default:
      return {
        gradient: 'linear-gradient(180deg, #1f2937 0%, #374151 100%)',
        accent: '#9ca3af',
        topFace: '#4b5563',
        rightFace: '#1f2937',
        border: '#6b7280',
        text: '#d1d5db',
        subtext: '#9ca3af',
      };
  }
}

// Selected state colors - glow color based on category
interface SelectedColors {
  topFace: string;
  leftFace: string;
  gradient: string;
  border: string;
  glow: string;
  accent: string;
  text: string;
}

function getSelectedColors(category: 'new' | 'inProgress' | 'done'): SelectedColors {
  switch (category) {
    case 'done':
      // Purple glow for Done blocks
      return {
        topFace: '#c084fc', // purple-400
        leftFace: '#7c3aed', // purple-600
        gradient: 'linear-gradient(180deg, #4c1d95 0%, #2e1065 100%)',
        border: '#a855f7', // purple-500
        glow: '0 0 30px rgba(168, 85, 247, 0.5)',
        accent: '#c084fc',
        text: '#e9d5ff',
      };
    case 'inProgress':
      // Green glow for Active blocks
      return {
        topFace: '#4ade80', // green-400
        leftFace: '#15803d', // green-700
        gradient: 'linear-gradient(180deg, #14532d 0%, #052e16 100%)',
        border: '#22c55e', // green-500
        glow: '0 0 30px rgba(34, 197, 94, 0.5)',
        accent: '#4ade80',
        text: '#bbf7d0',
      };
    case 'new':
    default:
      // Grey glow for New blocks
      return {
        topFace: '#9ca3af', // gray-400
        leftFace: '#4b5563', // gray-600
        gradient: 'linear-gradient(180deg, #374151 0%, #1f2937 100%)',
        border: '#6b7280', // gray-500
        glow: '0 0 30px rgba(107, 114, 128, 0.5)',
        accent: '#9ca3af',
        text: '#e5e7eb',
      };
  }
}

// Calculate fill percentage based on completedWork vs effort
// Returns null if effort is not set (can't calculate percentage)
// Can exceed 100% if more work completed than estimated
function calculateFillPercentage(feature: Feature): number | null {
  // Effort is required to calculate percentage
  if (!feature.effort || feature.effort === 0) {
    return null;
  }
  return (feature.completedWork / feature.effort) * 100;
}

export default function FeatureTimechain({
  features,
  epic,
  onFeatureClick,
}: FeatureTimechainProps) {
  // Initialize with first Active feature, or fall back to first feature
  const [selectedFeature, setSelectedFeature] = useState<Feature | null>(() => {
    const firstActive = features.find((f) => f.state === 'Active');
    return firstActive || features[0] || null;
  });
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const blockRefs = useRef<Map<number, HTMLDivElement>>(new Map());
  const [isDragging, setIsDragging] = useState(false);
  const [startX, setStartX] = useState(0);
  const [scrollLeft, setScrollLeft] = useState(0);

  // Scroll to selected feature on initial load (with small delay to ensure refs are populated)
  useEffect(() => {
    const featureId = selectedFeature?.id;
    if (!featureId) return;

    const timer = setTimeout(() => {
      const blockEl = blockRefs.current.get(featureId);
      blockEl?.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
    }, 100);

    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // Only run once on mount

  // Block grid dimensions (square)
  const gridContainerSize = 400;

  // Calculate grid-based block layout for selected feature's work items
  const blockRects = useMemo(() => {
    if (!selectedFeature) return [];
    const fillPct = calculateFillPercentage(selectedFeature);
    return layoutBlocks(selectedFeature.workItems, gridContainerSize, fillPct);
  }, [selectedFeature]);

  const handleBlockClick = (feature: Feature) => {
    // Always select clicked feature (don't allow deselection)
    setSelectedFeature(feature);
    onFeatureClick?.(feature);
  };

  // Drag-to-scroll handlers
  const handleMouseDown = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    if (!scrollContainerRef.current) return;
    setIsDragging(true);
    setStartX(e.pageX - scrollContainerRef.current.offsetLeft);
    setScrollLeft(scrollContainerRef.current.scrollLeft);
  }, []);

  const handleMouseMove = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      if (!isDragging || !scrollContainerRef.current) return;
      e.preventDefault();
      const x = e.pageX - scrollContainerRef.current.offsetLeft;
      const walk = (x - startX) * 2;
      scrollContainerRef.current.scrollLeft = scrollLeft - walk;
    },
    [isDragging, startX, scrollLeft]
  );

  const handleMouseUp = useCallback(() => {
    setIsDragging(false);
  }, []);

  const handleMouseLeave = useCallback(() => {
    setIsDragging(false);
  }, []);

  const blockSize = 130; // Cube dimensions (equal width and height)
  const blockWidth = blockSize;
  const blockHeight = blockSize;
  const depth = 18; // 3D depth like mempool

  return (
    <div className="space-y-6">
      {/* Epic description above timechain */}
      {epic?.description && (
        <p
          className="text-sm leading-relaxed"
          style={{ color: 'var(--text-secondary)' }}
          dangerouslySetInnerHTML={{
            __html: epic.description.replace(/<[^>]*>/g, ''),
          }}
        />
      )}

      {/* Timechain */}
      <div
        ref={scrollContainerRef}
        className="-mx-6 overflow-x-auto px-6"
        style={{
          cursor: isDragging ? 'grabbing' : 'grab',
          scrollbarWidth: 'none',
          msOverflowStyle: 'none',
          userSelect: 'none',
          WebkitUserSelect: 'none',
        }}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseLeave}
      >
        <style>{`.timechain-scroll::-webkit-scrollbar { display: none; }`}</style>
        <div
          className="timechain-scroll flex items-start gap-5 py-6"
          style={{ minWidth: 'max-content' }}
        >
          {features.map((feature) => {
            const fillPercentage = calculateFillPercentage(feature);
            const isSelected = selectedFeature?.id === feature.id;
            const colors = getStateColors(feature.state);
            const category = getStateCategory(feature.state);
            const selectedColors = getSelectedColors(category);

            return (
              <div
                key={feature.id}
                ref={(el) => {
                  if (el) blockRefs.current.set(feature.id, el);
                }}
                className="flex flex-col items-center"
              >
                <div
                  className="mb-3 font-mono text-base font-semibold tracking-wide"
                  style={{ color: isSelected ? selectedColors.border : '#e5e7eb' }}
                >
                  {feature.id}
                </div>

                <button
                  onClick={() => handleBlockClick(feature)}
                  className="relative transition-all duration-200"
                  style={{
                    width: blockWidth + depth,
                    height: blockHeight + depth,
                    transform: isSelected ? 'scale(1.05)' : 'scale(1)',
                    cursor: 'pointer',
                  }}
                >
                  {/* Top face - parallelogram going back-left */}
                  <div
                    className="absolute"
                    style={{
                      width: blockWidth,
                      height: depth,
                      top: 0,
                      left: depth,
                      background: isSelected ? selectedColors.topFace : colors.topFace,
                      transform: 'skewX(45deg)',
                      transformOrigin: 'bottom left',
                    }}
                  />

                  {/* Left face - parallelogram going back-left */}
                  <div
                    className="absolute"
                    style={{
                      width: depth,
                      height: blockHeight,
                      top: depth,
                      left: 0,
                      background: isSelected ? selectedColors.leftFace : colors.rightFace,
                      transform: 'skewY(45deg)',
                      transformOrigin: 'top right',
                    }}
                  />

                  {/* Main face */}
                  <div
                    className="absolute overflow-hidden"
                    style={{
                      width: blockWidth,
                      height: blockHeight,
                      top: depth,
                      left: depth,
                      background: isSelected ? selectedColors.gradient : colors.gradient,
                      border: isSelected
                        ? `2px solid ${selectedColors.border}`
                        : `1px solid ${colors.border}`,
                      boxShadow: isSelected ? selectedColors.glow : '0 8px 24px rgba(0,0,0,0.5)',
                    }}
                  >
                    <div className="flex h-full flex-col p-3">
                      <div
                        className="mb-2 text-xs font-medium tracking-wider uppercase"
                        style={{ color: isSelected ? selectedColors.accent : colors.accent }}
                      >
                        {category === 'done'
                          ? 'Done'
                          : category === 'inProgress'
                            ? 'Active'
                            : 'New'}
                      </div>

                      <div className="mb-1">
                        <span
                          className="text-2xl font-bold"
                          style={{ color: isSelected ? selectedColors.text : colors.text }}
                        >
                          {feature.workItems.filter(isLeafWorkItem).length}
                        </span>
                        <span
                          className="ml-1 text-sm"
                          style={{ color: isSelected ? selectedColors.accent : colors.subtext }}
                        >
                          items
                        </span>
                      </div>

                      <div
                        className="text-sm"
                        style={{ color: isSelected ? selectedColors.accent : colors.subtext }}
                      >
                        {formatHours(feature.completedWork)}h
                        {feature.effort ? ` / ${formatHours(feature.effort)}h` : ' completed'}
                      </div>

                      <div
                        className="mt-auto text-lg font-semibold"
                        style={{ color: isSelected ? selectedColors.accent : colors.accent }}
                      >
                        {fillPercentage !== null ? `${fillPercentage.toFixed(0)}%` : '—'}
                      </div>

                      <div
                        className="mt-2 h-1 w-full overflow-hidden rounded-full"
                        style={{ backgroundColor: 'rgba(0,0,0,0.3)' }}
                      >
                        <div
                          className="h-full rounded-full transition-all duration-500"
                          style={{
                            width: `${Math.min(fillPercentage ?? 0, 100)}%`,
                            backgroundColor: isSelected ? selectedColors.border : colors.accent,
                          }}
                        />
                      </div>
                    </div>
                  </div>
                </button>

                <div
                  className="mt-4 flex items-center gap-1"
                  style={{ maxWidth: blockWidth + depth, paddingLeft: depth }}
                  title={feature.title}
                >
                  <span
                    className="h-2 w-2 shrink-0 rounded-full"
                    style={{ backgroundColor: isSelected ? selectedColors.border : colors.accent }}
                  />
                  <span
                    className="truncate text-xs font-medium"
                    style={{ color: isSelected ? selectedColors.border : '#9ca3af' }}
                  >
                    {feature.title}
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Two-column layout: Feature details panel (narrow) on left, work items list (wide) on right */}
      {selectedFeature ? (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
          {/* Left column: Feature Details panel (1/3 width) */}
          <div
            className="rounded-lg p-4 lg:col-span-1"
            style={{ backgroundColor: 'var(--surface)', border: '1px solid var(--border)' }}
          >
            {/* Feature header */}
            <div className="mb-4 flex items-start justify-between">
              <div>
                <div className="mb-2 flex items-center gap-2">
                  <span
                    className="rounded px-2 py-0.5 text-xs font-medium"
                    style={{
                      backgroundColor:
                        getStateCategory(selectedFeature.state) === 'done'
                          ? 'rgba(139, 92, 246, 0.2)'
                          : getStateCategory(selectedFeature.state) === 'inProgress'
                            ? 'rgba(34, 197, 94, 0.2)'
                            : 'rgba(156, 163, 175, 0.2)',
                      color:
                        getStateCategory(selectedFeature.state) === 'done'
                          ? '#a78bfa'
                          : getStateCategory(selectedFeature.state) === 'inProgress'
                            ? '#22c55e'
                            : '#9ca3af',
                    }}
                  >
                    {selectedFeature.state}
                  </span>
                  <span className="font-mono text-xs" style={{ color: 'var(--text-muted)' }}>
                    #{selectedFeature.id}
                  </span>
                </div>
                <h3 className="text-lg font-semibold" style={{ color: 'var(--text-primary)' }}>
                  {selectedFeature.title}
                </h3>
              </div>
              <a
                href={selectedFeature.devOpsUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="flex shrink-0 items-center gap-1 rounded-lg px-3 py-2 text-sm"
                style={{ backgroundColor: 'var(--primary)', color: 'white' }}
              >
                DevOps <ExternalLink size={12} />
              </a>
            </div>

            {/* Feature description */}
            {selectedFeature.description && (
              <p
                className="mb-4 text-sm leading-relaxed"
                style={{ color: 'var(--text-muted)' }}
                dangerouslySetInnerHTML={{
                  __html: selectedFeature.description.replace(/<[^>]*>/g, '').slice(0, 300),
                }}
              />
            )}

            {/* Feature stats */}
            <div
              className="mb-4 grid grid-cols-3 gap-3 rounded-lg p-3"
              style={{ backgroundColor: 'var(--background)' }}
            >
              <div>
                <p className="text-xs uppercase" style={{ color: 'var(--text-muted)' }}>
                  Items
                </p>
                <p className="text-lg font-bold" style={{ color: 'var(--text-primary)' }}>
                  {selectedFeature.workItems.filter(isLeafWorkItem).length}
                </p>
              </div>
              <div>
                <p className="text-xs uppercase" style={{ color: 'var(--text-muted)' }}>
                  Completed
                </p>
                <p className="text-lg font-bold" style={{ color: 'var(--primary)' }}>
                  {formatHours(selectedFeature.completedWork)}h
                </p>
              </div>
              <div>
                <p className="text-xs uppercase" style={{ color: 'var(--text-muted)' }}>
                  Effort
                </p>
                <p className="text-lg font-bold" style={{ color: 'var(--text-secondary)' }}>
                  {selectedFeature.effort ? `${formatHours(selectedFeature.effort)}h` : '—'}
                </p>
              </div>
            </div>

            {/* Explorer visualization - grid-based block layout (like mempool.space) */}
            <div className="flex flex-col items-center">
              <h4 className="mb-2 text-sm font-medium" style={{ color: 'var(--text-secondary)' }}>
                Explorer
              </h4>
              {selectedFeature.workItems.filter(isLeafWorkItem).length === 0 ? (
                <div
                  className="flex items-center justify-center"
                  style={{
                    width: gridContainerSize,
                    height: gridContainerSize,
                    backgroundColor: '#0f1419',
                  }}
                >
                  <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
                    No work items in this feature
                  </p>
                </div>
              ) : (
                <>
                  <div
                    className="relative overflow-hidden"
                    style={{
                      width: gridContainerSize,
                      height: gridContainerSize,
                      backgroundColor: '#0f1419',
                    }}
                  >
                    <svg
                      width="100%"
                      height="100%"
                      viewBox={`0 0 ${gridContainerSize} ${gridContainerSize}`}
                    >
                      {/* Mempool.space style: grid-based blocks with priority-based green colors */}
                      {blockRects.map((rect) => {
                        const totalWork =
                          (rect.item.completedWork || 0) + (rect.item.remainingWork || 0);
                        const priorityColor = getPriorityColor(rect.item.priority);

                        return (
                          <rect
                            key={rect.item.id}
                            x={rect.x}
                            y={rect.y}
                            width={rect.width}
                            height={rect.height}
                            fill={priorityColor}
                            className="cursor-pointer transition-all hover:brightness-125"
                          >
                            <title>
                              {rect.item.title}
                              {'\n'}#{rect.item.id} • {rect.item.workItemType || 'Task'} •{' '}
                              {rect.item.state}
                              {'\n'}Priority: {rect.item.priority || 'Not set'}
                              {'\n'}
                              {totalWork}h total
                            </title>
                          </rect>
                        );
                      })}
                    </svg>
                  </div>
                  {/* Legend showing priority levels */}
                  <div className="mt-3 flex flex-wrap justify-center gap-3">
                    {priorityLevels.map((priority) => (
                      <div key={priority} className="flex items-center gap-1.5">
                        <div
                          className="h-3 w-3 rounded-sm"
                          style={{ backgroundColor: getPriorityColor(priority) }}
                        />
                        <span className="text-xs" style={{ color: 'var(--text-muted)' }}>
                          {priority}
                        </span>
                      </div>
                    ))}
                  </div>
                </>
              )}
            </div>
          </div>

          {/* Right column: Work Items list (2/3 width) */}
          <div
            className="overflow-hidden rounded-lg lg:col-span-2"
            style={{ backgroundColor: 'var(--surface)', border: '1px solid var(--border)' }}
          >
            <WorkItemBoard
              items={selectedFeature.workItems}
              title="Work Items"
              columns={WORKITEM_COLUMNS}
              groupBy="none"
              compact
              readOnlyKanban
              hideTicketsOnlyToggle
              maxHeight="500px"
            />
          </div>
        </div>
      ) : (
        <div
          className="rounded-lg p-6 text-center"
          style={{ backgroundColor: 'var(--surface)', border: '1px dashed var(--border)' }}
        >
          <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
            Select a feature from the timechain above
          </p>
        </div>
      )}
    </div>
  );
}

// Priority-based colors for Explorer treemap (mempool.space style)
// Uses KnowAll brand green palette: bright (Urgent) to dark (Low)
function getPriorityColor(priority?: TicketPriority | 'Not set'): string {
  switch (priority) {
    case 'Urgent':
      return '#4ade80'; // Brightest green (primary-light)
    case 'High':
      return '#22c55e'; // Primary green
    case 'Normal':
      return '#16a34a'; // Medium green (primary-hover)
    case 'Low':
      return '#15803d'; // Dark green (primary-dark)
    case 'Not set':
    default:
      return '#0f5132'; // Very dark green (no priority set)
  }
}

// Priority labels for legend (including "Not set" for items without priority)
const priorityLevels: (TicketPriority | 'Not set')[] = [
  'Urgent',
  'High',
  'Normal',
  'Low',
  'Not set',
];
