'use client';

import { AlertTriangle } from 'lucide-react';
import { templateSupportIssueUrl } from '@/lib/github';

interface UnsupportedTemplateWarningProps {
  templateName: string;
  projectName?: string;
}

/**
 * Displays a warning when a project uses a process template that is not yet
 * supported, with a link to ask for it.
 *
 * The link builds its URL through `@/lib/github` rather than spelling it out,
 * so the repository stays configurable and in one place (#186).
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
            {templateName}&rdquo; process template which is not yet supported in ZapDesk. Some
            features like ticket creation may not work correctly.
          </p>
          <a
            href={templateSupportIssueUrl(templateName)}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-2 inline-block text-sm hover:underline"
            style={{ color: 'var(--primary)' }}
          >
            Request support for this template &rarr;
          </a>
        </div>
      </div>
    </div>
  );
}
