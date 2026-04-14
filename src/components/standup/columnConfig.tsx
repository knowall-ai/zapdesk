import { CheckCircle2, Loader2, ListTodo, Circle, Ban, XCircle } from 'lucide-react';

// Map DevOps state categories to display config
const categoryConfig: Record<string, { icon: (size: number) => React.ReactNode; color: string }> = {
  Proposed: { icon: (s) => <Circle size={s} />, color: 'var(--status-new)' },
  InProgress: { icon: (s) => <Loader2 size={s} />, color: 'var(--status-progress)' },
  Resolved: { icon: (s) => <CheckCircle2 size={s} />, color: 'var(--status-resolved)' },
  Completed: { icon: (s) => <CheckCircle2 size={s} />, color: 'var(--status-resolved)' },
  Removed: { icon: (s) => <XCircle size={s} />, color: 'var(--text-muted)' },
};

// Override icon for specific state names
export function getColumnIcon(stateName: string, category: string, size = 14): React.ReactNode {
  if (stateName === 'To Do') return <ListTodo size={size} />;
  if (stateName === 'Blocked') return <Ban size={size} />;
  return categoryConfig[category]?.icon(size) || <Circle size={size} />;
}

export function getColumnColor(stateName: string, category: string): string {
  if (stateName === 'To Do') return '#eab308';
  if (stateName === 'Blocked') return '#ef4444';
  if (stateName === 'Resolved') return '#f97316';
  return categoryConfig[category]?.color || 'var(--text-muted)';
}
