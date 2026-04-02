'use client';

import { useState, useRef, useCallback, useMemo, useEffect } from 'react';
import { ExternalLink } from 'lucide-react';
import type { Feature, WorkItem, WorkItemType, TicketPriority } from '@/types';
import { WorkItemBoard, WORKITEM_COLUMNS, WorkItemDetailDialog } from '@/components/tickets';

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
  project?: string;
}

interface DevOpsState {
  name: string;
  color: string;
  category: string; // Proposed, InProgress, Resolved, Completed, Removed
}

interface FeatureTimechainProps {
  features: Feature[];
  epic?: EpicInfo;
  onFeatureClick?: (feature: Feature) => void;
  availableTypes?: WorkItemType[]; // Work item types with icons from Azure DevOps
  organization?: string; // Azure DevOps organization for API calls
  featureStates?: DevOpsState[]; // State definitions from Azure DevOps
}

// --- Color manipulation helpers ---
function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const h = hex.replace('#', '');
  return {
    r: parseInt(h.substring(0, 2), 16),
    g: parseInt(h.substring(2, 4), 16),
    b: parseInt(h.substring(4, 6), 16),
  };
}

function rgbToHex(r: number, g: number, b: number): string {
  const clamp = (v: number) => Math.max(0, Math.min(255, Math.round(v)));
  return `#${clamp(r).toString(16).padStart(2, '0')}${clamp(g).toString(16).padStart(2, '0')}${clamp(b).toString(16).padStart(2, '0')}`;
}

function darkenHex(hex: string, factor: number): string {
  const { r, g, b } = hexToRgb(hex);
  return rgbToHex(r * factor, g * factor, b * factor);
}

function lightenHex(hex: string, factor: number): string {
  const { r, g, b } = hexToRgb(hex);
  return rgbToHex(r + (255 - r) * factor, g + (255 - g) * factor, b + (255 - b) * factor);
}

function blendHex(base: string, target: string, amount: number): string {
  const b = hexToRgb(base);
  const t = hexToRgb(target);
  return rgbToHex(
    b.r + (t.r - b.r) * amount,
    b.g + (t.g - b.g) * amount,
    b.b + (t.b - b.b) * amount
  );
}

