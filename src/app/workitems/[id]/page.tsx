// Internal work items (created from the Kanban Board, no "ticket" tag)
// share the same detail UI as tickets but live under a different route so
// the sidebar doesn't highlight Tickets when viewing one (issue #372).
'use client';

export { default } from '@/app/tickets/[id]/page';
