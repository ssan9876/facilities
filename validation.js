export const statuses = ['Open', 'In progress', 'On hold', 'Completed'];
export const priorities = ['Low', 'Normal', 'High', 'Urgent'];
export const error = (message, status = 400) => Object.assign(new Error(message), {status});
export const text = (body, key, max = 200, optional = false) => {
  const value = body?.[key];
  if (optional && (value == null || value === '')) return '';
  if (typeof value !== 'string' || !value.trim() || value.length > max)
    throw error(`${key.replaceAll('_', ' ')} is required and must be under ${max} characters.`);
  return value.trim();
};
export const date = value => {
  if (
    typeof value !== 'string' ||
    !/^\d{4}-\d{2}-\d{2}$/.test(value) ||
    Number.isNaN(Date.parse(value)) ||
    new Date(value).toISOString().slice(0, 10) !== value
  )
    throw error('Enter a valid date.');
  return value;
};
export const localTime = value =>
  typeof value === 'string' &&
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value) &&
  (() => {
    try {
      date(value.slice(0, 10));
      return true;
    } catch {
      return false;
    }
  })() &&
  Number(value.slice(11, 13)) < 24 &&
  Number(value.slice(14, 16)) < 60;
export const integer = (value, label, min, max) => {
  const n = typeof value === 'string' && value.trim() !== '' ? Number(value) : value;
  if (!Number.isInteger(n) || n < min || n > max)
    throw error(`${label} must be a whole number between ${min} and ${max}.`);
  return n;
};
export const optionalInteger = (value, label, min, max) =>
  value == null || value === '' ? null : integer(value, label, min, max);
export const bool = value => value === true || value === 'true' || value === 'on' || value === 1 || value === '1';
export const canManage = user => ['admin', 'manager'].includes(user.role);
export const manager = (req, res, next) =>
  canManage(req.user) ? next() : res.status(403).json({error: 'A manager or administrator must make this change.'});
export const admin = (req, res, next) =>
  req.user?.role === 'admin' ? next() : res.status(403).json({error: 'Administrator access required.'});
export const staff = (req, res, next) =>
  req.user.role !== 'requester' ? next() : res.status(403).json({error: 'Your role cannot access this area.'});
// Escape LIKE wildcards so search text is matched literally (used with ESCAPE '\').
export const likePattern = value =>
  '%' +
  String(value)
    .toLowerCase()
    .replace(/[\\%_]/g, c => '\\' + c) +
  '%';
