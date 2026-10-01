export const defaultTimezone = 'America/Phoenix';
export function dateInTimezone(timezone = process.env.ORG_TIMEZONE || defaultTimezone, value = new Date()) {
  const parts = new Intl.DateTimeFormat('en-US', {timeZone:timezone,year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(value);
  const read = type => parts.find(p=>p.type===type).value;
  return `${read('year')}-${read('month')}-${read('day')}`;
}
