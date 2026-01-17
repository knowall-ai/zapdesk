'use client';

import { useState, useRef, useCallback, useMemo, useEffect } from 'react';
import { ExternalLink } from 'lucide-react';
import type { Feature, WorkItem } from '@/types';
import { WorkItemBoard, WORKITEM_COLUMNS } from '@/components/tickets';

// Format hours to avoid floating-point precision issues (e.g., 3.199999999 -> "3.2")
function formatHours(value: number): string {
  return Number(value.toFixed(1)).toString();
}

// Treemap layout algorithm - shows Tasks (works with or without User Story layer)
interface TreemapRect {
  x: number;
  y: number;
  width: number;
  height: number;
  item: WorkItem;
}

// Extract all Tasks from work items - handles both:
// 1. Feature → Tasks (direct)
// 2. Feature → User Stories → Tasks (nested)
function extractTasks(items: WorkItem[]): WorkItem[] {
  const tasks: WorkItem[] = [];

  for (const item of items) {
    const type = item.workItemType?.toLowerCase() || '';
    // If it's a Task, include it
    if (type === 'task') {
      tasks.push(item);
    }
  }

  // If no Tasks found, show all items (for when there's no User Story layer)
  return tasks.length > 0 ? tasks : items;
}

function layoutTreemap(items: WorkItem[], width: number, height: number): TreemapRect[] {
  const tasks = extractTasks(items);
  if (tasks.length === 0) return [];

  // Calculate values - use total work or minimum 1
  const itemsWithValues = tasks.map((item) => ({
    item,
    value: Math.max((item.completedWork || 0) + (item.remainingWork || 0), 1),
  }));

  // Sort by value descending for better layout
  itemsWithValues.sort((a, b) => b.value - a.value);

  const totalValue = itemsWithValues.reduce((sum, i) => sum + i.value, 0);
  const rects: TreemapRect[] = [];

  let currentX = 0;
  let currentY = 0;
  let remainingWidth = width;
  let remainingHeight = height;
  let isHorizontal = width >= height;

  let i = 0;
  while (i < itemsWithValues.length) {
    const rowItems: typeof itemsWithValues = [];
    let rowValue = 0;
    const targetSize = isHorizontal ? remainingHeight : remainingWidth;

    while (i < itemsWithValues.length) {
      rowItems.push(itemsWithValues[i]);
      rowValue += itemsWithValues[i].value;

      const currentRowArea = (rowValue / totalValue) * width * height;
      const rowSize = currentRowArea / targetSize;

      const worstAspect = Math.max(
        ...rowItems.map((ri) => {
          const itemSize = (ri.value / rowValue) * targetSize;
          return Math.max(rowSize / itemSize, itemSize / rowSize);
        })
      );

      if (worstAspect > 4 && rowItems.length > 1) {
        rowItems.pop();
        rowValue -= itemsWithValues[i].value;
        break;
      }
      i++;
    }

    const rowArea = (rowValue / totalValue) * width * height;
    const rowSize = Math.max(rowArea / targetSize, 1);

    let offset = 0;
    for (const ri of rowItems) {
      const itemSize = (ri.value / rowValue) * targetSize;
      rects.push({
        x: isHorizontal ? currentX : currentX + offset,
        y: isHorizontal ? currentY + offset : currentY,
        width: isHorizontal ? rowSize : itemSize,
        height: isHorizontal ? itemSize : rowSize,
        item: ri.item,
      });
      offset += itemSize;
    }

    if (isHorizontal) {
      currentX += rowSize;
      remainingWidth -= rowSize;
    } else {
      currentY += rowSize;
      remainingHeight -= rowSize;
    }
    isHorizontal = remainingWidth >= remainingHeight;
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

// Calculate fill percentage based on completedWork vs effort
// Returns null if effort is not set (can't calculate percentage)
function calculateFillPercentage(feature: Feature): number | null {
  // Effort is required to calculate percentage
  if (!feature.effort || feature.effort === 0) {
    return null;
  }
  const percentage = (feature.completedWork / feature.effort) * 100;
  return Math.min(percentage, 100);
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

  // Treemap dimensions (square)
  const treemapSize = 400;

  // Calculate treemap layout for selected feature's work items
  const treemapRects = useMemo(() => {
    if (!selectedFeature) return [];
    return layoutTreemap(selectedFeature.workItems, treemapSize, treemapSize);
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
                  style={{ color: isSelected ? '#22c55e' : '#e5e7eb' }}
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
                      background: isSelected ? '#4ade80' : colors.topFace,
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
                      background: isSelected ? '#15803d' : colors.rightFace,
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
                      background: isSelected
                        ? 'linear-gradient(180deg, #14532d 0%, #052e16 100%)'
                        : colors.gradient,
                      border: isSelected ? '2px solid #22c55e' : `1px solid ${colors.border}`,
                      boxShadow: isSelected
                        ? '0 0 30px rgba(34, 197, 94, 0.5)'
                        : '0 8px 24px rgba(0,0,0,0.5)',
                    }}
                  >
                    <div className="flex h-full flex-col p-3">
                      <div
                        className="mb-2 text-xs font-medium tracking-wider uppercase"
                        style={{ color: isSelected ? '#4ade80' : colors.accent }}
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
                          style={{ color: isSelected ? '#bbf7d0' : colors.text }}
                        >
                          {extractTasks(feature.workItems).length}
                        </span>
                        <span
                          className="ml-1 text-sm"
                          style={{ color: isSelected ? '#4ade80' : colors.subtext }}
                        >
                          items
                        </span>
                      </div>

                      <div
                        className="text-sm"
                        style={{ color: isSelected ? '#4ade80' : colors.subtext }}
                      >
                        {formatHours(feature.completedWork)}h
                        {feature.effort ? ` / ${formatHours(feature.effort)}h` : ' completed'}
                      </div>

                      <div
                        className="mt-auto text-lg font-semibold"
                        style={{ color: isSelected ? '#4ade80' : colors.accent }}
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
                            width: `${fillPercentage ?? 0}%`,
                            backgroundColor: isSelected ? '#22c55e' : colors.accent,
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
                    style={{ backgroundColor: isSelected ? '#22c55e' : colors.accent }}
                  />
                  <span
                    className="truncate text-xs font-medium"
                    style={{ color: isSelected ? '#22c55e' : '#9ca3af' }}
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
                  {extractTasks(selectedFeature.workItems).length}
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

            {/* Explorer visualization - treemap */}
            <div className="flex flex-col items-center">
              <h4 className="mb-2 text-sm font-medium" style={{ color: 'var(--text-secondary)' }}>
                Explorer
              </h4>
              {selectedFeature.workItems.length === 0 ? (
                <div
                  className="flex items-center justify-center"
                  style={{
                    width: treemapSize,
                    height: treemapSize,
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
                      width: treemapSize,
                      height: treemapSize,
                      backgroundColor: '#0f1419',
                    }}
                  >
                    <svg width="100%" height="100%" viewBox={`0 0 ${treemapSize} ${treemapSize}`}>
                      {/* Gradient definitions for each work item type */}
                      <defs>
                        {Object.entries(workItemTypeColors).map(([key, color]) => (
                          <linearGradient
                            key={key}
                            id={`grad-type-${key.replace(/\s+/g, '-')}`}
                            x1="0%"
                            y1="0%"
                            x2="100%"
                            y2="100%"
                          >
                            <stop offset="0%" stopColor={color.fillLight} />
                            <stop offset="100%" stopColor={color.fill} />
                          </linearGradient>
                        ))}
                      </defs>
                      {treemapRects.map((rect) => {
                        const typeColor = getWorkItemTypeColor(rect.item.workItemType);
                        const totalWork =
                          (rect.item.completedWork || 0) + (rect.item.remainingWork || 0);
                        const typeKey = (rect.item.workItemType || 'default')
                          .toLowerCase()
                          .replace(/\s+/g, '-');
                        const gradientId = workItemTypeColors[
                          rect.item.workItemType?.toLowerCase() || ''
                        ]
                          ? `url(#grad-type-${typeKey})`
                          : 'url(#grad-type-default)';

                        return (
                          <g key={rect.item.id}>
                            {/* Main rectangle with gradient */}
                            <rect
                              x={rect.x + 1}
                              y={rect.y + 1}
                              width={Math.max(rect.width - 2, 0)}
                              height={Math.max(rect.height - 2, 0)}
                              fill={gradientId}
                              stroke={typeColor.stroke}
                              strokeWidth="1"
                              className="cursor-pointer transition-opacity hover:opacity-80"
                            >
                              <title>
                                {rect.item.title}
                                {'\n'}#{rect.item.id} • {rect.item.workItemType || 'Task'} •{' '}
                                {rect.item.state}
                                {'\n'}
                                {totalWork}h total
                              </title>
                            </rect>
                            {/* Label - only show if block is big enough */}
                            {rect.width > 40 && rect.height > 30 && (
                              <text
                                x={rect.x + rect.width / 2}
                                y={rect.y + rect.height / 2}
                                textAnchor="middle"
                                dominantBaseline="middle"
                                fill={typeColor.textColor}
                                fontSize={rect.width > 60 ? '11' : '9'}
                                fontFamily="monospace"
                                fontWeight="500"
                              >
                                {rect.item.id}
                              </text>
                            )}
                            {/* Show hours if really big */}
                            {rect.width > 60 && rect.height > 50 && (
                              <text
                                x={rect.x + rect.width / 2}
                                y={rect.y + rect.height / 2 + 14}
                                textAnchor="middle"
                                dominantBaseline="middle"
                                fill={typeColor.textColor}
                                fontSize="9"
                                fontFamily="sans-serif"
                                opacity="0.7"
                              >
                                {totalWork}h
                              </text>
                            )}
                          </g>
                        );
                      })}
                    </svg>
                  </div>
                  {/* Legend showing work item types present */}
                  <div className="mt-3 flex flex-wrap justify-center gap-3">
                    {(() => {
                      // Get unique work item types in this feature
                      const types = new Set<string>();
                      extractTasks(selectedFeature.workItems).forEach((item) => {
                        types.add(item.workItemType?.toLowerCase() || 'task');
                      });
                      return Array.from(types).map((type) => {
                        const color = getWorkItemTypeColor(type);
                        return (
                          <div key={type} className="flex items-center gap-1.5">
                            <div
                              className="h-3 w-3 rounded-sm"
                              style={{
                                background: `linear-gradient(135deg, ${color.fillLight} 0%, ${color.fill} 100%)`,
                                border: `1px solid ${color.stroke}`,
                              }}
                            />
                            <span className="text-xs" style={{ color: 'var(--text-muted)' }}>
                              {color.label}
                            </span>
                          </div>
                        );
                      });
                    })()}
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
              items={extractTasks(selectedFeature.workItems)}
              title="Work Items"
              columns={WORKITEM_COLUMNS}
              groupBy="none"
              compact
              readOnlyKanban
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

// Work item type colors for Explorer treemap
interface WorkItemTypeColor {
  fill: string;
  fillLight: string;
  stroke: string;
  textColor: string;
  label: string;
}

const workItemTypeColors: Record<string, WorkItemTypeColor> = {
  task: {
    fill: '#0d9488',
    fillLight: '#14b8a6',
    stroke: '#2dd4bf',
    textColor: '#99f6e4',
    label: 'Task',
  },
  bug: {
    fill: '#dc2626',
    fillLight: '#ef4444',
    stroke: '#f87171',
    textColor: '#fecaca',
    label: 'Bug',
  },
  issue: {
    fill: '#ea580c',
    fillLight: '#f97316',
    stroke: '#fb923c',
    textColor: '#fed7aa',
    label: 'Issue',
  },
  enhancement: {
    fill: '#0284c7',
    fillLight: '#0ea5e9',
    stroke: '#38bdf8',
    textColor: '#bae6fd',
    label: 'Enhancement',
  },
  risk: {
    fill: '#b91c1c',
    fillLight: '#dc2626',
    stroke: '#ef4444',
    textColor: '#fecaca',
    label: 'Risk',
  },
  question: {
    fill: '#7c2d12',
    fillLight: '#9a3412',
    stroke: '#ea580c',
    textColor: '#fed7aa',
    label: 'Question',
  },
  default: {
    fill: '#4d7c0f',
    fillLight: '#65a30d',
    stroke: '#84cc16',
    textColor: '#d9f99d',
    label: 'Other',
  },
};

function getWorkItemTypeColor(workItemType?: string): WorkItemTypeColor {
  if (!workItemType) return workItemTypeColors.default;
  const normalized = workItemType.toLowerCase();
  return workItemTypeColors[normalized] || workItemTypeColors.default;
}
