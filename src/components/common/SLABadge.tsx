'use client';

import type { TicketSLAInfo, SLALevel, SLAStatus } from '@/types';
import { formatDuration, getSLAStatusLabel } from '@/lib/sla';

interface SLABadgeProps {
  slaInfo?: TicketSLAInfo;
  variant?: 'compact' | 'full';
  showLevel?: boolean;
}

interface SLALevelBadgeProps {
  level: SLALevel;
  size?: 'sm' | 'md';
}

// Status icons for visual indication
const statusIcons: Record<SLAStatus, string> = {
  within_sla: '✓',
  at_risk: '⚠',
  breached: '✗',
};

// CSS classes for SLA levels
const levelClasses: Record<SLALevel, string> = {
  Gold: 'sla-level-gold',
  Silver: 'sla-level-silver',
  Bronze: 'sla-level-bronze',
};

// CSS classes for SLA status
const statusClasses: Record<SLAStatus, string> = {
  within_sla: 'sla-within',
  at_risk: 'sla-at-risk',
  breached: 'sla-breached',
};

/**
 * Get the most critical SLA status from first response and resolution
 * Priority: breached > at_risk > within_sla
 */
function getOverallSLAStatus(slaInfo: TicketSLAInfo): SLAStatus {
  const statuses = [slaInfo.firstResponse.status, slaInfo.resolution.status];
  if (statuses.includes('breached')) return 'breached';
  if (statuses.includes('at_risk')) return 'at_risk';
  return 'within_sla';
}

/**
 * Get CSS class for a given SLA status
 */
function getStatusClass(status: SLAStatus): string {
  return statusClasses[status];
}

export function SLALevelBadge({ level, size = 'md' }: SLALevelBadgeProps) {
  return (
    <span
      className={`sla-badge ${levelClasses[level]} ${
        size === 'sm' ? 'px-1.5 py-0.5 text-[10px]' : ''
      }`}
    >
      {level}
    </span>
  );
}

export default function SLABadge({
  slaInfo,
  variant = 'compact',
  showLevel = false,
}: SLABadgeProps) {
  if (!slaInfo) {
    return null;
  }

  const overallStatus = getOverallSLAStatus(slaInfo);
  const statusClass = getStatusClass(overallStatus);

  // For compact view, show the most urgent time remaining
  const getCompactDisplay = () => {
    // If first response hasn't been met, show that time
    if (!slaInfo.firstResponse.met) {
      const remaining = slaInfo.firstResponse.remainingMinutes;
      if (remaining <= 0) {
        return 'Response overdue';
      }
      return `Response: ${formatDuration(remaining)}`;
    }

    // If resolution hasn't been met, show that time
    if (!slaInfo.resolution.met) {
      const remaining = slaInfo.resolution.remainingMinutes;
      if (remaining <= 0) {
        return 'Resolution overdue';
      }
      return `Resolution: ${formatDuration(remaining)}`;
    }

    // Both met
    return 'SLA Met';
  };

  if (variant === 'compact') {
    return (
      <div className="flex items-center gap-2">
        {showLevel && <SLALevelBadge level={slaInfo.level} size="sm" />}
        <span className={`sla-badge ${statusClass}`}>
          {statusIcons[overallStatus]} {getCompactDisplay()}
        </span>
      </div>
    );
  }

  // Full variant with both first response and resolution times
  const firstResponseClass = getStatusClass(slaInfo.firstResponse.status);
  const resolutionClass = getStatusClass(slaInfo.resolution.status);

  return (
    <div className="space-y-2">
      {showLevel && (
        <div className="flex items-center gap-2">
          <span className="text-xs" style={{ color: 'var(--text-muted)' }}>
            SLA Level:
          </span>
          <SLALevelBadge level={slaInfo.level} />
        </div>
      )}

      <div className="space-y-1">
        {/* First Response */}
        <div className="flex items-center justify-between text-xs">
          <span style={{ color: 'var(--text-muted)' }}>First Response:</span>
          <span className={`sla-badge ${firstResponseClass}`}>
            {statusIcons[slaInfo.firstResponse.status]}{' '}
            {slaInfo.firstResponse.met
              ? `Met (${formatDuration(slaInfo.firstResponse.elapsedMinutes)})`
              : slaInfo.firstResponse.remainingMinutes > 0
                ? formatDuration(slaInfo.firstResponse.remainingMinutes)
                : 'Overdue'}
          </span>
        </div>

        {/* Resolution */}
        <div className="flex items-center justify-between text-xs">
          <span style={{ color: 'var(--text-muted)' }}>Resolution:</span>
          <span className={`sla-badge ${resolutionClass}`}>
            {statusIcons[slaInfo.resolution.status]}{' '}
            {slaInfo.resolution.met
              ? `Met (${formatDuration(slaInfo.resolution.elapsedMinutes)})`
              : slaInfo.resolution.remainingMinutes > 0
                ? formatDuration(slaInfo.resolution.remainingMinutes)
                : 'Overdue'}
          </span>
        </div>
      </div>

      {/* SLA Target Info */}
      <div
        className="border-t pt-1 text-[10px]"
        style={{ borderColor: 'var(--border)', color: 'var(--text-muted)' }}
      >
        Target: {formatDuration(slaInfo.firstResponse.targetMinutes)} response /{' '}
        {formatDuration(slaInfo.resolution.targetMinutes)} resolution
      </div>
    </div>
  );
}

// Export a simple status indicator for use in lists
export function SLAStatusIndicator({ slaInfo }: { slaInfo?: TicketSLAInfo }) {
  if (!slaInfo) return null;

  const status = getOverallSLAStatus(slaInfo);

  // Use CSS variables for consistent theming
  const colorStyle =
    status === 'within_sla'
      ? { backgroundColor: 'var(--status-resolved)' }
      : status === 'at_risk'
        ? { backgroundColor: 'var(--status-open)' }
        : { backgroundColor: 'var(--priority-urgent)' };

  return (
    <span
      className="inline-block h-2 w-2 rounded-full"
      style={colorStyle}
      title={getSLAStatusLabel(status)}
    />
  );
}
