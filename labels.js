import QRCode from 'qrcode';
import {fileURLToPath} from 'node:url';
import {can} from './permissions.js';

// "Report a problem" links and printable QR labels for buildings, spaces and assets.
// Scanning a label opens the request form with the location already filled in.
const escape = v =>
  String(v ?? '').replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'})[c]);

export function reportUrl(appUrl, {building, asset, space}) {
  const url = new URL('/report', appUrl);
  url.searchParams.set('building', building);
  if (asset) url.searchParams.set('asset', asset);
  if (space) url.searchParams.set('space', space);
  return url.href;
}

export function setupLabels(app, db, env) {
  const appUrl = env.APP_URL || 'http://localhost:3000';
  const index = fileURLToPath(new URL('./public/index.html', import.meta.url));
  // The report link is part of the single-page app; the client reads the query and opens the form.
  app.get('/report', (req, res) => res.sendFile(index));
  // Every ticket has its own address; the app shell renders it after sign-in.
  app.get('/tickets/:ref', (req, res) => res.sendFile(index));
  app.get('/labels', async (req, res) => {
    if (!req.user) return res.redirect(`/auth/login?return=${encodeURIComponent(req.originalUrl)}`);
    if (!can(req.user, 'records.manage'))
      return res.status(403).type('text/plain').send('Your role cannot print report labels.');
    const building = (await db.query('SELECT * FROM buildings WHERE id=$1', [String(req.query.building || '')]))[0];
    if (!building) return res.status(404).type('text/plain').send('Building not found.');
    const [spaces, assets] = await Promise.all([
      db.query('SELECT * FROM spaces WHERE building_id=$1 AND archived_at IS NULL ORDER BY name', [building.id]),
      db.query('SELECT * FROM assets WHERE building_id=$1 AND archived_at IS NULL ORDER BY name', [building.id]),
    ]);
    const items = [
      {kind: 'Building', name: building.name, sub: building.address, link: {building: building.id}},
      ...spaces.map(s => ({
        kind: 'Space',
        name: s.name,
        sub: building.name,
        link: {building: building.id, space: s.id},
      })),
      ...assets.map(a => ({
        kind: 'Asset',
        name: a.name,
        sub: [building.name, a.serial].filter(Boolean).join(' · '),
        link: {building: building.id, asset: a.id},
      })),
    ];
    const labels = await Promise.all(
      items.map(async item => {
        const url = reportUrl(appUrl, item.link);
        // qrcode emits a self-contained SVG of rects and paths; no user text is embedded in it.
        const svg = await QRCode.toString(url, {type: 'svg', margin: 0, errorCorrectionLevel: 'M'});
        return `<article class="label"><div class="qr">${svg}</div><div class="text"><span class="kind">${item.kind}</span><strong>${escape(item.name)}</strong><span class="sub">${escape(item.sub)}</span><span class="cta">Scan to report a problem</span></div></article>`;
      }),
    );
    res
      .type('html')
      .send(
        `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Report labels · ${escape(building.name)}</title><link rel="stylesheet" href="/labels.css"><script src="/labels-print.js" defer></script></head><body><header class="bar"><div><h1>Report labels · ${escape(building.name)}</h1><p>${items.length} label${items.length === 1 ? '' : 's'}. Each opens a new request with its location filled in; people sign in first.</p></div><button type="button" id="print">Print labels</button></header><main class="sheet">${labels.join('')}</main></body></html>`,
      );
  });
}
