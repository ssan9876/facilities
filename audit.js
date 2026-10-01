import {randomUUID} from 'node:crypto';
import {section, error, likePattern} from './validation.js';
import {csv} from './csv.js';

export const systemActor = {id: null, name: 'System'};
// Actor is a signed-in user, a provisioning connection ({id:null,name:'Provisioning · Syntra'}) or the system.
export async function audit(db, actor, action, entityType, entityId, summary, details) {
  await db.query(
    'INSERT INTO audit_log(id,created_at,actor_id,actor_name,action,entity_type,entity_id,summary,details) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)',
    [
      randomUUID(),
      new Date().toISOString(),
      actor?.id ?? null,
      actor?.name || 'System',
      action,
      entityType,
      entityId ?? null,
      summary,
      details && Object.keys(details).length ? JSON.stringify(details) : null,
    ],
  );
}
// Field-level before/after values for the audit record; unchanged fields are omitted.
export function changes(before, after, fields) {
  const out = {};
  for (const f of fields)
    if (f in after && String(before?.[f] ?? '') !== String(after[f] ?? ''))
      out[f] = [before?.[f] ?? null, after[f] ?? null];
  return out;
}
const parse = row => ({...row, details: row.details ? JSON.parse(row.details) : null});

export async function auditQuery(db, {entityType, entityId, actor, search, from, to, before, limit = 100}) {
  const where = [],
    values = [];
  const add = (sql, value) => {
    values.push(value);
    where.push(sql.replace('?', '$' + values.length));
  };
  if (entityType) add('entity_type=?', entityType);
  if (entityId) add('entity_id=?', entityId);
  if (actor) add('actor_id=?', actor);
  if (search) {
    values.push(likePattern(search));
    where.push(
      `(LOWER(summary) LIKE $${values.length} ESCAPE '\\' OR LOWER(actor_name) LIKE $${values.length} ESCAPE '\\')`,
    );
  }
  if (from) add('created_at>=?', from);
  if (to) add('created_at<?', to);
  if (before) {
    // Cursor is "created_at|id" so entries sharing a timestamp are neither skipped nor repeated.
    const [at, id = ''] = String(before).split('|');
    values.push(at, id);
    where.push(`(created_at<$${values.length - 1} OR (created_at=$${values.length - 1} AND id<$${values.length}))`);
  }
  values.push(limit + 1);
  const rows = await db.query(
    `SELECT * FROM audit_log ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY created_at DESC, id DESC LIMIT $${values.length}`,
    values,
  );
  return {
    entries: rows.slice(0, limit).map(parse),
    next: rows.length > limit ? `${rows[limit - 1].created_at}|${rows[limit - 1].id}` : null,
  };
}

export function setupAudit(app, db) {
  const filters = req => {
    const limit = req.query.limit ? Number(req.query.limit) : 100;
    if (!Number.isInteger(limit) || limit < 1 || limit > 500) throw error('limit must be between 1 and 500.');
    const day = v => {
      if (!v) return undefined;
      if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) throw error('Dates must use YYYY-MM-DD.');
      return v;
    };
    const to = day(req.query.to);
    return {
      entityType: req.query.entity_type || undefined,
      entityId: req.query.entity_id || undefined,
      actor: req.query.actor || undefined,
      search: req.query.q ? String(req.query.q).slice(0, 200) : undefined,
      from: day(req.query.from),
      to: to && new Date(Date.parse(to) + 86400000).toISOString().slice(0, 10),
      before: req.query.before || undefined,
      limit,
    };
  };
  app.get('/api/admin/audit', section('audit'), async (req, res) => res.json(await auditQuery(db, filters(req))));
  app.get('/api/admin/audit.csv', section('audit'), async (req, res) => {
    const {entries} = await auditQuery(db, {...filters(req), limit: 50000});
    res
      .attachment(`audit-${new Date().toISOString().slice(0, 10)}.csv`)
      .type('text/csv')
      .send(
        csv(
          ['Time', 'Actor', 'Action', 'Record type', 'Record ID', 'Summary', 'Details'],
          entries.map(e => [
            e.created_at,
            e.actor_name,
            e.action,
            e.entity_type,
            e.entity_id,
            e.summary,
            e.details ? JSON.stringify(e.details) : '',
          ]),
        ),
      );
  });
}
