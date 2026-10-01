// Saved views: a person's pinned register views (page, tab, search and filters), shown in the sidebar.
import {randomUUID} from 'node:crypto';
import {error} from './validation.js';

const pages = ['orders', 'maintenanceRequests', 'scheduleRequests', 'technologyRequests'];
const maxViews = 30;

function clean(body) {
  const name = typeof body?.name === 'string' ? body.name.trim() : '';
  if (!name || name.length > 60) throw error('Give the view a name under 60 characters.');
  if (!pages.includes(body.page)) throw error('Views can be saved for request registers.');
  const view = body.state;
  if (!view || typeof view !== 'object' || Array.isArray(view)) throw error('Send the view state.');
  const state = {
    filter: typeof view.filter === 'string' ? view.filter.slice(0, 40) : 'All',
    search: typeof view.search === 'string' ? view.search.slice(0, 200) : '',
    adv: view.adv && typeof view.adv === 'object' && !Array.isArray(view.adv) ? view.adv : {},
  };
  for (const [k, v] of Object.entries(state.adv))
    if (!/^[\w-]{1,40}$/.test(k) || typeof v !== 'string' || v.length > 400) throw error('Invalid filter in view.');
  const text = JSON.stringify(state);
  if (text.length > 4000) throw error('That view has too many filters.');
  return {name, page: body.page, state: text};
}

export function setupViews(app, db) {
  const list = async userId =>
    (await db.query('SELECT * FROM saved_views WHERE user_id=$1 ORDER BY sort,created_at', [userId])).map(v => ({
      ...v,
      state: JSON.parse(v.state),
    }));
  app.get('/api/views', async (req, res) => res.json(await list(req.user.id)));
  app.post('/api/views', async (req, res) => {
    const v = clean(req.body);
    const count = Number(
      (await db.query('SELECT COUNT(*) AS n FROM saved_views WHERE user_id=$1', [req.user.id]))[0].n,
    );
    if (count >= maxViews) throw error(`You can keep up to ${maxViews} saved views. Remove one first.`, 409);
    await db.query('INSERT INTO saved_views(id,user_id,name,page,state,sort,created_at) VALUES($1,$2,$3,$4,$5,$6,$7)', [
      randomUUID(),
      req.user.id,
      v.name,
      v.page,
      v.state,
      count,
      new Date().toISOString(),
    ]);
    res.status(201).json(await list(req.user.id));
  });
  app.patch('/api/views/:id', async (req, res) => {
    const before = (
      await db.query('SELECT * FROM saved_views WHERE id=$1 AND user_id=$2', [req.params.id, req.user.id])
    )[0];
    if (!before) throw error('View not found.', 404);
    const v = clean({name: before.name, page: before.page, state: JSON.parse(before.state), ...req.body});
    await db.query('UPDATE saved_views SET name=$1,page=$2,state=$3 WHERE id=$4', [v.name, v.page, v.state, before.id]);
    res.json(await list(req.user.id));
  });
  app.delete('/api/views/:id', async (req, res) => {
    await db.query('DELETE FROM saved_views WHERE id=$1 AND user_id=$2', [req.params.id, req.user.id]);
    res.json(await list(req.user.id));
  });
}
