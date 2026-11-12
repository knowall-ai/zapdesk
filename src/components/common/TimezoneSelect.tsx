'use client';

import { useMemo, useState } from 'react';
import {
  filterTimezoneOptions,
  getTimezoneLabel,
  getTimezoneOptions,
  groupTimezoneOptions,
  normalizeTimezone,
} from '@/lib/timezones';

interface TimezoneSelectProps {
  /** The saved value: an IANA id, or a Windows name that is mapped to one. */
  value: string;
  /** Called with the chosen IANA id. */
  onChange: (timeZone: string) => void;
  /** Id for the `<select>`, so a `<label htmlFor>` can point at it. */
  id?: string;
  disabled?: boolean;
}

/**
 * A picker for every IANA time zone (#127). With 400+ zones a plain list is
 * hard to use, so a filter box narrows it and the zones are grouped by region.
 */
export default function TimezoneSelect({
  value,
  onChange,
  id = 'timezone-select',
  disabled,
}: TimezoneSelectProps) {
  const [query, setQuery] = useState('');
  const options = useMemo(() => getTimezoneOptions(), []);
  const selected = normalizeTimezone(value) ?? value;

  const groups = useMemo(() => {
    const filtered = filterTimezoneOptions(options, query);
    // Keep the saved zone selectable even when the filter hides it, or when
    // the runtime's list does not include it.
    if (selected && !filtered.some((o) => o.value === selected)) {
      const saved = options.find((o) => o.value === selected);
      filtered.unshift(
        saved ?? {
          value: selected,
          label: getTimezoneLabel(selected),
          offsetMinutes: 0,
          region: 'Other',
        }
      );
    }
    return groupTimezoneOptions(filtered);
  }, [options, query, selected]);

  return (
    <div className="flex flex-col gap-2">
      <input
        type="search"
        className="input w-full py-2 text-sm"
        placeholder="Search time zones (e.g. London, +05:30)"
        aria-label="Search time zones"
        aria-controls={id}
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        disabled={disabled}
      />
      <select
        id={id}
        className="input w-full py-2 text-sm"
        value={selected}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
      >
        {!selected && <option value="">Select a time zone</option>}
        {groups.map((group) => (
          <optgroup key={group.region} label={group.region}>
            {group.options.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </optgroup>
        ))}
      </select>
    </div>
  );
}
