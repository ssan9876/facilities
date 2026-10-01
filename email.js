import nodemailer from 'nodemailer';
import {randomUUID} from 'node:crypto';
import {admin, error} from './validation.js';
import {audit} from './audit.js';

// Messages are written to email_outbox and sent by a background worker with retries,
// so a slow or unavailable mail server never delays or fails a request.
const retryMinutes = [1, 5, 30, 120];
const maxAttempts = retryMinutes.length + 1;
let configured = false;
export const emailConfigured = () => configured;

export function transportFromEnv(env) {
  if (env.SMTP_URL) return nodemailer.createTransport(env.SMTP_URL);
  if (!env.SMTP_HOST) return null;
  const port = Number(env.SMTP_PORT || 587);
  return nodemailer.createTransport({
    host: env.SMTP_HOST,
    port,
    secure: env.SMTP_SECURE ? env.SMTP_SECURE === 'true' : port === 465,
    requireTLS: env.SMTP_REQUIRE_TLS !== 'false' && port !== 465,
    auth: env.SMTP_USER ? {user: env.SMTP_USER, pass: env.SMTP_PASSWORD || ''} : undefined,
    connectionTimeout: 15000,
    greetingTimeout: 15000,
    socketTimeout: 30000,
  });
}

const oneLine = v =>
  String(v)
    .replace(/[\r\n]+/g, ' ')
    .slice(0, 200);
export async function enqueueEmail(db, {userId = null, to, subject, body, delayMs = 0}) {
  if (!to || !/^[^\s@]+@[^\s@]+$/.test(to)) return false;
  const now = new Date();
  await db.query(
    'INSERT INTO email_outbox(id,user_id,to_address,subject,body,created_at,send_after) VALUES($1,$2,$3,$4,$5,$6,$7)',
    [
      randomUUID(),
      userId,
      to,
      oneLine(subject),
      body,
      now.toISOString(),
      new Date(now.getTime() + delayMs).toISOString(),
    ],
  );
  kick();
  return true;
}
// Called by notify() for each in-app notification recipient.
export async function queueNotificationEmail(db, user, order, message) {
  if (!configured) return;
  const row = (await db.query('SELECT title,number FROM work_orders WHERE id=$1', [order.id]))[0];
  const title = order.title || row?.title || 'Request';
  const ticket = row?.number ? `WO-${String(row.number).padStart(4, '0')} ` : '';
  await enqueueEmail(db, {
    userId: user.id,
    to: user.email,
    subject: `${ticket}${title} · ${message}`,
    body: `${message}\n\nRequest: ${ticket}${title}\nOpen it in {{ORG}}: {{APP_URL}}/tickets/${row?.number ? `WO-${String(row.number).padStart(4, '0')}` : encodeURIComponent(order.id)}\n\nYou can change which updates you receive by email under Notifications → Preferences.`,
  });
}

export async function deliverEmails(db, transport, {appUrl, from, organization, batch = 20}) {
  const now = new Date().toISOString();
  const due = await db.query(
    'SELECT * FROM email_outbox WHERE sent_at IS NULL AND attempts<$1 AND send_after<=$2 ORDER BY created_at LIMIT $3',
    [maxAttempts, now, batch],
  );
  let sent = 0;
  for (const message of due) {
    // Claiming with the attempt count prevents two overlapping ticks from sending the same message.
    const retryAt = new Date(
      Date.now() + (retryMinutes[message.attempts] ?? retryMinutes.at(-1)) * 60000,
    ).toISOString();
    const claimed = await db.query(
      'UPDATE email_outbox SET attempts=attempts+1,send_after=$1 WHERE id=$2 AND attempts=$3 AND sent_at IS NULL RETURNING id',
      [retryAt, message.id, message.attempts],
    );
    if (!claimed.length) continue;
    const fill = s => s.replaceAll('{{APP_URL}}', appUrl.replace(/\/$/, '')).replaceAll('{{ORG}}', organization);
    try {
      await transport.sendMail({
        from,
        to: message.to_address,
        subject: `${organization}: ${message.subject}`,
        text: fill(message.body),
      });
      await db.query('UPDATE email_outbox SET sent_at=$1,last_error=NULL WHERE id=$2', [
        new Date().toISOString(),
        message.id,
      ]);
      sent++;
    } catch (err) {
      await db.query('UPDATE email_outbox SET last_error=$1 WHERE id=$2', [
        String(err.message).slice(0, 500),
        message.id,
      ]);
    }
  }
  return sent;
}

let kick = () => {};
export function setupEmail(app, db, env, {logger, workspaceSettings, transport: injected}) {
  const transport = injected || transportFromEnv(env);
  const from = env.SMTP_FROM;
  configured = !!(transport && from);
  const organization = async () => (await workspaceSettings(db)).name || env.ORG_NAME || 'Facilities';
  const options = async () => ({
    appUrl: env.APP_URL || 'http://localhost:3000',
    from,
    organization: await organization(),
  });
  let running = false,
    timer = null;
  const tick = async () => {
    if (!configured || running) return 0;
    running = true;
    try {
      return await deliverEmails(db, transport, await options());
    } catch (err) {
      logger.error('email delivery failed', {error: err.message});
      return 0;
    } finally {
      running = false;
    }
  };
  kick = () => {
    if (configured && !timer) {
      timer = setTimeout(() => {
        timer = null;
        tick();
      }, 500);
      timer.unref();
    }
  };
  app.get('/api/admin/email', admin, async (req, res) => {
    const [stats] = await db.query(
      'SELECT SUM(CASE WHEN sent_at IS NULL AND attempts<$1 THEN 1 ELSE 0 END) AS pending, SUM(CASE WHEN sent_at IS NULL AND attempts>=$1 THEN 1 ELSE 0 END) AS failed, SUM(CASE WHEN sent_at IS NOT NULL THEN 1 ELSE 0 END) AS sent FROM email_outbox',
      [maxAttempts],
    );
    const lastError =
      (
        await db.query(
          'SELECT last_error,created_at FROM email_outbox WHERE last_error IS NOT NULL ORDER BY created_at DESC LIMIT 1',
        )
      )[0] || null;
    res.json({
      configured,
      from: from || null,
      pending: Number(stats.pending || 0),
      failed: Number(stats.failed || 0),
      sent: Number(stats.sent || 0),
      lastError,
    });
  });
  app.post('/api/admin/email/test', admin, async (req, res) => {
    if (!configured)
      throw error('SMTP is not configured on the server. Set SMTP_HOST (or SMTP_URL) and SMTP_FROM.', 503);
    if (!req.user.email) throw error('Your account has no email address to send the test to.');
    const opts = await options();
    try {
      await transport.sendMail({
        from,
        to: req.user.email,
        subject: `${opts.organization}: test email`,
        text: `Email delivery from ${opts.organization} is working.\n\n${opts.appUrl}`,
      });
    } catch (err) {
      throw error(`The mail server rejected the test: ${err.message}`, 502);
    }
    await audit(db, req.user, 'email.test', 'settings', 'email', `Sent a test email to ${req.user.email}`);
    res.json({ok: true, to: req.user.email});
  });
  return {
    tick,
    start() {
      if (!configured) return;
      const t = setInterval(tick, 30000);
      t.unref();
      tick();
    },
  };
}
