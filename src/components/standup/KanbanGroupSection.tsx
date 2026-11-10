'use client';

import { useState, useMemo, useCallback } from 'react';
import { toast } from 'sonner';
import {
  DndContext,
  DragOverlay,
  closestCorners,
  PointerSensor,
  KeyboardSensor,
  useSensor,
  useSensors,
  type DragStartEvent,
  type DragEndEvent,
  type DragOverEvent,
} from '@dnd-kit/core';
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { useDroppable } from '@dnd-kit/core';
import { sortableKeyboardCoordinates } from '@dnd-kit/sortable';
import { ChevronDown, ChevronRight, Info } from 'lucide-react';
import StandupKanbanCard from './StandupKanbanCard';
import ActivitySummaryBar, { type PullRequestLoadState } from './ActivitySummaryBar';
import { getColumnIcon, getColumnColor } from './columnConfig';
import { highlightedFirst } from '@/lib/highlight-order';
import { isInHandColumn } from '@/lib/in-hand-columns';
import {
  canTypeEnterColumn,
  resolveStateForColumn,
  type AllowedStates,
} from '@/lib/kanban-columns';
import { formatLastUpdated, summarizeGroup } from '@/lib/kanban-summary';
import type { GroupActivitySummary, HighlightReason } from '@/lib/activity-summary';
import type { PullRequestActivity, StandupColumn, StandupWorkItem } from '@/types';
import { debugLog, debugWarn } from '@/lib/debug';
import { CLOSED_WINDOW_DAYS, type ClosedWindow } from '@/lib/closed-window';
import {
  readExpandedGroups,
  sessionPositionStorage,
  writeGroupExpanded,
} from '@/lib/kanban-position';

/**
 * What the Closed column is limited to, for the hint beside its heading, so
 * users don't think older items have vanished. Resolved items aren't windowed
 * -- they still await verification (#436).
 *
 * It follows the board's own setting rather than naming a fixed span (#6713):
 * a hint that said "the last 7 days" beside a column showing everything would
 * be worse than no hint, and the board can now show either.
 *
 * It says "closed in", not "changed in", because that is what the window is
 * now measured on -- an old closed item edited yesterday is not recently
 * closed.
 */
function doneWindowHint(closedWindow: ClosedWindow): string {
  return closedWindow === 'all'
    ? 'Showing closed items as far back as they go. Very old closed GitHub issues may be missing.'
    : `Showing items closed in the last ${CLOSED_WINDOW_DAYS} days`;
}

