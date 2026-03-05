'use client';

import { useMemo, useCallback } from 'react';
import { Treemap, ResponsiveContainer } from 'recharts';
import { Tooltip } from 'react-tooltip';
import type { TreemapNode, TreemapColorScheme, TicketPriority } from '@/types';

interface EpicTreemapProps {
  data: TreemapNode;
  colorScheme: TreemapColorScheme;
  onNodeClick?: (node: TreemapNode) => void;
}

// Data type for Recharts treemap (needs index signature for compatibility)
interface TreemapDataItem {
  name: string;
  size?: number;
  id: number;
  state: string;
  type: 'epic' | 'feature' | 'workitem';
  priority?: TicketPriority;
  workItemType?: string;
  devOpsUrl: string;
  children?: TreemapDataItem[];
  [key: string]: string | number | boolean | TicketPriority | TreemapDataItem[] | undefined;
}

// Color mappings for different schemes
const statusColors: Record<string, string> = {
  New: '#3b82f6', // Blue
  Active: '#22c55e', // Green
  'In Progress': '#22c55e', // Green
  Resolved: '#eab308', // Yellow
  Closed: '#6b7280', // Gray
  Done: '#6b7280', // Gray
  Removed: '#ef4444', // Red
};

const priorityColors: Record<string, string> = {
  Urgent: '#ef4444', // Red
  High: '#f97316', // Orange
  Normal: '#22c55e', // Green
  Low: '#3b82f6', // Blue
};

const workItemTypeColors: Record<string, string> = {
  Epic: '#8b5cf6', // Purple
  Feature: '#3b82f6', // Blue
  'User Story': '#22c55e', // Green
  Task: '#06b6d4', // Cyan
  Bug: '#ef4444', // Red
  Issue: '#f97316', // Orange
};

function getNodeColor(node: TreemapDataItem, colorScheme: TreemapColorScheme): string {
  switch (colorScheme) {
    case 'status':
      return statusColors[node.state] || '#6b7280';
    case 'priority':
      return node.priority ? priorityColors[node.priority] : '#6b7280';
    case 'type':
      return workItemTypeColors[node.workItemType || node.type] || '#6b7280';
    default:
      return '#6b7280';
  }
}

// Custom content renderer for treemap cells
interface CustomizedContentProps {
  x: number;
  y: number;
  width: number;
  height: number;
  name: string;
  depth: number;
  colors: string[];
  colorScheme: TreemapColorScheme;
  payload?: TreemapDataItem;
}

const CustomizedContent = (props: CustomizedContentProps) => {
  const { x, y, width, height, name, depth, colorScheme, payload } = props;

  // Don't render if too small
  if (width < 20 || height < 20) {
    return null;
  }

  const color = payload ? getNodeColor(payload, colorScheme) : '#6b7280';
  const showLabel = width > 60 && height > 30;
  const fontSize = Math.min(12, Math.max(8, Math.min(width, height) / 8));

  // Truncate name based on available width
  const maxChars = Math.floor(width / (fontSize * 0.6));
  const displayName = name.length > maxChars ? name.substring(0, maxChars - 2) + '...' : name;

  return (
    <g>
      <rect
        x={x}
        y={y}
        width={width}
        height={height}
        style={{
          fill: color,
          stroke: 'var(--surface)',
          strokeWidth: depth === 1 ? 3 : 1,
          strokeOpacity: 1,
          cursor: 'pointer',
          opacity: 0.85 + depth * 0.05,
        }}
        data-tooltip-id="treemap-tooltip"
        data-tooltip-content={`${name} | ${payload?.state || ''} | ${payload?.workItemType || payload?.type || ''}`}
      />
      {showLabel && (
        <text
          x={x + width / 2}
          y={y + height / 2}
          textAnchor="middle"
          dominantBaseline="middle"
          style={{
            fill: '#fff',
            fontSize: fontSize,
            fontWeight: depth === 1 ? 600 : 400,
            pointerEvents: 'none',
            textShadow: '1px 1px 2px rgba(0,0,0,0.5)',
          }}
        >
          {displayName}
        </text>
      )}
    </g>
  );
};

// Legend component
interface LegendProps {
  colorScheme: TreemapColorScheme;
}

