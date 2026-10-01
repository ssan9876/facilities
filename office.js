// Requesters and the office: rate the fix, reopen with a reason, reply to notification emails, the daily
// digest, and printable carbon-copy work orders.
import {randomUUID, timingSafeEqual} from 'node:crypto';
import express from 'express';
import QRCode from 'qrcode';
import {audit} from './audit.js';
import {error, text} from './validation.js';
import {canOn, applyGrants, memberships} from './permissions.js';
import {notify, preferences, moduleSettings} from './requests.js';
import {enqueueEmail, emailConfigured} from './email.js';
import {followerIds, isFollower} from './ticket-tools.js';
import {dateInTimezone} from './dates.js';
import {answersFor} from './requestforms.js';
import {orderColumns, orderJoins, ticketLabel} from './orders.js';

const escape = v =>
  String(v ?? '').replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'})[c]);
const now = () => new Date().toISOString();

export async function ratingFor(db, orderId) {
  return (await db.query('SELECT score,comment,created_at FROM order_ratings WHERE order_id=$1', [orderId]))[0] || null;
}
// May this person still see the ticket? (Used by email replies, which arrive without a session.)
async function canSee(db, user, order) {
  return (
    order.requester_id === user.id ||
    order.assignee_id === user.id ||
    canOn(user, 'requests.view_all', order) ||
    (await isFollower(db, order.id, user.id))
  );
}