/** Simple droppable column for the standup kanban */
function DroppableColumn({
  name,
  category,
  items,
  activeId,
  isBlocked = false,
  blockedReason,
  isFocused = false,
  highlights,
  recent,
  onItemClick,
  closedWindow,
}: {
  name: string;
  category: string;
  items: StandupWorkItem[];
  activeId: number | null;
  /** The dragged card's type has no state for this column — refuse the drop. */
  isBlocked?: boolean;
  blockedReason?: string;
  /** The board is narrowed to this state (a KPI tile is pressed); mark the column. */
  isFocused?: boolean;
  /** While highlighting: the cards to light up, and why. Everything else is dimmed. */
  highlights?: Map<number, HighlightReason[]>;
  /** While highlighting: cards with only older (72-hour) activity, ringed amber (#586). */
  recent?: Set<number>;
  onItemClick?: (item: StandupWorkItem) => void;
  /** How far back the Closed column reaches, for its hint (#6713). */
  closedWindow: ClosedWindow;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: name, disabled: isBlocked });
  const color = getColumnColor(name, category);
  const isDoneColumn = category === 'Completed';
  const doneHint = doneWindowHint(closedWindow);
  // Highlighted cards first while highlighting is on (#503). One array for both
  // the rendered list and the SortableContext below: if those two disagree, a
  // drag lands on the wrong card.
  // To Do and Active are the work in hand: never faded, never ringed (#619).
  // Taking `highlights` away for this column handles all three at once -- the
  // fade, the ring and the reason badges all derive from it -- and keeps the
  // card order stable, since `highlightedFirst` is a no-op without it.
  const columnHighlights = isInHandColumn(name) ? undefined : highlights;
  // The amber tier follows the same rule, and sorts below the 24-hour cards.
  const columnRecent = columnHighlights === undefined ? undefined : recent;
  const ordered = useMemo(
    () => highlightedFirst(highlightedFirst(items, columnRecent), columnHighlights),
    [items, columnRecent, columnHighlights]
  );

  return (
    <div
      className={`kanban-column ${isFocused ? 'kanban-column-focused' : ''}`}
      style={isBlocked ? { opacity: 0.4, cursor: 'not-allowed' } : undefined}
      title={isBlocked ? blockedReason : undefined}
    >
      <div className="kanban-column-header">
        <div className="flex items-center gap-2">
          <span style={{ color }}>{getColumnIcon(name, category)}</span>
          <h3 className="text-sm font-semibold text-[var(--text-primary)]">{name}</h3>
          {isDoneColumn && (
            <button
              type="button"
              title={doneHint}
              aria-label={doneHint}
              className="cursor-help"
              style={{ color: 'var(--text-muted)' }}
            >
              <Info size={12} />
            </button>
          )}
        </div>
        <span className="rounded-full bg-[var(--surface-hover)] px-2 py-0.5 text-xs text-[var(--text-muted)]">
          {items.length}
        </span>
      </div>

      <div
        ref={setNodeRef}
        className={`kanban-column-content ${isOver ? 'kanban-column-over' : ''}`}
      >
        <SortableContext items={ordered.map((i) => i.id)} strategy={verticalListSortingStrategy}>
          {ordered.map((item) => (
            <StandupKanbanCard
              key={item.id}
              item={item}
              isDragging={activeId === item.id}
              highlight={columnHighlights?.get(item.id)}
              recent={columnRecent?.has(item.id)}
              dimmed={
                columnHighlights !== undefined &&
                !columnHighlights.has(item.id) &&
                !columnRecent?.has(item.id)
              }
              onClick={onItemClick}
            />
          ))}
        </SortableContext>

        {items.length === 0 && (
          <div className="flex h-20 items-center justify-center text-xs text-[var(--text-muted)]">
            No items
          </div>
        )}
      </div>
    </div>
  );
}

/** The group's last-24-hours activity, shown in its header. */
export interface GroupActivity {
  summary: GroupActivitySummary;
  /** Start of the window, epoch ms. */
  since: number;
  pullRequests: PullRequestActivity[];
  pullRequestState: PullRequestLoadState;
}

interface KanbanGroupSectionProps {
  groupName: string;
  /**
   * Names the view this group belongs to (organization and grouping). When
   * given, whether the group is open is remembered for the browser session,
   * so coming back from a work item finds it as it was left (#318).
   */
  positionScope?: string;
  /**
   * The state the board is narrowed to, when a KPI tile is pressed (#320).
   * The group then starts open, with that column marked.
   */
  focusedColumn?: string | null;
  columns: StandupColumn[];
  /** Project -> work item type -> states that type defines there. Omit to allow every drop. */
  allowedStatesByProjectType?: AllowedStates;
  /** `project` is the card's own project; passing it on saves the server a search. */
  onStateChange?: (itemId: number, targetState: string, project?: string) => Promise<void>;
  onItemClick?: (item: StandupWorkItem) => void;
  activity?: GroupActivity;
  /** How far back the Closed column reaches (#6713). */
  closedWindow?: ClosedWindow;
}

