/**
 * Time zone options for pickers and labels (#127).
 *
 * The full IANA set comes from `Intl.supportedValuesOf('timeZone')`, so the
 * list grows with the runtime instead of being maintained by hand. Older
 * runtimes without it fall back to a short list of major zones.
 *
 * Microsoft Graph mailbox settings often hold a Windows time zone name
 * ("GMT Standard Time") rather than an IANA id, so saved values are passed
 * through `normalizeTimezone` before they are matched against the list.
 */

/** One entry in a time zone picker. */
export interface TimezoneOption {
  /** The IANA id, e.g. `Asia/Kolkata`. This is the value to save. */
  value: string;
  /** Readable label with the current UTC offset, e.g. `(UTC+05:30) Asia/Kolkata`. */
  label: string;
  /** Current offset from UTC in minutes; east of Greenwich is positive. */
  offsetMinutes: number;
  /** The id's first segment (`Asia`), or `Other` for ids like `UTC`. */
  region: string;
}

/** Used when the runtime cannot list its time zones. */
export const FALLBACK_TIMEZONES: readonly string[] = [
  'UTC',
  'Pacific/Honolulu',
  'America/Anchorage',
  'America/Los_Angeles',
  'America/Denver',
  'America/Chicago',
  'America/New_York',
  'America/Sao_Paulo',
  'Europe/London',
  'Europe/Dublin',
  'Europe/Paris',
  'Europe/Berlin',
  'Africa/Johannesburg',
  'Europe/Moscow',
  'Asia/Dubai',
  'Asia/Kolkata',
  'Asia/Singapore',
  'Asia/Shanghai',
  'Asia/Tokyo',
  'Australia/Sydney',
  'Pacific/Auckland',
];

/**
 * Windows time zone names (and a few legacy aliases) mapped to the IANA zone
 * that represents them, after the CLDR "001" territory mapping.
 */
export const LEGACY_TIMEZONE_MAP: Readonly<Record<string, string>> = {
  'Dateline Standard Time': 'Etc/GMT+12',
  'UTC-11': 'Etc/GMT+11',
  'Hawaiian Standard Time': 'Pacific/Honolulu',
  'Alaskan Standard Time': 'America/Anchorage',
  'Pacific Standard Time': 'America/Los_Angeles',
  'Pacific Standard Time (Mexico)': 'America/Tijuana',
  'US Mountain Standard Time': 'America/Phoenix',
  'Mountain Standard Time': 'America/Denver',
  'Central America Standard Time': 'America/Guatemala',
  'Central Standard Time': 'America/Chicago',
  'Central Standard Time (Mexico)': 'America/Mexico_City',
  'Canada Central Standard Time': 'America/Regina',
  'SA Pacific Standard Time': 'America/Bogota',
  'Eastern Standard Time': 'America/New_York',
  'US Eastern Standard Time': 'America/Indiana/Indianapolis',
  'Venezuela Standard Time': 'America/Caracas',
  'Atlantic Standard Time': 'America/Halifax',
  'SA Western Standard Time': 'America/La_Paz',
  'Pacific SA Standard Time': 'America/Santiago',
  'Newfoundland Standard Time': 'America/St_Johns',
  'E. South America Standard Time': 'America/Sao_Paulo',
  'Argentina Standard Time': 'America/Argentina/Buenos_Aires',
  'SA Eastern Standard Time': 'America/Cayenne',
  'Greenland Standard Time': 'America/Nuuk',
  'UTC-02': 'Etc/GMT+2',
  'Azores Standard Time': 'Atlantic/Azores',
  'Cape Verde Standard Time': 'Atlantic/Cape_Verde',
  UTC: 'UTC',
  'Coordinated Universal Time': 'UTC',
  GMT: 'UTC',
  'Etc/UTC': 'UTC',
  'GMT Standard Time': 'Europe/London',
  'Greenwich Standard Time': 'Atlantic/Reykjavik',
  'Morocco Standard Time': 'Africa/Casablanca',
  'W. Europe Standard Time': 'Europe/Berlin',
  'Central Europe Standard Time': 'Europe/Budapest',
  'Romance Standard Time': 'Europe/Paris',
  'Central European Standard Time': 'Europe/Warsaw',
  'W. Central Africa Standard Time': 'Africa/Lagos',
  'GTB Standard Time': 'Europe/Bucharest',
  'Middle East Standard Time': 'Asia/Beirut',
  'Egypt Standard Time': 'Africa/Cairo',
  'E. Europe Standard Time': 'Europe/Chisinau',
  'South Africa Standard Time': 'Africa/Johannesburg',
  'FLE Standard Time': 'Europe/Kyiv',
  'Israel Standard Time': 'Asia/Jerusalem',
  'Jordan Standard Time': 'Asia/Amman',
  'Arabic Standard Time': 'Asia/Baghdad',
  'Turkey Standard Time': 'Europe/Istanbul',
  'Arab Standard Time': 'Asia/Riyadh',
  'Russian Standard Time': 'Europe/Moscow',
  'E. Africa Standard Time': 'Africa/Nairobi',
  'Iran Standard Time': 'Asia/Tehran',
  'Arabian Standard Time': 'Asia/Dubai',
  'Azerbaijan Standard Time': 'Asia/Baku',
  'Georgian Standard Time': 'Asia/Tbilisi',
  'Afghanistan Standard Time': 'Asia/Kabul',
  'West Asia Standard Time': 'Asia/Tashkent',
  'Pakistan Standard Time': 'Asia/Karachi',
  'India Standard Time': 'Asia/Kolkata',
  'Sri Lanka Standard Time': 'Asia/Colombo',
  'Nepal Standard Time': 'Asia/Kathmandu',
  'Central Asia Standard Time': 'Asia/Almaty',
  'Bangladesh Standard Time': 'Asia/Dhaka',
  'Myanmar Standard Time': 'Asia/Yangon',
  'SE Asia Standard Time': 'Asia/Bangkok',
  'China Standard Time': 'Asia/Shanghai',
  'Singapore Standard Time': 'Asia/Singapore',
  'W. Australia Standard Time': 'Australia/Perth',
  'Taipei Standard Time': 'Asia/Taipei',
  'Tokyo Standard Time': 'Asia/Tokyo',
  'Korea Standard Time': 'Asia/Seoul',
  'Cen. Australia Standard Time': 'Australia/Adelaide',
  'AUS Central Standard Time': 'Australia/Darwin',
  'E. Australia Standard Time': 'Australia/Brisbane',
  'AUS Eastern Standard Time': 'Australia/Sydney',
  'West Pacific Standard Time': 'Pacific/Port_Moresby',
  'Tasmania Standard Time': 'Australia/Hobart',
  'Central Pacific Standard Time': 'Pacific/Guadalcanal',
  'New Zealand Standard Time': 'Pacific/Auckland',
  'Fiji Standard Time': 'Pacific/Fiji',
  'Tonga Standard Time': 'Pacific/Tongatapu',
  'Samoa Standard Time': 'Pacific/Apia',
  'Line Islands Standard Time': 'Pacific/Kiritimati',
};