function hexToRgba(hex: string, alpha: number): string {
  const { r, g, b } = hexToRgb(hex);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

const FALLBACK_COLOR = 'b2b2b2';

// Build lookup maps from featureStates
function buildStateCategoryMap(featureStates?: DevOpsState[]): Map<string, string> {
  const map = new Map<string, string>();
  if (featureStates) {
    for (const s of featureStates) {
      map.set(s.name.toLowerCase(), s.category);
    }
  }
  return map;
}

function buildStateColorMap(featureStates?: DevOpsState[]): Map<string, string> {
  const map = new Map<string, string>();
  if (featureStates) {
    for (const s of featureStates) {
      map.set(s.name.toLowerCase(), s.color);
    }
  }
  return map;
}

function getStateHex(state: string, stateColorMap: Map<string, string>): string {
  return '#' + (stateColorMap.get(state.toLowerCase()) || FALLBACK_COLOR);
}

// Derive all block colors dynamically from the DevOps state color
interface BlockColors {
  gradient: string;
  accent: string;
  topFace: string;
  rightFace: string;
  border: string;
  text: string;
  subtext: string;
}

function getStateColors(state: string, stateColorMap: Map<string, string>): BlockColors {
  const base = getStateHex(state, stateColorMap);
  return {
    gradient: `linear-gradient(180deg, ${darkenHex(base, 0.15)} 0%, ${darkenHex(base, 0.3)} 100%)`,
    accent: lightenHex(base, 0.4),
    topFace: darkenHex(base, 0.5),
    rightFace: darkenHex(base, 0.15),
    border: base,
    text: lightenHex(base, 0.7),
    subtext: lightenHex(base, 0.4),
  };
}

interface SelectedColors {
  topFace: string;
  leftFace: string;
  gradient: string;
  border: string;
  glow: string;
  accent: string;
  text: string;
}

function getSelectedColors(state: string, stateColorMap: Map<string, string>): SelectedColors {
  const base = getStateHex(state, stateColorMap);
  return {
    topFace: lightenHex(base, 0.4),
    leftFace: darkenHex(base, 0.5),
    gradient: `linear-gradient(180deg, ${darkenHex(base, 0.3)} 0%, ${darkenHex(base, 0.15)} 100%)`,
    border: base,
    glow: `0 0 30px ${hexToRgba(base, 0.5)}`,
    accent: lightenHex(base, 0.4),
    text: lightenHex(base, 0.7),
  };
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
  availableTypes,
  organization,
  featureStates,
}: FeatureTimechainProps) {
  const stateCategoryMap = useMemo(() => buildStateCategoryMap(featureStates), [featureStates]);
  const stateColorMap = useMemo(() => buildStateColorMap(featureStates), [featureStates]);

  // Initialize with first In Progress feature, or fall back to first feature
  const [selectedFeature, setSelectedFeature] = useState<Feature | null>(() => {
    const catMap = buildStateCategoryMap(featureStates);
    const firstInProgress = features.find(
      (f) => catMap.get(f.state.toLowerCase()) === 'InProgress'
    );
    return firstInProgress || features[0] || null;
  });
  const [selectedWorkItem, setSelectedWorkItem] = useState<WorkItem | null>(null);
  const [isDialogOpen, setIsDialogOpen] = useState(false);
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

  const handleWorkItemClick = useCallback((item: WorkItem) => {
    setSelectedWorkItem(item);
    setIsDialogOpen(true);
  }, []);

  const handleDialogStateChange = useCallback(
    async (workItemId: number, newState: string) => {
      const headers: HeadersInit = { 'Content-Type': 'application/json' };
      if (organization) {
        headers['x-devops-org'] = organization;
      }
      const response = await fetch(`/api/devops/tickets/${workItemId}/state`, {
        method: 'PATCH',
        headers,
        body: JSON.stringify({ state: newState, project: epic?.project }),
      });
      if (!response.ok) throw new Error('Failed to update state');
      // Update local state so dialog and feature work items reflect the change
      setSelectedWorkItem((prev) => (prev ? { ...prev, state: newState } : null));
      setSelectedFeature((prev) => {
        if (!prev) return null;
        return {
          ...prev,
          workItems: prev.workItems.map((item) =>
            item.id === workItemId ? { ...item, state: newState } : item
          ),
        };
      });
    },
    [organization, epic?.project]
  );

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

  // Neutral dark base colors for unfilled block portions
  const NEUTRAL_TOP_BASE = '#1a1e26';
  const NEUTRAL_LEFT_BASE = '#0c1016';
  const NEUTRAL_MAIN_TOP = '#1a1e26';
  const NEUTRAL_MAIN_BOTTOM = '#0f1318';
  const TINT_AMOUNT = 0.15; // Subtle state color tint for unfilled portions

  return (
    <div className="space-y-6">
      {/* Epic description above timechain */}
      {epic?.description && (
        <p className="text-sm leading-relaxed" style={{ color: 'var(--text-secondary)' }}>
          {epic.description.replace(/<[^>]*>/g, '')}
        </p>
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
            const colors = getStateColors(feature.state, stateColorMap);
            const selectedColors = getSelectedColors(feature.state, stateColorMap);
            const stateHex = getStateHex(feature.state, stateColorMap);
            const neutralTop = blendHex(NEUTRAL_TOP_BASE, stateHex, TINT_AMOUNT);
            const neutralLeft = blendHex(NEUTRAL_LEFT_BASE, stateHex, TINT_AMOUNT);
            const neutralMainTop = blendHex(NEUTRAL_MAIN_TOP, stateHex, TINT_AMOUNT);
            const neutralMainBottom = blendHex(NEUTRAL_MAIN_BOTTOM, stateHex, TINT_AMOUNT);

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
                    className="absolute overflow-hidden"
                    style={{
                      width: blockWidth,
                      height: depth,
                      top: 0,
                      left: depth,
                      background:
                        fillPercentage !== null && fillPercentage < 100
                          ? neutralTop
                          : isSelected
                            ? selectedColors.topFace
                            : colors.topFace,
                      transform: 'skewX(45deg)',
                      transformOrigin: 'bottom left',
                    }}
                  />

                  {/* Left face - parallelogram going back-left */}
                  <div
                    className="absolute overflow-hidden"
                    style={{
                      width: depth,
                      height: blockHeight,
                      top: depth,
                      left: 0,
                      background: neutralLeft,
                      transform: 'skewY(45deg)',
                      transformOrigin: 'top right',
                    }}
                  >
                    {/* State-colored fill rising from bottom */}
                    {fillPercentage !== null && fillPercentage > 0 && (
                      <div
                        className="absolute right-0 bottom-0 left-0 transition-all duration-500"
                        style={{
                          height: `${Math.min(fillPercentage, 100)}%`,
                          background: `linear-gradient(180deg, ${lightenHex(getStateHex(feature.state, stateColorMap), 0.4)} 0%, ${getStateHex(feature.state, stateColorMap)} 100%)`,
                          borderTop:
                            fillPercentage > 0 && fillPercentage < 100
                              ? '1px solid rgba(255, 255, 255, 0.4)'
                              : 'none',
                        }}
                      />
                    )}
                    {/* Full color when no effort data */}
                    {fillPercentage === null && (
                      <div
                        className="absolute inset-0"
                        style={{
                          background: isSelected ? selectedColors.leftFace : colors.rightFace,
                        }}
                      />
                    )}
                  </div>

                  {/* Main face */}
                  <div
                    className="absolute overflow-hidden"
                    style={{
                      width: blockWidth,
                      height: blockHeight,
                      top: depth,
                      left: depth,
                      background: `linear-gradient(180deg, ${neutralMainTop} 0%, ${neutralMainBottom} 100%)`,
                      border: `1px solid ${isSelected ? selectedColors.border : colors.border}`,
                      boxShadow: isSelected ? selectedColors.glow : '0 8px 24px rgba(0,0,0,0.5)',
                    }}
                  >
                    {/* State-colored fill rising from bottom */}
                    {fillPercentage !== null && fillPercentage > 0 && (
                      <div
                        className="absolute right-0 bottom-0 left-0 transition-all duration-500"
                        style={{
                          height: `${Math.min(fillPercentage, 100)}%`,
                          background: `linear-gradient(0deg, ${getStateHex(feature.state, stateColorMap)} 0%, ${lightenHex(getStateHex(feature.state, stateColorMap), 0.3)} 100%)`,
                          borderTop:
                            fillPercentage > 0 && fillPercentage < 100
                              ? '1px solid rgba(255, 255, 255, 0.4)'
                              : 'none',
                        }}
                      />
                    )}
                    {/* Full color when no effort data */}
                    {fillPercentage === null && (
                      <div
                        className="absolute inset-0"
                        style={{
                          background: isSelected ? selectedColors.gradient : colors.gradient,
                        }}
                      />
                    )}
                    <div className="relative z-10 flex h-full flex-col p-3">
                      <div
                        className="mb-2 text-xs font-medium tracking-wider uppercase"
                        style={{ color: isSelected ? selectedColors.accent : colors.accent }}
                      >
                        {(() => {
                          const cat = stateCategoryMap.get(feature.state.toLowerCase());
                          if (cat === 'Completed' || cat === 'Resolved') return 'Done';
                          if (cat === 'InProgress') return 'Active';
                          return 'New';
                        })()}
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
                      backgroundColor: hexToRgba(
                        getStateHex(selectedFeature.state, stateColorMap),
                        0.2
                      ),
                      color: getStateHex(selectedFeature.state, stateColorMap),
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
              <p className="mb-4 text-sm leading-relaxed" style={{ color: 'var(--text-muted)' }}>
                {selectedFeature.description.replace(/<[^>]*>/g, '').slice(0, 300)}
              </p>
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
                <p
                  className="text-lg font-bold"
                  style={{
                    color: getStateHex(selectedFeature.state, stateColorMap),
                  }}
                >
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
                      {/* Mempool.space style: grid-based blocks - green/purple/grey based on feature state */}
                      {blockRects.map((rect) => {
                        const totalWork =
                          (rect.item.completedWork || 0) + (rect.item.remainingWork || 0);
                        const blockColor = getBlockColor(
                          selectedFeature.state,
                          stateColorMap,
                          rect.item.priority
                        );

                        return (
                          <rect
                            key={rect.item.id}
                            x={rect.x}
                            y={rect.y}
                            width={rect.width}
                            height={rect.height}
                            fill={blockColor}
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
                          style={{
                            backgroundColor: getBlockColor(
                              selectedFeature.state,
                              stateColorMap,
                              priority
                            ),
                          }}
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
              availableGroupBy={['none', 'assignee', 'userStory']}
              compact
              maxHeight="500px"
              availableTypes={availableTypes}
              defaultTicketsOnly={false}
              onWorkItemClick={handleWorkItemClick}
              onStatusChange={handleDialogStateChange}
              project={epic?.project}
              organization={organization}
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

      {/* Work Item Detail Dialog */}
      <WorkItemDetailDialog
        workItem={selectedWorkItem}
        isOpen={isDialogOpen}
        onClose={() => {
          setIsDialogOpen(false);
          setSelectedWorkItem(null);
        }}
        onStateChange={handleDialogStateChange}
      />
    </div>
  );
}

// Priority-based colors derived from DevOps state color
// Urgent = brightest, Not set = darkest
function getPriorityColor(baseHex: string, priority?: TicketPriority | 'Not set'): string {
  switch (priority) {
    case 'Urgent':
      return lightenHex(baseHex, 0.5);
    case 'High':
      return lightenHex(baseHex, 0.2);
    case 'Normal':
      return baseHex;
    case 'Low':
      return darkenHex(baseHex, 0.7);
    case 'Not set':
    default:
      return darkenHex(baseHex, 0.45);
  }
}

// Get block color based on feature state and priority
function getBlockColor(
  featureState: string,
  stateColorMap: Map<string, string>,
  priority?: TicketPriority | 'Not set'
): string {
  const base = getStateHex(featureState, stateColorMap);
  return getPriorityColor(base, priority);
}

// Priority labels for legend (including "Not set" for items without priority)
const priorityLevels: (TicketPriority | 'Not set')[] = [
  'Urgent',
  'High',
  'Normal',
  'Low',
  'Not set',
];