export default function KanbanGroupSection({
  groupName,
  positionScope,
  focusedColumn = null,
  columns,
  allowedStatesByProjectType,
  onStateChange,
  onItemClick,
  activity,
  closedWindow = 'recent',
}: KanbanGroupSectionProps) {
  const columnNames = useMemo(() => columns.map((c) => c.name), [columns]);
  const summary = useMemo(() => summarizeGroup(columns), [columns]);
  const totalItems = summary.total;

  // Narrowed to one state, the group is listed because it has cards there, so
  // it starts open. That is a view of the moment: it is not remembered, and it
  // does not overwrite which groups the user had open on the full board.
  const isFocusedView = focusedColumn !== null;
  const [expanded, setExpanded] = useState(
    () =>
      isFocusedView ||
      (positionScope !== undefined &&
        readExpandedGroups(sessionPositionStorage(), positionScope).includes(groupName))
  );
  const toggleExpanded = () => {
    const next = !expanded;
    setExpanded(next);
    if (positionScope !== undefined && !isFocusedView) {
      writeGroupExpanded(sessionPositionStorage(), positionScope, groupName, next);
    }
  };
  // On by default (#498), so cards with activity stand out straight away.
  const [highlighting, setHighlighting] = useState(true);
  // A group with no activity has nothing to light up, so nothing is dimmed.
  const hasHighlights =
    (activity?.summary.highlights.size ?? 0) + (activity?.summary.recent.size ?? 0) > 0;
  const highlightOn = highlighting && hasHighlights;
  /**
   * Switch this group's highlight off or on. Highlighting a collapsed group
   * opens it, or the button would do nothing visible.
   */
  const toggleHighlight = () => {
    const next = !highlightOn;
    setHighlighting(next);
    if (next && !expanded) toggleExpanded();
  };
  const highlights = highlightOn ? activity?.summary.highlights : undefined;
  const recentHighlights = highlightOn ? activity?.summary.recent : undefined;
  const [activeId, setActiveId] = useState<number | null>(null);
  const [isUpdating, setIsUpdating] = useState(false);

  // What the server last told us, keyed by column name.
  const propItems = useMemo(() => {
    const map: Record<string, StandupWorkItem[]> = {};
    for (const col of columns) {
      map[col.name] = col.items;
    }
    return map;
  }, [columns]);

  // Local copy so a drag can move cards optimistically before the server confirms.
  const [localItems, setLocalItems] = useState<Record<string, StandupWorkItem[]>>(propItems);
  const [syncedItems, setSyncedItems] = useState(propItems);

  // Adopt new server data as it arrives. Done during render rather than in an
  // effect: React restarts the render with the new state before painting, so
  // the board never flashes the stale columns first.
  //
  // Not while a card is being dragged or its move is being saved, though. A
  // refresh landing then (a live-update tick, or the refresh from the previous
  // drop) put the card back in its old column mid-drag, and the drop that
  // followed looked like "no change": no request, no message, the card just
  // snapped back (#366). The data is adopted on the first render afterwards.
  if (syncedItems !== propItems && activeId === null && !isUpdating) {
    setSyncedItems(propItems);
    setLocalItems(propItems);
  }

  // Roll the optimistic board back to the server's version after a drag that
  // didn't stick, or one we never sent.
  const syncFromProps = useCallback(() => {
    setLocalItems(propItems);
  }, [propItems]);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  // Find which column an item is in
  const findColumn = useCallback(
    (itemId: number | string): string | null => {
      const id = Number(itemId);
      for (const colName of columnNames) {
        if (localItems[colName]?.some((i) => i.id === id)) return colName;
      }
      // Check if the ID is a column name
      if (columnNames.includes(String(itemId))) return String(itemId);
      return null;
    },
    [localItems, columnNames]
  );

  const activeItem = useMemo(() => {
    if (!activeId) return null;
    for (const colName of columnNames) {
      const found = localItems[colName]?.find((i) => i.id === activeId);
      if (found) return found;
    }
    return null;
  }, [activeId, localItems, columnNames]);

  // Columns the dragged card can't enter, because its work item type defines no
  // matching state. Empty while nothing is being dragged, and empty whenever we
  // have no state list for the type — the server stays the authority (#391).
  const blockedColumns = useMemo(() => {
    if (!activeItem) return new Set<string>();
    return new Set(
      columnNames.filter(
        (name) =>
          !canTypeEnterColumn(
            activeItem.project,
            activeItem.workItemType,
            name,
            allowedStatesByProjectType
          )
      )
    );
  }, [activeItem, columnNames, allowedStatesByProjectType]);

  const handleDragStart = useCallback((event: DragStartEvent) => {
    setActiveId(event.active.id as number);
  }, []);

  const handleDragOver = useCallback(
    (event: DragOverEvent) => {
      const { active, over } = event;
      if (!over) return;

      const activeItemId = active.id as number;
      const overId = String(over.id);

      const sourceCol = findColumn(activeItemId);
      const targetCol = columnNames.includes(overId) ? overId : findColumn(overId);

      if (!sourceCol || !targetCol || sourceCol === targetCol) return;

      setLocalItems((prev) => {
        const item = prev[sourceCol]?.find((i) => i.id === activeItemId);
        if (!item) return prev;
        return {
          ...prev,
          [sourceCol]: prev[sourceCol].filter((i) => i.id !== activeItemId),
          [targetCol]: [...(prev[targetCol] || []), item],
        };
      });
    },
    [findColumn, columnNames]
  );

  const handleDragEnd = useCallback(
    async (event: DragEndEvent) => {
      const { active } = event;
      setActiveId(null);

      if (!event.over || !onStateChange) {
        // Rollback visual state if no handler
        syncFromProps();
        return;
      }

      const activeItemId = active.id as number;
      // Where dnd-kit says the card was dropped, in preference to where
      // `handleDragOver` happened to have moved it (#620).
      //
      // This used to read `findColumn(activeItemId)` alone -- the card's
      // position in `localItems`, which only `handleDragOver` writes. dnd-kit
      // does not promise a dragOver for the final position of every drag, so
      // when none arrived for the column under the pointer the card was still
      // in its source column, `originalCol?.name === targetCol` matched, and
      // the function returned having done nothing at all: no state write, no
      // toast, no log. The card sprang back to New and nothing said why,
      // which is exactly what was reported.
      //
      // `over.id` is a column name when the pointer is over the column's own
      // space and a card id when it is over a card, so both resolve through
      // the same lookup the drag-over path uses.
      const overId = String(event.over.id);
      const droppedOn = columnNames.includes(overId) ? overId : findColumn(overId);
      const targetCol = droppedOn ?? findColumn(activeItemId);
      if (!targetCol) {
        // Not gated: the dragged card is in no column at all, which means our
        // local state and the columns disagree. That is a real fault, not a
        // user action, and it is rare enough not to be per-drag noise.
        console.warn('[Standup DnD] dropped item is in no column', { activeItemId });
        // handleDragOver may already have moved the card in localItems, so
        // bail out through the same rollback every other early return uses.
        syncFromProps();
        return;
      }

      // Find original column from props
      const originalCol = columns.find((c) => c.items.some((i) => i.id === activeItemId));
      if (originalCol?.name === targetCol) return; // No change

      // Blocked columns are already disabled as drop targets, so this only
      // trips if the cached state list went stale mid-session. Say so plainly
      // rather than letting DevOps answer with a raw rule error.
      const dragged = originalCol?.items.find((i) => i.id === activeItemId);
      if (
        dragged &&
        !canTypeEnterColumn(
          dragged.project,
          dragged.workItemType,
          targetCol,
          allowedStatesByProjectType
        )
      ) {
        syncFromProps();
        // Gated, unlike the fault above: a blocked drop is an ordinary,
        // expected outcome — the column is already disabled as a drop target
        // and the user gets a toast — so logging it every time is exactly the
        // per-drag noise this PR set out to remove.
        debugWarn('[Standup DnD] drop blocked by the type’s state list', {
          itemId: activeItemId,
          workItemType: dragged.workItemType,
          project: dragged.project,
          fromColumn: originalCol?.name,
          targetColumn: targetCol,
        });
        toast.error(`${dragged.workItemType} work items have no "${targetCol}" state`);
        return;
      }

      // The column label is not necessarily the state name — "To Do" is the
      // state "Todo" in the KnowAll process — so translate before writing.
      const resolvedState = resolveStateForColumn(
        dragged?.project,
        dragged?.workItemType,
        targetCol,
        allowedStatesByProjectType
      );

      debugLog('[Standup DnD] drag end', {
        itemId: activeItemId,
        workItemType: dragged?.workItemType,
        project: dragged?.project,
        fromColumn: originalCol?.name,
        targetColumn: targetCol,
        resolvedState,
        blockedColumns: [...blockedColumns],
      });

      setIsUpdating(true);
      try {
        await onStateChange(activeItemId, resolvedState, dragged?.project);
        debugLog('[Standup DnD] state change succeeded', {
          itemId: activeItemId,
          resolvedState,
        });
      } catch (error) {
        // Not gated: a rejected transition is rare and its detail is the
        // whole point of issue #391.
        console.error('[Standup DnD] state change failed — rolling back', {
          itemId: activeItemId,
          fromColumn: originalCol?.name,
          targetColumn: targetCol,
          resolvedState,
          error,
        });
        syncFromProps();
        // Surface the upstream reason. A work item can only enter states its
        // own work item type defines, so drops onto a column the type has no
        // state for are rejected by DevOps ("TF401320: Rule Error…"). Without
        // this toast the card just snaps back with no explanation (#391, #366).
        toast.error(
          error instanceof Error && error.message
            ? `Couldn't move to "${targetCol}": ${error.message}`
            : `Couldn't move to "${targetCol}"`
        );
      } finally {
        setIsUpdating(false);
      }
    },
    [
      onStateChange,
      findColumn,
      columnNames,
      columns,
      allowedStatesByProjectType,
      syncFromProps,
      blockedColumns,
    ]
  );

  const handleDragCancel = useCallback(() => {
    setActiveId(null);
    syncFromProps();
  }, [syncFromProps]);

  return (
    <div className="card kanban-group">
      {/* Header. The summary sits beside the expand button, not inside it,
          because it holds a button of its own. */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 pr-4 transition-colors hover:bg-white/5">
        <button
          onClick={toggleExpanded}
          aria-expanded={expanded}
          className="flex min-w-0 flex-1 flex-wrap items-center gap-x-3 gap-y-2 p-4 text-left"
        >
          <span style={{ color: 'var(--text-muted)' }}>
            {expanded ? <ChevronDown size={18} /> : <ChevronRight size={18} />}
          </span>

          <h3 className="text-base font-semibold" style={{ color: 'var(--text-primary)' }}>
            {groupName}
          </h3>

          {/* What is inside, readable without opening the group (#321). */}
          {totalItems > 0 && (
            <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
              {summary.counts.map((count) => (
                <span
                  key={count.name}
                  className="flex items-center gap-1 text-xs font-medium"
                  style={{ color: getColumnColor(count.name, count.category) }}
                >
                  {getColumnIcon(count.name, count.category, 12)}
                  {/* The name is written out: Resolved and Closed share an icon,
                      and a tooltip is no help on a touch screen. */}
                  <span style={{ color: 'var(--text-muted)' }}>{count.name}</span>
                  <span style={{ color: 'var(--text-secondary)' }}>{count.count}</span>
                </span>
              ))}
              {summary.lastUpdated && (
                <span
                  className="text-xs"
                  style={{ color: 'var(--text-muted)' }}
                  title={summary.lastUpdated.toLocaleString('en-GB')}
                >
                  {formatLastUpdated(summary.lastUpdated)}
                </span>
              )}
            </span>
          )}

          {totalItems === 0 && (
            <span className="text-xs" style={{ color: 'var(--text-muted)' }}>
              No items
            </span>
          )}
        </button>

        {activity && (
          <div className="pb-3 pl-4 md:pb-0 md:pl-0">
            <ActivitySummaryBar
              summary={activity.summary}
              since={activity.since}
              pullRequests={activity.pullRequests}
              pullRequestState={activity.pullRequestState}
              highlighted={highlightOn}
              onToggleHighlight={toggleHighlight}
            />
          </div>
        )}
      </div>

      {/* Kanban board */}
      {expanded && totalItems > 0 && (
        <div className="border-t" style={{ borderColor: 'var(--border)' }}>
          {isUpdating && (
            <div className="bg-brand text-brand-foreground px-4 py-1.5 text-center text-xs">
              Updating...
            </div>
          )}
          <DndContext
            sensors={sensors}
            collisionDetection={closestCorners}
            onDragStart={handleDragStart}
            onDragOver={handleDragOver}
            onDragEnd={handleDragEnd}
            onDragCancel={handleDragCancel}
          >
            <div className="kanban-columns" style={{ padding: '0.75rem' }}>
              {columns.map((col) => {
                const items = localItems[col.name] || [];
                const isBlocked = blockedColumns.has(col.name);
                return (
                  <DroppableColumn
                    key={col.name}
                    name={col.name}
                    category={col.category}
                    items={items}
                    activeId={activeId}
                    isBlocked={isBlocked}
                    isFocused={focusedColumn === col.name}
                    highlights={highlights}
                    recent={recentHighlights}
                    blockedReason={
                      isBlocked && activeItem
                        ? `${activeItem.workItemType} work items have no "${col.name}" state`
                        : undefined
                    }
                    onItemClick={onItemClick}
                    closedWindow={closedWindow}
                  />
                );
              })}
            </div>

            <DragOverlay>
              {activeItem ? <StandupKanbanCard item={activeItem} isDragging /> : null}
            </DragOverlay>
          </DndContext>
        </div>
      )}
    </div>
  );
}