const Legend = ({ colorScheme }: LegendProps) => {
  const items = useMemo(() => {
    switch (colorScheme) {
      case 'status':
        return Object.entries(statusColors);
      case 'priority':
        return Object.entries(priorityColors);
      case 'type':
        return Object.entries(workItemTypeColors);
      default:
        return [];
    }
  }, [colorScheme]);

  return (
    <div className="flex flex-wrap gap-3 text-xs">
      {items.map(([label, color]) => (
        <div key={label} className="flex items-center gap-1.5">
          <div className="h-3 w-3 rounded-sm" style={{ backgroundColor: color }} />
          <span style={{ color: 'var(--text-secondary)' }}>{label}</span>
        </div>
      ))}
    </div>
  );
};

// Convert TreemapNode to TreemapDataItem
function nodeToDataItem(node: TreemapNode): TreemapDataItem {
  return {
    name: node.name,
    size: node.value || 1,
    id: node.id,
    state: node.state,
    type: node.type,
    priority: node.priority,
    workItemType: node.workItemType,
    devOpsUrl: node.devOpsUrl,
    children: node.children?.map(nodeToDataItem),
  };
}

export function EpicTreemap({ data, colorScheme, onNodeClick }: EpicTreemapProps) {
  // Flatten data for Recharts treemap format
  const chartData = useMemo((): TreemapDataItem[] => {
    if (!data.children || data.children.length === 0) {
      return [nodeToDataItem(data)];
    }

    // Return features with their work items nested
    return data.children.map((feature) => {
      const item: TreemapDataItem = {
        name: feature.name,
        id: feature.id,
        state: feature.state,
        type: feature.type,
        priority: feature.priority,
        workItemType: feature.workItemType,
        devOpsUrl: feature.devOpsUrl,
        children: feature.children?.map((wi) => ({
          name: wi.name,
          size: wi.value || 1,
          id: wi.id,
          state: wi.state,
          type: wi.type,
          priority: wi.priority,
          workItemType: wi.workItemType,
          devOpsUrl: wi.devOpsUrl,
        })),
      };

      // If no children, set size directly
      if (!item.children || item.children.length === 0) {
        item.size = feature.value || 1;
        delete item.children;
      }

      return item;
    });
  }, [data]);

  const handleClick = useCallback(
    (nodeData: TreemapDataItem) => {
      if (onNodeClick) {
        // Convert back to TreemapNode format
        const node: TreemapNode = {
          name: nodeData.name,
          id: nodeData.id,
          value: nodeData.size || 0,
          state: nodeData.state,
          type: nodeData.type,
          priority: nodeData.priority,
          workItemType: nodeData.workItemType,
          devOpsUrl: nodeData.devOpsUrl,
        };
        onNodeClick(node);
      } else if (nodeData.devOpsUrl) {
        window.open(nodeData.devOpsUrl, '_blank', 'noopener,noreferrer');
      }
    },
    [onNodeClick]
  );

  if (!data || !chartData.length) {
    return (
      <div
        className="flex h-64 items-center justify-center rounded-lg"
        style={{ backgroundColor: 'var(--surface)' }}
      >
        <p style={{ color: 'var(--text-muted)' }}>No data available for visualization</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <Legend colorScheme={colorScheme} />
      <div
        className="rounded-lg"
        style={{
          backgroundColor: 'var(--surface)',
          height: '500px',
        }}
      >
        <ResponsiveContainer width="100%" height="100%">
          <Treemap
            data={chartData}
            dataKey="size"
            aspectRatio={4 / 3}
            stroke="var(--surface)"
            fill="var(--primary)"
            content={
              <CustomizedContent
                x={0}
                y={0}
                width={0}
                height={0}
                name=""
                depth={0}
                colors={[]}
                colorScheme={colorScheme}
              />
            }
            onClick={(node: unknown) => {
              const nodeData = node as { payload?: TreemapDataItem } | null;
              if (nodeData && nodeData.payload) {
                handleClick(nodeData.payload);
              }
            }}
          />
        </ResponsiveContainer>
      </div>
      <Tooltip
        id="treemap-tooltip"
        style={{
          backgroundColor: 'var(--surface-hover)',
          color: 'var(--text-primary)',
          borderRadius: '6px',
          padding: '8px 12px',
          fontSize: '12px',
          zIndex: 1000,
        }}
      />
    </div>
  );
}

export default EpicTreemap;
