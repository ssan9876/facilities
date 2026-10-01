import express from 'express';
import {randomUUID} from 'node:crypto';
import {error} from './validation.js';
import {canOn} from './permissions.js';
import {audit} from './audit.js';

// Content is checked against file signatures so a renamed file cannot claim to be an image.
// SVG and HTML are deliberately excluded: they can carry script.
const startsWith = (buf, bytes, offset = 0) => bytes.every((b, i) => buf[offset + i] === b);
const ascii = s => [...s].map(c => c.charCodeAt(0));
const zip = buf => startsWith(buf, [0x50, 0x4b, 0x03, 0x04]);
export const allowedTypes = {
  'image/jpeg': {ext: 'jpg', inline: true, check: b => startsWith(b, [0xff, 0xd8, 0xff])},
  'image/png': {ext: 'png', inline: true, check: b => startsWith(b, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])},
  'image/gif': {ext: 'gif', inline: true, check: b => startsWith(b, ascii('GIF87a')) || startsWith(b, ascii('GIF89a'))},
  'image/webp': {
    ext: 'webp',
    inline: true,
    check: b => startsWith(b, ascii('RIFF')) && startsWith(b, ascii('WEBP'), 8),
  },
  'image/heic': {
    ext: 'heic',
    inline: false,
    check: b =>
      startsWith(b, ascii('ftyp'), 4) && ['heic', 'heix', 'mif1', 'msf1'].some(brand => startsWith(b, ascii(brand), 8)),
  },
  'application/pdf': {ext: 'pdf', inline: false, check: b => startsWith(b, ascii('%PDF-'))},
  'text/plain': {ext: 'txt', inline: false, check: b => isText(b)},
  'text/csv': {ext: 'csv', inline: false, check: b => isText(b)},
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': {ext: 'docx', inline: false, check: zip},
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': {ext: 'xlsx', inline: false, check: zip},
};
function isText(buf) {
  if (buf.includes(0)) return false;
  try {
    new TextDecoder('utf-8', {fatal: true}).decode(buf);
    return true;
  } catch {
    return false;
  }
}
const safeName = (raw, type) => {
  let name;
  try {
    name = decodeURIComponent(String(raw || ''));
  } catch {
    name = '';
  }
  name = name
    .replace(/[\\/]/g, '_')
    .replace(/[\u0000-\u001f\u007f"<>|:*?]/g, '')
    .trim()
    .slice(0, 180);
  return name || `attachment.${allowedTypes[type].ext}`;
};

export function setupAttachments(app, db, env, {accessibleOrder, uploadLimiter}) {
  const maxBytes = Math.round(Number(env.ATTACHMENT_MAX_MB || 10) * 1024 * 1024);
  const maxPerOrder = Number(env.ATTACHMENT_MAX_PER_REQUEST || 20);
  const raw = express.raw({type: () => true, limit: maxBytes});
  app.post('/api/orders/:id/attachments', uploadLimiter, raw, async (req, res) => {
    const order = await accessibleOrder(req);
    const type = String(req.get('content-type') || '')
      .split(';')[0]
      .trim()
      .toLowerCase();
    if (!allowedTypes[type])
      throw error('Upload a photo (JPEG, PNG, GIF, WebP, HEIC), PDF, text, CSV, Word or Excel file.', 415);
    const data = req.body;
    if (!Buffer.isBuffer(data) || !data.length) throw error('The file is empty.');
    if (!allowedTypes[type].check(data)) throw error('The file contents do not match its type.', 415);
    if (
      Number(
        (await db.query('SELECT COUNT(*) AS count FROM attachments WHERE work_order_id=$1', [order.id]))[0].count,
      ) >= maxPerOrder
    )
      throw error(`A request can have at most ${maxPerOrder} attachments.`, 409);
    const row = {
      id: randomUUID(),
      file_name: safeName(req.get('x-file-name'), type),
      content_type: type,
      size: data.length,
      created_at: new Date().toISOString(),
    };
    await db.query(
      'INSERT INTO attachments(id,work_order_id,file_name,content_type,size,data,uploaded_by,created_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8)',
      [row.id, order.id, row.file_name, type, row.size, data, req.user.id, row.created_at],
    );
    await audit(db, req.user, 'attachment.create', 'work_order', order.id, `Attached ${row.file_name}`, {
      attachment: [null, row.file_name],
    });
    res.status(201).json(row);
  });
  const load = async req => {
    const meta = (
      await db.query('SELECT id,work_order_id,file_name,content_type,size,uploaded_by FROM attachments WHERE id=$1', [
        req.params.id,
      ])
    )[0];
    if (!meta) throw error('Attachment not found.', 404);
    await accessibleOrder(req, meta.work_order_id);
    return meta;
  };
  app.get('/api/attachments/:id', async (req, res) => {
    const meta = await load(req);
    const data = (await db.query('SELECT data FROM attachments WHERE id=$1', [meta.id]))[0].data;
    const inline = allowedTypes[meta.content_type]?.inline && req.query.download === undefined;
    res.set({
      'Content-Type': allowedTypes[meta.content_type] ? meta.content_type : 'application/octet-stream',
      'Content-Security-Policy': "default-src 'none'; sandbox",
      'Cross-Origin-Resource-Policy': 'same-origin',
      'Cache-Control': 'private, no-store',
    });
    res.attachment(meta.file_name);
    if (inline) res.set('Content-Disposition', res.get('Content-Disposition').replace(/^attachment/, 'inline'));
    res.send(Buffer.from(data));
  });
  app.delete('/api/attachments/:id', async (req, res) => {
    const meta = await load(req);
    const order = (
      await db.query('SELECT request_type,building_id FROM work_orders WHERE id=$1', [meta.work_order_id])
    )[0];
    if (meta.uploaded_by !== req.user.id && !canOn(req.user, 'requests.moderate', order || {}))
      throw error('Only the uploader or a manager can remove this attachment.', 403);
    await db.query('DELETE FROM attachments WHERE id=$1', [meta.id]);
    await audit(db, req.user, 'attachment.delete', 'work_order', meta.work_order_id, `Removed ${meta.file_name}`, {
      attachment: [meta.file_name, null],
    });
    res.json({ok: true});
  });
}
