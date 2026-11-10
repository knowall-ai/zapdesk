import { describe, it, expect } from 'vitest';
import {
  FALLBACK_TIMEZONES,
  LEGACY_TIMEZONE_MAP,
  RENAMED_TIMEZONES,
  filterTimezoneOptions,
  formatUtcOffset,
  getTimezoneIds,
  getTimezoneLabel,
  getTimezoneOptions,
  getUtcOffsetMinutes,
  groupTimezoneOptions,
  isValidTimezone,
  normalizeTimezone,
} from './timezones';

// Fixed moments either side of northern-hemisphere daylight saving.
const JANUARY = new Date('2026-01-15T12:00:00Z');
const JULY = new Date('2026-07-15T12:00:00Z');

describe('formatUtcOffset', () => {
  it('pads hours and minutes and signs the offset', () => {
    expect(formatUtcOffset(0)).toBe('UTC+00:00');
    expect(formatUtcOffset(330)).toBe('UTC+05:30');
    expect(formatUtcOffset(345)).toBe('UTC+05:45');
    expect(formatUtcOffset(-180)).toBe('UTC-03:00');
    expect(formatUtcOffset(-570)).toBe('UTC-09:30');
    expect(formatUtcOffset(780)).toBe('UTC+13:00');
  });
});

describe('getUtcOffsetMinutes', () => {
  it('reads fixed and half-hour offsets', () => {
    expect(getUtcOffsetMinutes('UTC', JANUARY)).toBe(0);
    expect(getUtcOffsetMinutes('Asia/Kolkata', JANUARY)).toBe(330);
    expect(getUtcOffsetMinutes('Asia/Kathmandu', JANUARY)).toBe(345);
  });

  it('follows daylight saving', () => {
    expect(getUtcOffsetMinutes('Europe/London', JANUARY)).toBe(0);
    expect(getUtcOffsetMinutes('Europe/London', JULY)).toBe(60);
    expect(getUtcOffsetMinutes('America/New_York', JANUARY)).toBe(-300);
    expect(getUtcOffsetMinutes('America/New_York', JULY)).toBe(-240);
  });
});

describe('getTimezoneIds', () => {
  it('uses the runtime list and adds UTC when it is missing', () => {
    expect(getTimezoneIds(() => ['Europe/London', 'Asia/Tokyo'])).toEqual([
      'UTC',
      'Europe/London',
      'Asia/Tokyo',
    ]);
  });

  it('falls back to the built-in list when the runtime cannot list zones', () => {
    expect(getTimezoneIds(null)).toEqual([...FALLBACK_TIMEZONES]);
    expect(getTimezoneIds(() => [])).toEqual([...FALLBACK_TIMEZONES]);
    expect(
      getTimezoneIds(() => {
        throw new RangeError('unsupported');
      })
    ).toEqual([...FALLBACK_TIMEZONES]);
  });

  it('lists renamed zones once, by their current name', () => {
    expect(getTimezoneIds(() => ['UTC', 'Asia/Calcutta', 'Asia/Kolkata', 'Europe/Kiev'])).toEqual([
      'UTC',
      'Asia/Kolkata',
      'Europe/Kyiv',
    ]);
  });

  it('lists far more than the fallback in this runtime', () => {
    expect(getTimezoneIds().length).toBeGreaterThan(300);
  });

  it('only falls back to zones the runtime accepts', () => {
    for (const id of FALLBACK_TIMEZONES) expect(isValidTimezone(id)).toBe(true);
  });
});

