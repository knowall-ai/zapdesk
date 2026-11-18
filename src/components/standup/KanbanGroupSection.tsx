'use client';

import { useState, useMemo, useCallback, useRef } from 'react';
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
  type DragCancelEvent,
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
import { dragFailureMessage } from '@/lib/drag-failure';
import { isStateChangeSuperseded } from '@/lib/state-change-cancelled';
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
/**
 * `columns` with the card moved to the end of `target`, or unchanged when it
 * is already there or in no column at all. Appended, as `handleDragOver` does.
 */
export function moveCardTo(
  columns: Record<string, StandupWorkItem[]>,
  itemId: number,
  target: string
): Record<string, StandupWorkItem[]> {
  const source = Object.keys(columns).find((name) =>
    columns[name]?.some((item) => item.id === itemId)
  );
  if (!source || source === target) return columns;
  const card = columns[source].find((item) => item.id === itemId)!;
  return {
    ...columns,
    [source]: columns[source].filter((item) => item.id !== itemId),
    [target]: [...(columns[target] ?? []), card],
  };
}

/**
 * Put one card back where `original` has it -- same column, same place --
 * and leave every other card as it is.
 *
 * A failed or cancelled move used to reset the whole board to the props.
 * With two moves away at once that also undid the other one, sending a card
 * back to its old column while its required-fields dialog was still open
 * (#663 review).
 */
