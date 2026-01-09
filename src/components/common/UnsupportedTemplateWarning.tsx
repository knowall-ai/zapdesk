'use client';

import { AlertTriangle } from 'lucide-react';

interface UnsupportedTemplateWarningProps {
  templateName: string;
  projectName?: string;
}

/**
 * Displays a warning when a project uses a process template that is not yet supported.
 *
 * TODO: Add link to request template support once GitHub integration is implemented.
 * See src/lib/github.ts for planned approach using OAuth to discover user's repos.
 * Tracking issue: #186
 */
export function UnsupportedTemplateWarning({
  templateName,
  projectName,
}: UnsupportedTemplateWarningProps) {
  return (
    <div
      className="rounded-lg border p-4"
      style={{
        backgroundColor: 'var(--warning-bg-hover)',
        borderColor: 'var(--warning-border)',
      }}
    >
      <div className="flex items-start gap-3">
        <AlertTriangle className="h-5 w-5 flex-shrink-0" style={{ color: 'var(--warning)' }} />
        <div className="flex-1">
          <h3 className="font-medium" style={{ color: 'var(--text-primary)' }}>
            Unsupported Process Template
          </h3>
          <p className="mt-1 text-sm" style={{ color: 'var(--text-muted)' }}>
            {projectName ? `The project "${projectName}" uses` : 'This project uses'} the &ldquo;
            {templateName}&rdquo; process template which is not yet supported in DevDesk. Some
            features like ticket creation may not work correctly.
          </p>
          {/* TODO: Re-enable once GitHub integration is implemented (see #186) */}
        </div>
      </div>
    </div>
  );
}