describe('normalizeTimezone', () => {
  it('keeps a valid IANA id', () => {
    expect(normalizeTimezone('Asia/Kolkata')).toBe('Asia/Kolkata');
    expect(normalizeTimezone(' Europe/Dublin ')).toBe('Europe/Dublin');
  });

  it('maps Windows names saved in mailbox settings', () => {
    expect(normalizeTimezone('GMT Standard Time')).toBe('Europe/London');
    expect(normalizeTimezone('Pacific Standard Time')).toBe('America/Los_Angeles');
    expect(normalizeTimezone('India Standard Time')).toBe('Asia/Kolkata');
  });

  it('maps every legacy name to a zone the runtime accepts', () => {
    for (const iana of Object.values(LEGACY_TIMEZONE_MAP)) {
      expect(isValidTimezone(iana), iana).toBe(true);
    }
  });

  it('saves the current name for a renamed zone', () => {
    expect(normalizeTimezone('Asia/Calcutta')).toBe('Asia/Kolkata');
    expect(normalizeTimezone('Europe/Kiev')).toBe('Europe/Kyiv');
  });

  it('renames only to zones the runtime accepts', () => {
    for (const iana of Object.values(RENAMED_TIMEZONES)) {
      expect(isValidTimezone(iana), iana).toBe(true);
    }
  });

  it('returns null for empty or unknown values', () => {
    expect(normalizeTimezone('')).toBeNull();
    expect(normalizeTimezone(null)).toBeNull();
    expect(normalizeTimezone(undefined)).toBeNull();
    expect(normalizeTimezone('Not/A_Zone')).toBeNull();
  });
});

describe('getTimezoneLabel', () => {
  it('shows the offset and a readable id', () => {
    expect(getTimezoneLabel('America/New_York', JANUARY)).toBe('(UTC-05:00) America/New York');
    expect(getTimezoneLabel('Asia/Kolkata', JANUARY)).toBe('(UTC+05:30) Asia/Kolkata');
  });

  it('labels a Windows name by its IANA zone', () => {
    expect(getTimezoneLabel('GMT Standard Time', JULY)).toBe('(UTC+01:00) Europe/London');
  });

  it('shows an unrecognised value unchanged', () => {
    expect(getTimezoneLabel('Somewhere Else', JANUARY)).toBe('Somewhere Else');
  });
});

describe('getTimezoneOptions', () => {
  const options = getTimezoneOptions(JANUARY, () => [
    'Asia/Kolkata',
    'America/New_York',
    'Europe/London',
    'America/Chicago',
  ]);

  it('sorts by offset, then by id', () => {
    expect(options.map((o) => o.value)).toEqual([
      'America/Chicago',
      'America/New_York',
      'Europe/London',
      'UTC',
      'Asia/Kolkata',
    ]);
  });

  it('carries a label, offset and region', () => {
    expect(options.find((o) => o.value === 'Asia/Kolkata')).toEqual({
      value: 'Asia/Kolkata',
      label: '(UTC+05:30) Asia/Kolkata',
      offsetMinutes: 330,
      region: 'Asia',
    });
    expect(options.find((o) => o.value === 'UTC')?.region).toBe('Other');
  });

  it('skips ids the runtime lists but cannot format', () => {
    const result = getTimezoneOptions(JANUARY, () => ['Europe/London', 'Not/A_Zone']);
    expect(result.map((o) => o.value)).toEqual(['Europe/London', 'UTC']);
  });
});

describe('filterTimezoneOptions', () => {
  const options = getTimezoneOptions(JANUARY, () => [
    'America/New_York',
    'Asia/Kolkata',
    'Europe/London',
  ]);

  it('matches names with spaces or underscores, ignoring case', () => {
    expect(filterTimezoneOptions(options, 'new york').map((o) => o.value)).toEqual([
      'America/New_York',
    ]);
    expect(filterTimezoneOptions(options, 'NEW_YORK').map((o) => o.value)).toEqual([
      'America/New_York',
    ]);
  });

  it('matches an offset', () => {
    expect(filterTimezoneOptions(options, '+05:30').map((o) => o.value)).toEqual(['Asia/Kolkata']);
  });

  it('returns everything for an empty query', () => {
    expect(filterTimezoneOptions(options, '  ')).toHaveLength(options.length);
  });
});

describe('groupTimezoneOptions', () => {
  it('groups by region alphabetically with Other last', () => {
    const options = getTimezoneOptions(JANUARY, () => [
      'Europe/London',
      'America/New_York',
      'Asia/Kolkata',
    ]);
    expect(groupTimezoneOptions(options).map((g) => g.region)).toEqual([
      'America',
      'Asia',
      'Europe',
      'Other',
    ]);
  });
});