export function restoreCard(
  columns: Record<string, StandupWorkItem[]>,
  original: Record<string, StandupWorkItem[]>,
  itemId: number
): Record<string, StandupWorkItem[]> {
  const home = Object.keys(original).find((name) =>
    original[name]?.some((item) => item.id === itemId)
  );
  if (!home) return columns;
  const index = original[home].findIndex((item) => item.id === itemId);
  const card = original[home][index];
  const without: Record<string, StandupWorkItem[]> = {};
  for (const [name, items] of Object.entries(columns)) {
    without[name] = items.some((item) => item.id === itemId)
      ? items.filter((item) => item.id !== itemId)
      : items;
  }
  const target = [...(without[home] ?? [])];
  // Placed after the nearest card that was above it and is still there, or
  // before the nearest one that was below it. An index alone drifts once
  // other cards have left the column: [1, 2, 3] with 1 and 2 away, and 2
  // restored at index 1 of [3], came back as [3, 2] (#663 review).
  const position = (id: number) => target.findIndex((item) => item.id === id);
  let at = -1;
  for (let i = index - 1; i >= 0 && at === -1; i--) {
    const found = position(original[home][i].id);
    if (found !== -1) at = found + 1;
  }
  for (let i = index + 1; i < original[home].length && at === -1; i++) {
    const found = position(original[home][i].id);
    if (found !== -1) at = found;
  }
  if (at === -1) at = Math.min(index, target.length);
  target.splice(at, 0, card);
  return { ...without, [home]: target };
}

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
  // To Do and Active are the work in hand (#619). What they are spared is the
  // fade, named separately below -- not the ring and the
  // badge, which they used to lose along with them because all four derived
  // from one `highlights` value. That left the Highlight button counting cards
  // in these two columns and the board marking none of them (#659), and these
  // are the columns most of the activity is in.
  const inHand = isInHandColumn(name);
  /** Highlighting is on and this column fades the cards that did not move. */
  const fadeUnmarked = highlights !== undefined && !inHand;
  // Highlighted cards first while highlighting is on (#503), in every column --
  // To Do and Active included, which #619 had left in place: the cards that
  // moved are the ones the stand-up wants to reach first. One array for both
  // the rendered list and the SortableContext below: if those two disagree, a
  // drag lands on the wrong card.
  const ordered = useMemo(
    () => highlightedFirst(highlightedFirst(items, recent), highlights),
    [items, recent, highlights]
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
              highlight={highlights?.get(item.id)}
              recent={recent?.has(item.id)}
              dimmed={fadeUnmarked && !highlights?.has(item.id) && !recent?.has(item.id)}
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
  /**
   * A card was dropped back in the column it started in. An earlier drag of
   * it may still be waiting on its rules lookup, and must not go on to write
   * the state this drop undid (#663 review).
   */
  onStateChangeAbandoned?: (itemId: number) => void;
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
  onStateChangeAbandoned,
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
  /**
   * Moves still waiting on their lookup or write. A count, not a flag: a
   * second drag can start while the first is still away, and the first one
   * settling must not clear the guard below for the second -- a refresh would
   * then put that card back in its old column mid-write (#663 review).
   */
  const [pendingMoves, setPendingMoves] = useState(0);
  const isUpdating = pendingMoves > 0;

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

  /**
   * Where the dragged card was when this drag began. A drag that goes
   * nowhere -- cancelled, dropped outside, refused before it is sent -- puts
   * back only that card, from here. Resetting the board to the props also
   * undid another card's move still waiting on its lookup (#663 review).
   */
  const dragStartRef = useRef<Record<string, StandupWorkItem[]> | null>(null);
  const putBackDragged = useCallback((itemId: number) => {
    const start = dragStartRef.current;
    if (start) setLocalItems((prev) => restoreCard(prev, start, itemId));
  }, []);
  /**
   * The newest drop of each card. Only the drop that still owns a card may
   * roll it back or report a refusal: an older drop's late failure would
   * otherwise put the card back while a newer one is waiting on its dialog
   * (#663 review).
   */
  const latestDropRef = useRef(new Map<number, number>());

  const handleDragStart = useCallback(
    (event: DragStartEvent) => {
      dragStartRef.current = localItems;
      setActiveId(event.active.id as number);
    },
    [localItems]
  );

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
        // Dropped outside, or nothing to write with: put this card back.
        putBackDragged(active.id as number);
        return;
      }

      const activeItemId = active.id as number;
      /**
       * Take ownership of the card for this drop. Only a drop that replaces
       * the earlier move -- a new transition, or a drop back where it
       * started -- does; one refused before anything is sent leaves the
       * earlier move in charge of its own rollback (#663 review).
       */
      const claim = () => {
        const next = (latestDropRef.current.get(activeItemId) ?? 0) + 1;
        latestDropRef.current.set(activeItemId, next);
        return next;
      };
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
        putBackDragged(activeItemId);
        return;
      }

      // Find original column from props
      const originalCol = columns.find((c) => c.items.some((i) => i.id === activeItemId));
      if (originalCol?.name === targetCol) {
        // Dropped back where it started. Drawn there even if no dragOver
        // moved it, and a drag of this card still waiting on its lookup must
        // not write the state this drop undid.
        claim();
        setLocalItems((prev) => moveCardTo(prev, activeItemId, targetCol));
        onStateChangeAbandoned?.(activeItemId);
        return;
      }

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
        putBackDragged(activeItemId);
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

      // Put the card where it was dropped before anything is awaited. The
      // target came from `event.over`, and when no dragOver arrived for that
      // column the card is still drawn in the one it left -- which is where
      // it would sit, wrongly, all the while the required-fields prompt is
      // open (#663 review).
      const drop = claim();
      setLocalItems((prev) => moveCardTo(prev, activeItemId, targetCol));

      setPendingMoves((count) => count + 1);
      try {
        await onStateChange(activeItemId, resolvedState, dragged?.project);
        debugLog('[Standup DnD] state change succeeded', {
          itemId: activeItemId,
          resolvedState,
        });
      } catch (error) {
        // A newer drag of this card took over during the lookup. The card is
        // where that drag put it, and its write is still away: leave it.
        if (isStateChangeSuperseded(error)) return;
        // A later drop of this card owns it now. This refusal is about a
        // move the user has already replaced: neither undo the newer one nor
        // report the older.
        if (latestDropRef.current.get(activeItemId) !== drop) return;
        // Nothing was written, so this card goes back whatever happened --
        // only this one: another may be mid-move, with its dialog open.
        setLocalItems((prev) => restoreCard(prev, propItems, activeItemId));
        // If the card is being dragged again right now, that drag's
        // fallback placement is the move that just failed. Cancelling it
        // would put the refused move back on the board (#663 review).
        if (dragStartRef.current) {
          dragStartRef.current = restoreCard(dragStartRef.current, propItems, activeItemId);
        }
        // Null when the user closed the required-fields dialog: that is a
        // choice, not a failure, and an error for it would read as though
        // something broke (#662).
        const message = dragFailureMessage(error, targetCol);
        if (!message) return;
        // Not gated: a rejected transition is rare and its detail is the
        // whole point of issue #391.
        console.error('[Standup DnD] state change failed — rolling back', {
          itemId: activeItemId,
          fromColumn: originalCol?.name,
          targetColumn: targetCol,
          resolvedState,
          error,
        });
        toast.error(message);
      } finally {
        setPendingMoves((count) => Math.max(0, count - 1));
      }
    },
    [
      onStateChange,
      onStateChangeAbandoned,
      findColumn,
      columnNames,
      columns,
      allowedStatesByProjectType,
      putBackDragged,
      propItems,
      blockedColumns,
    ]
  );

  const handleDragCancel = useCallback(
    (event: DragCancelEvent) => {
      setActiveId(null);
      putBackDragged(event.active.id as number);
    },
    [putBackDragged]
  );

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
