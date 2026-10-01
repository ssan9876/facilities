import {randomUUID} from 'node:crypto';
import {admin, error, text, date} from './validation.js';
import {audit, changes} from './audit.js';
import {requestTypes} from './requests.js';

// What a new ticket asks for, per request type: rules for the built-in fields, admin-defined
// categories, and custom questions (for the whole type or one category).
export const fieldKinds = ['text', 'textarea', 'number', 'date', 'select', 'yesno', 'checkbox'];
const modes = {
  category: ['required', 'optional', 'hidden'],
  asset: ['required', 'optional', 'hidden'],
  description: ['required', 'optional', 'hidden'],
  photos: ['required', 'optional', 'hidden'],
  priority: ['optional', 'hidden'],
  due_date: ['optional', 'hidden'],
};
export const defaultRules = {
  category: 'optional',
  asset: 'optional',
  description: 'optional',
  photos: 'optional',
  priority: 'optional',
  due_date: 'optional',
};

const json = v => (typeof v === 'string' ? JSON.parse(v) : v);
export async function formConfig(db, {includeArchived = false} = {}) {
  const [settings, categories, fields] = await Promise.all([
    db.query("SELECT id, body FROM admin_settings WHERE id LIKE 'form:%'"),
    db.query(`SELECT * FROM categories ${includeArchived ? '' : 'WHERE archived_at IS NULL'} ORDER BY sort, name`),
    db.query(
      `SELECT * FROM form_fields ${includeArchived ? '' : 'WHERE archived_at IS NULL'} ORDER BY sort, created_at`,
    ),
  ]);
  const config = {};
  for (const type of requestTypes) {
    const saved = settings.find(r => r.id === 'form:' + type);
    config[type] = {
      rules: {...defaultRules, ...(saved ? JSON.parse(saved.body) : {})},
      categories: categories.filter(c => c.request_type === type),
      fields: fields
        .filter(f => f.request_type === type)
        .map(f => ({...f, options: json(f.options), required: !!Number(f.required)})),
    };
  }
  return config;
}

// Normalizes one answer to its stored text, or throws a message naming the question.
function answerValue(field, raw) {
  const empty =
    raw === undefined ||
    raw === null ||
    raw === '' ||
    (field.kind === 'checkbox' && !(raw === true || raw === 'true' || raw === 'on'));
  if (empty) {
    if (field.required) throw error(`${field.label} is required.`);
    return null;
  }
  const s = String(raw).trim();
  switch (field.kind) {
    case 'text':
      if (s.length > 500) throw error(`${field.label} must be under 500 characters.`);
      return s;
    case 'textarea':
      if (s.length > 5000) throw error(`${field.label} must be under 5000 characters.`);
      return s;
    case 'number':
      if (!/^-?\d{1,12}(\.\d{1,4})?$/.test(s)) throw error(`${field.label} must be a number.`);
      return s;
    case 'date':
      try {
        return date(s);
      } catch {
        throw error(`${field.label} must be a valid date.`);
      }
    case 'select':
      if (!field.options.includes(s)) throw error(`Choose one of the listed options for ${field.label}.`);
      return s;
    case 'yesno':
      if (!['Yes', 'No'].includes(s)) throw error(`Answer yes or no for ${field.label}.`);
      return s;
    case 'checkbox':
      return 'Yes';
    default:
      throw error('Unknown question type.');
  }
}

// Validates the configurable parts of a submission. Returns the category and answers to store and
// applies hidden-field defaults to the body (priority Normal, due today).
export async function checkSubmission(db, type, body, {today, existing} = {}) {
  const form = (await formConfig(db))[type];
  if (!form) return {category_id: null, answers: []};
  const {rules} = form;
  let category = existing ? existing.category_id : null;
  if (!existing || 'category_id' in body) category = body.category_id || null;
  if (rules.category === 'hidden') category = existing?.category_id ?? null;
  if (category && !form.categories.some(c => c.id === category) && category !== existing?.category_id)
    throw error('Choose one of the listed categories.');
  if (!category && rules.category === 'required' && form.categories.length) throw error('Choose a category.');
  if (!existing) {
    if (rules.asset === 'required' && !body.asset_id) throw error('Choose the asset this request is about.');
    if (rules.description === 'required' && !String(body.description || '').trim())
      throw error('Describe the request in Details.');
    if (rules.priority === 'hidden') body.priority = 'Normal';
    if (rules.due_date === 'hidden' && type !== 'schedule') body.due_date = today;
  }
  const applicable = form.fields.filter(f => !f.category_id || f.category_id === category);
  const answers = [];
  if (!existing || 'answers' in body) {
    const given = body.answers && typeof body.answers === 'object' && !Array.isArray(body.answers) ? body.answers : {};
    for (const field of applicable) {
      const value = answerValue(field, given[field.id]);
      if (value !== null) answers.push({field_id: field.id, value});
    }
  }
  return {category_id: category, answers, rules, replaceAnswers: !existing || 'answers' in body};
}
export async function saveAnswers(tx, orderId, answers) {
  await tx.query('DELETE FROM order_answers WHERE order_id=$1', [orderId]);
  for (const a of answers)
    await tx.query('INSERT INTO order_answers(order_id,field_id,value) VALUES($1,$2,$3)', [
      orderId,
      a.field_id,
      a.value,
    ]);
}
export const answersFor = (db, orderId) =>
  db.query(
    'SELECT a.field_id, a.value, f.label, f.kind FROM order_answers a JOIN form_fields f ON f.id=a.field_id WHERE a.order_id=$1 ORDER BY f.sort, f.created_at',
    [orderId],
  );

