/**
 * Comment times in UK time (Europe/London), whichever zone the viewer's
 * browser is in, so everyone on a thread reads the same clock. GMT in winter,
 * BST in summer. Invalid dates give an empty string.
 */
const UK_FORMAT = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Europe/London',
  day: '2-digit',
  month: 'short',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});

/** e.g. `22 Apr 2026, 08:58 UK`. */
export function formatUkTime(value: Date | string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    UK_FORMAT.formatToParts(date).find((p) => p.type === type)?.value ?? '';
  return `${part('day')} ${part('month')} ${part('year')}, ${part('hour')}:${part('minute')} UK`;
}
