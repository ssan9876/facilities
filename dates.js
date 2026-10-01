export const defaultTimezone = 'America/Phoenix';
export function dateInTimezone(timezone = process.env.ORG_TIMEZONE || defaultTimezone, value = new Date()) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(value);
  const read = type => parts.find(p => p.type === type).value;
  return `${read('year')}-${read('month')}-${read('day')}`;
}
function offsetMinutes(timezone, instant) {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    })
      .formatToParts(instant)
      .map(x => [x.type, x.value]),
  );
  return (
    (Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - Math.floor(instant.getTime() / 1000) * 1000) /
    60000
  );
}
// UTC instant (ISO) of local midnight starting the given YYYY-MM-DD in the organization timezone.
export function startOfDayUtc(day, timezone = process.env.ORG_TIMEZONE || defaultTimezone) {
  const midnight = Date.parse(day + 'T00:00:00Z');
  let offset = offsetMinutes(timezone, new Date(midnight));
  offset = offsetMinutes(timezone, new Date(midnight - offset * 60000));
  return new Date(midnight - offset * 60000).toISOString();
}
export function addDays(day, days) {
  const d = new Date(day + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