export function setupRequestForms(app, db) {
  const known = type => {
    if (!requestTypes.includes(type)) throw error('Unknown request type.', 404);
    return type;
  };
  app.get('/api/forms', async (req, res) =>
    res.json(
      await formConfig(db, {includeArchived: req.query.all === '1' && req.user.capabilities?.includes('admin')}),
    ),
  );
  app.put('/api/admin/forms/:type/rules', admin, async (req, res) => {
    const type = known(req.params.type);
    const before = (await formConfig(db))[type].rules;
    const next = {...before};
    for (const [key, allowed] of Object.entries(modes)) {
      if (req.body?.[key] === undefined) continue;
      if (!allowed.includes(req.body[key])) throw error(`Choose ${allowed.join(', ')} for ${key.replace('_', ' ')}.`);
      next[key] = req.body[key];
    }
    await db.query('INSERT INTO admin_settings(id,body) VALUES($1,$2) ON CONFLICT(id) DO UPDATE SET body=$2', [
      'form:' + type,
      JSON.stringify(next),
    ]);
    await audit(
      db,
      req.user,
      'form.rules',
      'settings',
      'form:' + type,
      `Updated the ${type} request form`,
      changes(before, next, Object.keys(modes)),
    );
    res.json(next);
  });

  // Categories
  app.post('/api/admin/forms/:type/categories', admin, async (req, res) => {
    const type = known(req.params.type);
    const row = {
      id: randomUUID(),
      name: text(req.body, 'name', 80),
      description: text(req.body, 'description', 200, true),
      sort: Number((await db.query('SELECT COUNT(*) AS n FROM categories WHERE request_type=$1', [type]))[0].n),
    };
    if (
      (
        await db.query(
          'SELECT id FROM categories WHERE request_type=$1 AND LOWER(name)=LOWER($2) AND archived_at IS NULL',
          [type, row.name],
        )
      ).length
    )
      throw error('This type already has a category with that name.', 409);
    await db.query(
      'INSERT INTO categories(id,request_type,name,description,sort,created_at) VALUES($1,$2,$3,$4,$5,$6)',
      [row.id, type, row.name, row.description, row.sort, new Date().toISOString()],
    );
    await audit(db, req.user, 'category.create', 'category', row.id, `Added ${type} category ${row.name}`);
    res.status(201).json(row);
  });
  const category = async id => {
    const row = (await db.query('SELECT * FROM categories WHERE id=$1', [id]))[0];
    if (!row) throw error('Category not found.', 404);
    return row;
  };
  app.patch('/api/admin/categories/:id', admin, async (req, res) => {
    const before = await category(req.params.id),
      body = req.body || {};
    const next = {
      name: body.name === undefined ? before.name : text(body, 'name', 80),
      description: body.description === undefined ? before.description : text(body, 'description', 200, true),
      sort: body.sort === undefined ? before.sort : Number(body.sort),
      archived_at:
        body.archived === undefined
          ? before.archived_at
          : body.archived
            ? before.archived_at || new Date().toISOString()
            : null,
    };
    if (!Number.isInteger(next.sort)) throw error('sort must be a whole number.');
    await db.query('UPDATE categories SET name=$1,description=$2,sort=$3,archived_at=$4 WHERE id=$5', [
      next.name,
      next.description,
      next.sort,
      next.archived_at,
      before.id,
    ]);
    await audit(
      db,
      req.user,
      'category.update',
      'category',
      before.id,
      `Updated category ${next.name}`,
      changes(before, next, ['name', 'description', 'archived_at']),
    );
    res.json({ok: true});
  });
  app.delete('/api/admin/categories/:id', admin, async (req, res) => {
    const row = await category(req.params.id);
    if ((await db.query('SELECT id FROM work_orders WHERE category_id=$1 LIMIT 1', [row.id])).length)
      throw error(`${row.name} is used on requests. Archive it instead to keep that history.`, 409);
    if ((await db.query('SELECT id FROM form_fields WHERE category_id=$1 LIMIT 1', [row.id])).length)
      throw error(`${row.name} has its own questions. Remove or move them first.`, 409);
    await db.query('DELETE FROM categories WHERE id=$1', [row.id]);
    await audit(db, req.user, 'category.delete', 'category', row.id, `Deleted category ${row.name}`);
    res.json({ok: true});
  });

  // Custom questions
  const fieldBody = async (type, body, before) => {
    const pick = (key, parse) => (before && body[key] === undefined ? before[key] : parse());
    const kind = pick('kind', () => body.kind);
    if (!fieldKinds.includes(kind)) throw error(`Choose a question type: ${fieldKinds.join(', ')}.`);
    let options = pick('options', () => body.options ?? []);
    if (typeof options === 'string') options = options.split('\n');
    options = json(options);
    if (!Array.isArray(options)) throw error('Options must be a list.');
    options = [...new Set(options.map(o => String(o).trim()).filter(Boolean))];
    if (kind === 'select' && (options.length < 2 || options.length > 50 || options.some(o => o.length > 100)))
      throw error('Dropdown questions need 2–50 options, each under 100 characters.');
    if (kind !== 'select') options = [];
    const categoryId = pick('category_id', () => body.category_id || null);
    if (
      categoryId &&
      !(await db.query('SELECT id FROM categories WHERE id=$1 AND request_type=$2', [categoryId, type])).length
    )
      throw error('Choose a category of this request type.');
    return {
      label: pick('label', () => text(body, 'label', 120)),
      kind,
      options,
      required: pick('required', () => body.required === true || body.required === 'true' || body.required === 'on')
        ? 1
        : 0,
      help: pick('help', () => text(body, 'help', 200, true)),
      category_id: categoryId,
    };
  };
  app.post('/api/admin/forms/:type/fields', admin, async (req, res) => {
    const type = known(req.params.type);
    const f = await fieldBody(type, req.body || {});
    const id = randomUUID();
    const sort = Number((await db.query('SELECT COUNT(*) AS n FROM form_fields WHERE request_type=$1', [type]))[0].n);
    await db.query(
      'INSERT INTO form_fields(id,request_type,category_id,label,kind,options,required,help,sort,created_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)',
      [
        id,
        type,
        f.category_id,
        f.label,
        f.kind,
        JSON.stringify(f.options),
        f.required,
        f.help,
        sort,
        new Date().toISOString(),
      ],
    );
    await audit(db, req.user, 'field.create', 'form_field', id, `Added question “${f.label}” to ${type} requests`);
    res.status(201).json({id, ...f});
  });
  const field = async id => {
    const row = (await db.query('SELECT * FROM form_fields WHERE id=$1', [id]))[0];
    if (!row) throw error('Question not found.', 404);
    return {...row, options: json(row.options)};
  };
  app.patch('/api/admin/fields/:id', admin, async (req, res) => {
    const before = await field(req.params.id),
      body = req.body || {};
    const f = await fieldBody(before.request_type, body, before);
    const sort = body.sort === undefined ? before.sort : Number(body.sort);
    if (!Number.isInteger(sort)) throw error('sort must be a whole number.');
    const archived_at =
      body.archived === undefined
        ? before.archived_at
        : body.archived
          ? before.archived_at || new Date().toISOString()
          : null;
    await db.query(
      'UPDATE form_fields SET label=$1,kind=$2,options=$3,required=$4,help=$5,category_id=$6,sort=$7,archived_at=$8 WHERE id=$9',
      [f.label, f.kind, JSON.stringify(f.options), f.required, f.help, f.category_id, sort, archived_at, before.id],
    );
    await audit(
      db,
      req.user,
      'field.update',
      'form_field',
      before.id,
      `Updated question “${f.label}”`,
      changes(before, {...f, archived_at}, ['label', 'kind', 'required', 'help', 'category_id', 'archived_at']),
    );
    res.json({ok: true});
  });
  app.delete('/api/admin/fields/:id', admin, async (req, res) => {
    const row = await field(req.params.id);
    if ((await db.query('SELECT order_id FROM order_answers WHERE field_id=$1 LIMIT 1', [row.id])).length)
      throw error(`“${row.label}” has answers on requests. Archive it instead to keep them.`, 409);
    await db.query('DELETE FROM form_fields WHERE id=$1', [row.id]);
    await audit(db, req.user, 'field.delete', 'form_field', row.id, `Deleted question “${row.label}”`);
    res.json({ok: true});
  });
}