/**
 * Zones IANA has renamed that ICU (and so Node and Chromium) still lists by
 * the old name, e.g. `Asia/Calcutta` for `Asia/Kolkata`. Listing and saving
 * the current name keeps one id per zone.
 */
export const RENAMED_TIMEZONES: Readonly<Record<string, string>> = {
  'Africa/Asmera': 'Africa/Asmara',
  'America/Buenos_Aires': 'America/Argentina/Buenos_Aires',
  'America/Catamarca': 'America/Argentina/Catamarca',
  'America/Coral_Harbour': 'America/Atikokan',
  'America/Cordoba': 'America/Argentina/Cordoba',
  'America/Godthab': 'America/Nuuk',
  'America/Indianapolis': 'America/Indiana/Indianapolis',
  'America/Jujuy': 'America/Argentina/Jujuy',
  'America/Louisville': 'America/Kentucky/Louisville',
  'America/Mendoza': 'America/Argentina/Mendoza',
  'Asia/Calcutta': 'Asia/Kolkata',
  'Asia/Katmandu': 'Asia/Kathmandu',
  'Asia/Rangoon': 'Asia/Yangon',
  'Asia/Saigon': 'Asia/Ho_Chi_Minh',
  'Atlantic/Faeroe': 'Atlantic/Faroe',
  'Europe/Kiev': 'Europe/Kyiv',
  'Pacific/Enderbury': 'Pacific/Kanton',
  'Pacific/Ponape': 'Pacific/Pohnpei',
  'Pacific/Truk': 'Pacific/Chuuk',
};

/** The current IANA name for `timeZone`, when the runtime accepts it. */
function currentName(timeZone: string): string {
  const renamed = RENAMED_TIMEZONES[timeZone];
  return renamed && isValidTimezone(renamed) ? renamed : timeZone;
}

/** Whether the runtime accepts `timeZone` as a time zone. */
export function isValidTimezone(timeZone: string): boolean {
  if (!timeZone) return false;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone });
    return true;
  } catch {
    return false;
  }
}

/**
 * The IANA id for a saved value: a Windows or legacy name is mapped, a valid
 * IANA id is returned as is, and anything else gives `null`.
 */
export function normalizeTimezone(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  if (!trimmed) return null;
  const timeZone = currentName(LEGACY_TIMEZONE_MAP[trimmed] ?? trimmed);
  return isValidTimezone(timeZone) ? timeZone : null;
}

type SupportedValuesOf = (key: 'timeZone') => string[];

