export { default as TicketList } from './TicketList';
export { default as TicketDetail } from './TicketDetail';
export { NewTicketModal } from './NewTicketModal';
export { default as KanbanBoard } from './KanbanBoard';
export { default as KanbanColumn } from './KanbanColumn';
export { default as KanbanCard } from './KanbanCard';
export { default as WorkItemBoard, TICKET_COLUMNS, WORKITEM_COLUMNS } from './WorkItemBoard';
export { default as WorkItemDetailDialog } from './WorkItemDetailDialog';
// Backwards compatibility alias
export { default as WorkItemList } from './WorkItemBoard';
export type { ColumnConfig, ColumnId, GroupByOption } from './WorkItemBoard';
