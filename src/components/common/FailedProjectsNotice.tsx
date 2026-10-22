import { AlertCircle } from 'lucide-react';

interface FailedProjectsNoticeProps {
  /** Projects whose tickets could not be read. Renders nothing when empty. */
  projects?: string[];
  /** What the missing projects make incomplete, e.g. "These figures". */
  subject?: string;
  className?: string;
}

/**
 * Says which projects' tickets could not be loaded, so a short list or a
 * clean-looking figure is not read as the whole picture (#509).
 */
export default function FailedProjectsNotice({
  projects,
  subject = 'These figures',
  className = '',
}: FailedProjectsNoticeProps) {
  if (!projects || projects.length === 0) return null;
  return (
    <p
      role="status"
      className={`flex items-start gap-2 rounded-md px-3 py-2 text-sm ${className}`}
      style={{ color: 'var(--warning)', backgroundColor: 'rgba(234, 179, 8, 0.1)' }}
    >
      <AlertCircle size={16} className="mt-0.5 shrink-0" aria-hidden="true" />
      <span>
        {subject} are incomplete: could not load tickets from {projects.join(', ')}.
      </span>
    </p>
  );
}
