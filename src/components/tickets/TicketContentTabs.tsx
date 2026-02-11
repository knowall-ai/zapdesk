'use client';

import { useState, useMemo } from 'react';

interface Tab {
  id: string;
  label: string;
  content: string;
}

interface TicketContentTabsProps {
  description: string;
  reproSteps?: string;
  systemInfo?: string;
  resolvedReason?: string;
}

export default function TicketContentTabs({
  description,
  reproSteps,
  systemInfo,
  resolvedReason,
}: TicketContentTabsProps) {
  const tabs = useMemo(() => {
    const result: Tab[] = [];

    result.push({
      id: 'description',
      label: 'Description',
      content: description || '<em>No description provided</em>',
    });

    if (reproSteps) {
      result.push({ id: 'repro-steps', label: 'Repro Steps', content: reproSteps });
    }

    if (systemInfo) {
      result.push({ id: 'system-info', label: 'System Info', content: systemInfo });
    }

    if (resolvedReason) {
      result.push({ id: 'resolution', label: 'Resolution', content: resolvedReason });
    }

    return result;
  }, [description, reproSteps, systemInfo, resolvedReason]);

  const [activeTabId, setActiveTabId] = useState(tabs[0]?.id ?? 'description');

  const activeTab = tabs.find((t) => t.id === activeTabId) ?? tabs[0];

  // Single tab — render without tab bar (preserves current look for Tasks/Features)
  if (tabs.length <= 1) {
    return (
      <div
        className="prose prose-sm prose-invert user-content max-w-none"
        style={{ color: 'var(--text-secondary)' }}
        dangerouslySetInnerHTML={{ __html: activeTab.content }}
      />
    );
  }

  return (
    <div>
      {/* Tab bar */}
      <div
        role="tablist"
        className="mb-3 flex gap-1 border-b"
        style={{ borderColor: 'var(--border)' }}
      >
        {tabs.map((tab) => (
          <button
            key={tab.id}
            role="tab"
            aria-selected={tab.id === activeTabId}
            onClick={() => setActiveTabId(tab.id)}
            className="relative px-3 py-2 text-sm font-medium transition-colors"
            style={{
              color: tab.id === activeTabId ? 'var(--primary)' : 'var(--text-muted)',
            }}
          >
            {tab.label}
            {tab.id === activeTabId && (
              <span
                className="absolute right-0 bottom-0 left-0 h-0.5 rounded-full"
                style={{ backgroundColor: 'var(--primary)' }}
              />
            )}
          </button>
        ))}
      </div>

      {/* Tab panel */}
      <div
        role="tabpanel"
        aria-labelledby={activeTabId}
        className="prose prose-sm prose-invert user-content max-w-none"
        style={{ color: 'var(--text-secondary)' }}
        dangerouslySetInnerHTML={{ __html: activeTab.content }}
      />
    </div>
  );
}