// Keeps the reply and drops the quoted message below it.
export function stripQuoted(body) {
  const lines = String(body || '')
    .replace(/\r\n/g, '\n')
    .split('\n');
  const out = [];
  for (const line of lines) {
    if (/^\s*>/.test(line)) break;
    if (/^On .+wrote:\s*$/.test(line.trim())) break;
    if (/^-{2,}\s*Original Message\s*-{2,}/i.test(line.trim())) break;
    if (/^(From|Sent|To|Subject):\s/.test(line) && out.length) break;
    if (/^_{8,}$/.test(line.trim())) break;
    out.push(line);
  }
  return out
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

// Mounted before sign-in: the mail provider has no session, only the shared key.
export function setupInbound(app, db, env, {logger} = {}) {
  // Mail providers (Cloudflare Email Workers, Postmark, Mailgun, …) post inbound mail here with the shared
  // key. The reply address token names the ticket and the person; the From header is never trusted.
  const key = env.INBOUND_EMAIL_KEY || '';
  const keyOk = given =>
    key.length >= 16 &&
    typeof given === 'string' &&
    given.length === key.length &&
    timingSafeEqual(Buffer.from(given), Buffer.from(key));
  app.post(
    '/api/inbound/email',
    express.json({limit: '10mb'}),
    express.urlencoded({extended: false, limit: '10mb'}),
    async (req, res) => {
      if (!keyOk(req.query.key || req.get('x-inbound-key'))) return res.status(401).json({error: 'Unknown key.'});
      const b = req.body || {};
      const recipients = [b.to, b.To, b.recipient, b.OriginalRecipient, ...(b.ToFull || []).map(x => x.Email)]
        .filter(Boolean)
        .join(',');
      const token = recipients.match(/\+([a-f0-9]{20})@/i)?.[1]?.toLowerCase();
      const raw = b.StrippedTextReply || b['stripped-text'] || b.text || b.TextBody || b['body-plain'] || '';
      const body = stripQuoted(raw).slice(0, 5000);
      if (!token) return res.status(202).json({ignored: 'No reply address in the recipients.'});
      const link = (
        await db.query('SELECT * FROM reply_tokens WHERE token=$1 AND created_at>$2', [
          token,
          new Date(Date.now() - 60 * 86400000).toISOString(),
        ])
      )[0];
      if (!link) return res.status(202).json({ignored: 'Unknown or expired reply address.'});
      const person = (await db.query('SELECT id,name,role,active FROM users WHERE id=$1', [link.user_id]))[0];
      const order = (await db.query('SELECT * FROM work_orders WHERE id=$1', [link.order_id]))[0];
      if (!person?.active || !order) return res.status(202).json({ignored: 'The person or request no longer exists.'});
      const user = applyGrants(
        db,
        {id: person.id, name: person.name, role: person.role},
        await memberships(db, person.id),
      );
      if (!(await canSee(db, user, order))) return res.status(202).json({ignored: 'No longer allowed to see it.'});
      if (!body) return res.status(202).json({ignored: 'The reply was empty.'});
      await db.query('INSERT INTO comments(id,work_order_id,user_id,body,created_at) VALUES($1,$2,$3,$4,$5)', [
        randomUUID(),
        order.id,
        user.id,
        body,
        now(),
      ]);
      await audit(db, user, 'comment.create', 'work_order', order.id, 'Added a comment by email');
      await notify(
        db,
        order,
        'comment',
        [order.requester_id, order.assignee_id, ...(await followerIds(db, order.id))],
        user.id,
        `${user.name} replied by email.`,
      );
      logger?.info('email reply added', {order: order.id});
      res.json({ok: true});
    },
  );
}

export function setupOffice(app, db, env, {accessibleOrder, logger}) {
  const timezone = env.ORG_TIMEZONE || 'America/Phoenix';
  const appUrl = (env.APP_URL || 'http://localhost:3000').replace(/\/$/, '');

  // ---- Rate the fix ----
  app.post('/api/orders/:id/rating', async (req, res) => {
    const order = await accessibleOrder(req);
    if (order.requester_id !== req.user.id) throw error('Only the person who asked for the work can rate it.', 403);
    if (order.status !== 'Completed') throw error('Requests can be rated once they are resolved.');
    const score = Number(req.body?.score);
    if (!Number.isInteger(score) || score < 1 || score > 5) throw error('Choose 1 to 5 stars.');
    const comment = text(req.body, 'comment', 1000, true);
    await db.query(
      'INSERT INTO order_ratings(order_id,user_id,score,comment,created_at) VALUES($1,$2,$3,$4,$5) ON CONFLICT(order_id) DO UPDATE SET score=$3,comment=$4,created_at=$5',
      [order.id, req.user.id, score, comment, now()],
    );
    await audit(db, req.user, 'order.rate', 'work_order', order.id, `Rated the fix ${score} of 5`);
    if (score <= 2 && order.assignee_id)
      await notify(
        db,
        order,
        'status',
        [order.assignee_id],
        req.user.id,
        `${req.user.name} rated the fix ${score} of 5.`,
      );
    res.json(await ratingFor(db, order.id));
  });

  // ---- Reopen with a reason (the requester, or anyone who may update the ticket) ----
  app.post('/api/orders/:id/reopen', async (req, res) => {
    const order = await accessibleOrder(req);
    const may =
      order.requester_id === req.user.id ||
      canOn(req.user, 'requests.update_any', order) ||
      (order.assignee_id === req.user.id && canOn(req.user, 'requests.update_assigned', order));
    if (!may) throw error('Your role cannot reopen this request.', 403);
    if (order.status !== 'Completed') throw error('Only resolved requests can be reopened.');
    const reason = text(req.body, 'reason', 2000);
    const at = now();
    await db.transaction(async tx => {
      await tx.query(
        "UPDATE work_orders SET status='Open',completed_at=NULL,updated_at=$1,sla_warned_at=NULL,sla_breached_at=NULL WHERE id=$2",
        [at, order.id],
      );
      await tx.query('INSERT INTO comments(id,work_order_id,user_id,body,created_at) VALUES($1,$2,$3,$4,$5)', [
        randomUUID(),
        order.id,
        req.user.id,
        `Reopened: ${reason}`,
        at,
      ]);
      await audit(tx, req.user, 'order.update', 'work_order', order.id, 'Reopened the request', {
        status: ['Completed', 'Open'],
      });
    });
    await notify(
      db,
      order,
      'status',
      [order.requester_id, order.assignee_id, ...(await followerIds(db, order.id))],
      req.user.id,
      `${req.user.name} reopened this request: ${reason.slice(0, 120)}`,
    );
    res.json({ok: true});
  });

  // ---- Daily digest (morning, organization time) ----
  const digestHour = Number(env.DIGEST_HOUR ?? 7);
  async function sendDigests(force = false) {
    if (!emailConfigured() || !(await moduleSettings(db)).email) return 0;
    const today = dateInTimezone(timezone);
    const hour = Number(
      new Intl.DateTimeFormat('en-US', {timeZone: timezone, hour: 'numeric', hourCycle: 'h23'}).format(new Date()),
    );
    const last = (await db.query("SELECT body FROM admin_settings WHERE id='digest'"))[0]?.body;
    if (!force && (hour < digestHour || last === JSON.stringify(today))) return 0;
    await db.query("INSERT INTO admin_settings VALUES('digest',$1) ON CONFLICT(id) DO UPDATE SET body=$1", [
      JSON.stringify(today),
    ]);
    let sent = 0;
    const since = new Date(Date.now() - 86400000).toISOString();
    for (const u of await db.query("SELECT id,name,email FROM users WHERE active=1 AND email<>''")) {
      const prefs = await preferences(db, u.id);
      if (!prefs.email || !prefs.digest) continue;
      const [news, mine] = await Promise.all([
        db.query(
          'SELECT n.message,w.number,w.title FROM notifications n JOIN work_orders w ON w.id=n.order_id WHERE n.user_id=$1 AND n.created_at>$2 AND n.read_at IS NULL ORDER BY n.created_at DESC LIMIT 20',
          [u.id, since],
        ),
        db.query(
          "SELECT number,title,due_date FROM work_orders WHERE assignee_id=$1 AND status<>'Completed' ORDER BY due_date LIMIT 15",
          [u.id],
        ),
      ]);
      const due = mine.filter(o => o.due_date && o.due_date <= today);
      if (!news.length && !mine.length) continue;
      const line = o => `  ${ticketLabel(o.number)}  ${o.title}${o.due_date ? `  (due ${o.due_date})` : ''}`;
      const body = [
        `Good morning, ${u.name}. Here is your day in {{ORG}}.`,
        due.length ? `\nDue today or overdue (${due.length}):\n${due.map(line).join('\n')}` : '',
        mine.length ? `\nYour open work (${mine.length}):\n${mine.map(line).join('\n')}` : '',
        news.length
          ? `\nUpdates since yesterday (${news.length}):\n${news.map(n => `  ${ticketLabel(n.number)}  ${n.title}: ${n.message}`).join('\n')}`
          : '',
        `\nOpen {{ORG}}: {{APP_URL}}\nYou receive this digest instead of individual emails. Change it under Notifications → Preferences.`,
      ]
        .filter(Boolean)
        .join('\n');
      if (
        await enqueueEmail(db, {
          userId: u.id,
          to: u.email,
          subject: `Your day: ${due.length} due, ${mine.length} open`,
          body,
        })
      )
        sent++;
    }
    return sent;
  }
  const digestTimer = setInterval(
    () => sendDigests().catch(err => logger?.warn('digest failed', {error: err.message})),
    600000,
  );
  digestTimer.unref();

  // ---- Printable work orders: requester (white), technician (canary) and office (pink) copies ----
  const copies = {requester: 'Requester copy', technician: 'Technician copy', office: 'Office copy'};
  app.get('/print', async (req, res) => {
    if (!req.user) return res.redirect(`/auth/login?return=${encodeURIComponent(req.originalUrl)}`);
    const refs = String(req.query.tickets || '')
      .split(',')
      .map(s => s.trim())
      .filter(Boolean)
      .slice(0, 50);
    const wanted = String(req.query.copies || 'technician')
      .split(',')
      .filter(c => copies[c]);
    if (!refs.length || !wanted.length) return res.status(400).type('text/plain').send('Choose tickets to print.');
    const sheets = [];
    for (const ref of refs) {
      const number = ref.match(/^(?:wo-?)?0*(\d{1,9})$/i);
      const row = (
        await db.query(`SELECT ${orderColumns} ${orderJoins} WHERE ${number ? 'w.number=$1' : 'w.id=$1'}`, [
          number ? Number(number[1]) : ref,
        ])
      )[0];
      if (!row) continue;
      try {
        await accessibleOrder(req, row.id);
      } catch {
        continue;
      }
      const [answers, checklist] = await Promise.all([
        answersFor(db, row.id),
        db.query('SELECT label,done_at FROM checklist_items WHERE order_id=$1 ORDER BY sort,created_at', [row.id]),
      ]);
      const link = `${appUrl}/tickets/${ticketLabel(row.number)}`;
      const qr = await QRCode.toString(link, {type: 'svg', margin: 0, errorCorrectionLevel: 'M'});
      const field = (label, value) =>
        `<div class="f"><span>${label}</span><strong>${escape(value) || '—'}</strong></div>`;
      for (const copy of wanted)
        sheets.push(
          `<article class="sheet ${copy}"><header><div><span class="no">${escape(ticketLabel(row.number))}</span><h1>${escape(row.title)}</h1></div><div class="copy">${copies[copy]}</div></header><div class="grid">${field('Status', row.status)}${field('Priority', row.priority)}${field('Type', row.request_type)}${field('Category', row.category)}${field('Building', row.building)}${field('Asset', row.asset)}${field(row.request_type === 'schedule' ? 'Starts' : 'Due', row.request_type === 'schedule' ? row.starts_at : row.due_date)}${field('Requested by', row.requester)}${field('Assigned to', row.assignee)}${field('Opened', row.created_at.slice(0, 10))}</div><section><h2>Description of work</h2><p>${escape(row.description) || '—'}</p>${answers.length ? `<dl>${answers.map(a => `<div><dt>${escape(a.label)}</dt><dd>${escape(a.value)}</dd></div>`).join('')}</dl>` : ''}</section>${checklist.length ? `<section><h2>Checklist</h2><ul class="boxes">${checklist.map(i => `<li><span class="box">${i.done_at ? '✓' : ''}</span>${escape(i.label)}</li>`).join('')}</ul></section>` : ''}<section class="work"><h2>Work performed</h2><div class="lines"></div></section><footer><div class="sign"><span>Technician</span></div><div class="sign"><span>Date / time completed</span></div><div class="sign"><span>Requester sign-off</span></div><div class="qr">${qr}<small>Scan to open the ticket</small></div></footer></article>`,
        );
    }
    if (!sheets.length) return res.status(404).type('text/plain').send('No tickets you can see were found.');
    res
      .type('html')
      .send(
        `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Work orders</title><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/print.css"></head><body><div class="toolbar"><button type="button" id="print">Print</button><span>${sheets.length} page${sheets.length === 1 ? '' : 's'}</span></div>${sheets.join('')}<script src="/print.js"></script></body></html>`,
      );
  });
  return {sendDigests};
}
