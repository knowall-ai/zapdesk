'use client';

import { AlertTriangle } from 'lucide-react';

interface UnsupportedTemplateWarningProps {
  templateName: string;
  projectName?: string;
}

/**
 * Displays a warning when a project uses a process template that is not yet supported.
 * Includes a link to GitHub to request support for the template.
 */
export function UnsupportedTemplateWarning({
  templateName,
  projectName,
}: UnsupportedTemplateWarningProps) {
  const issueTitle = encodeURIComponent(`Support for ${templateName} process template`);
  const issueBody = encodeURIComponent(
    `## Request\nPlease add support for the "${templateName}" Azure DevOps process template.\n\n` +
      `## Context\n${projectName ? `Project: ${projectName}\n` : ''}Template: ${templateName}\n\n` +
      `## Additional Information\n<!-- Add any additional context about your use case -->`
  );
  const githubUrl = `https://github.com/knowall-ai/devdesk/issues/new?title=${issueTitle}&body=${issueBody}&labels=enhancement`;

  return (
    <div
      className="rounded-lg border p-4"
      style={{
        backgroundColor: 'rgba(234, 179, 8, 0.1)',
        borderColor: 'rgba(234, 179, 8, 0.3)',
      }}
    >
      <div className="flex items-start gap-3">
        <AlertTriangle className="h-5 w-5 flex-shrink-0 text-yellow-500" />
        <div className="flex-1">
          <h3 className="font-medium" style={{ color: 'var(--text-primary)' }}>
            Unsupported Process Template
          </h3>
          <p className="mt-1 text-sm" style={{ color: 'var(--text-muted)' }}>
            {projectName ? `The project "${projectName}" uses` : 'This project uses'} the &ldquo;
            {templateName}&rdquo; process template which is not yet supported in DevDesk. Some
            features like ticket creation may not work correctly.
          </p>
          <a
            href={githubUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-3 inline-block text-sm font-medium hover:underline"
            style={{ color: 'var(--primary)' }}
          >
            Request support for this template &rarr;
          </a>
        </div>
      </div>
    </div>
  );
}