/**
 * Every IANA zone the runtime knows, or `FALLBACK_TIMEZONES` when it cannot
 * say. Renamed zones are listed by their current name, and `UTC` is always
 * included, because some engines leave it out.
 *
 * @param supportedValuesOf Override for tests; defaults to `Intl.supportedValuesOf`.
 */
export function getTimezoneIds(supportedValuesOf?: SupportedValuesOf | null): string[] {
  const lister =
    supportedValuesOf === undefined
      ? (Intl as { supportedValuesOf?: SupportedValuesOf }).supportedValuesOf
      : supportedValuesOf;

  let ids: string[] = [];
  if (typeof lister === 'function') {
    try {
      ids = lister.call(Intl, 'timeZone');
    } catch {
      ids = [];
    }
  }
  if (ids.length === 0) ids = [...FALLBACK_TIMEZONES];
  const unique = [...new Set(ids.map(currentName))];
  return unique.includes('UTC') ? unique : ['UTC', ...unique];
}

/** The zone's offset from UTC at `date`, in minutes (east is positive). */
export function getUtcOffsetMinutes(timeZone: string, date: Date = new Date()): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: 'numeric',
    minute: 'numeric',
    second: 'numeric',
  }).formatToParts(date);
  const get = (type: Intl.DateTimeFormatPartTypes): number =>
    Number(parts.find((p) => p.type === type)?.value ?? 0);

  const wallClockAsUtc = Date.UTC(
    get('year'),
    get('month') - 1,
    get('day'),
    get('hour') % 24,
    get('minute'),
    get('second')
  );
  const wholeSeconds = Math.floor(date.getTime() / 1000) * 1000;
  return Math.round((wallClockAsUtc - wholeSeconds) / 60_000);
}

/** `330` → `UTC+05:30`, `-180` → `UTC-03:00`, `0` → `UTC+00:00`. */
export function formatUtcOffset(offsetMinutes: number): string {
  const sign = offsetMinutes < 0 ? '-' : '+';
  const abs = Math.abs(offsetMinutes);
  const hours = String(Math.floor(abs / 60)).padStart(2, '0');
  const minutes = String(abs % 60).padStart(2, '0');
  return `UTC${sign}${hours}:${minutes}`;
}

/** `America/New_York` → `America/New York`. */
function readableId(timeZone: string): string {
  return timeZone.replace(/_/g, ' ');
}

/**
 * A readable label for a saved value, e.g. `(UTC+05:30) Asia/Kolkata`.
 * Windows names are mapped first; an unrecognised value is shown as it is.
 */
export function getTimezoneLabel(value: string, date: Date = new Date()): string {
  const timeZone = normalizeTimezone(value);
  if (!timeZone) return value;
  return `(${formatUtcOffset(getUtcOffsetMinutes(timeZone, date))}) ${readableId(timeZone)}`;
}

/**
 * Picker options for every known zone, sorted by current offset then name.
 *
 * @param date The moment offsets are taken at, so daylight saving shows correctly.
 * @param supportedValuesOf Override for tests; see `getTimezoneIds`.
 */
export function getTimezoneOptions(
  date: Date = new Date(),
  supportedValuesOf?: SupportedValuesOf | null
): TimezoneOption[] {
  const options: TimezoneOption[] = [];
  for (const value of getTimezoneIds(supportedValuesOf)) {
    let offsetMinutes: number;
    try {
      offsetMinutes = getUtcOffsetMinutes(value, date);
    } catch {
      continue; // listed but unusable in this runtime
    }
    const slash = value.indexOf('/');
    options.push({
      value,
      label: `(${formatUtcOffset(offsetMinutes)}) ${readableId(value)}`,
      offsetMinutes,
      region: slash > 0 ? value.slice(0, slash) : 'Other',
    });
  }
  return options.sort(
    (a, b) => a.offsetMinutes - b.offsetMinutes || a.value.localeCompare(b.value)
  );
}

/**
 * Options whose id or label contains `query`, ignoring case and treating
 * spaces and underscores alike, so "new york", "new_york" and "+05:30" match.
 */
export function filterTimezoneOptions(
  options: readonly TimezoneOption[],
  query: string
): TimezoneOption[] {
  const needle = query.trim().toLowerCase().replace(/_/g, ' ');
  if (!needle) return [...options];
  return options.filter((o) => o.label.toLowerCase().includes(needle));
}

/** Options grouped by region, in first-seen order, for `<optgroup>`s. */
export function groupTimezoneOptions(
  options: readonly TimezoneOption[]
): { region: string; options: TimezoneOption[] }[] {
  const groups = new Map<string, TimezoneOption[]>();
  for (const option of options) {
    const list = groups.get(option.region) ?? [];
    list.push(option);
    groups.set(option.region, list);
  }
  return [...groups.entries()]
    .sort(([a], [b]) => (a === 'Other' ? 1 : b === 'Other' ? -1 : a.localeCompare(b)))
    .map(([region, opts]) => ({ region, options: opts }));
}
