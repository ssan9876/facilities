// Field work in the browser: the asset page (history, repeat-problem flag, report a problem) and the QR
// scanner for the printed labels. The scanner uses the browser's BarcodeDetector when it has one and
// falls back to jsQR (served by this app), with "choose a photo" for devices without camera access.
import {
  state,
  $,
  escape,
  icon,
  api,
  toast,
  dialog,
  closeDialog,
  fmt,
  fmtStamp,
  money,
  tag,
  ticketNo,
  can,
} from './ui.js';
import {hooks} from './hooks.js';
import {minutes} from './ticket-extras.js';

// ---- Asset page ----
export async function assetPage(id) {
  const page = $('#asset-page');
  let h;
  try {
    h = await api(`/assets/${encodeURIComponent(id)}/history`);
  } catch (err) {
    if (page) page.innerHTML = `<div class="empty"><h2>Asset unavailable</h2><p>${escape(err.message)}</p></div>`;
    return;
  }
  if (!$('#asset-page')) return;
  const a = h.asset;
  document.title = `${a.name} · ${state.me.branding?.name || 'Facilities'}`;
  // One timeline: requests, maintenance runs and parts, newest first.
  const events = [
    ...h.tickets.map(t => ({
      at: t.created_at,
      html: `<button type="button" class="timeline-ticket" data-open-ticket="${escape(t.id)}"><span class="ticket-no">${escape(ticketNo(t.number))}</span><span><strong>${escape(t.title)}</strong><small>${escape(t.category || '')}${t.category ? ' · ' : ''}Opened ${fmtStamp(t.created_at)}${t.assignee ? ' · ' + escape(t.assignee) : ''}</small></span>${tag(t.status)}</button>`,
    })),
    ...h.parts.map(p => ({
      at: p.created_at,
      html: `<div class="timeline-note">${icon('box')}<span>${p.quantity} × ${escape(p.name)}${p.unit_cost_cents != null ? ' · ' + money(p.unit_cost_cents * p.quantity) : ''}<small>${fmtStamp(p.created_at)}</small></span></div>`,
    })),
  ].sort((x, y) => (x.at < y.at ? 1 : -1));
  const plans = h.plans.length
    ? `<section class="tp-card"><h2>Preventive maintenance</h2><ul class="plain-list">${h.plans.map(p => `<li><strong>${escape(p.title)}</strong><span>Every ${p.interval_days} days · next ${fmt(p.next_due)}${Number(p.active) ? '' : ' · paused'}</span></li>`).join('')}</ul></section>`
    : '';
  $('#asset-page').innerHTML =
    `<div class="tp"><header class="tp-head"><button type="button" class="quiet-button tp-back" data-ticket-back>${icon('arrow-left')}Back</button><div class="tp-title"><span class="ticket-no">Asset</span><h1>${escape(a.name)}</h1></div><p class="tp-summary">${[escape(a.building), a.category ? escape(a.category) : '', a.serial ? 'Serial ' + escape(a.serial) : '', a.archived_at ? 'Archived' : ''].filter(Boolean).join('<span class="sep" aria-hidden="true">·</span>')}</p><div class="tp-actions">${a.archived_at ? '' : `<button type="button" class="primary" data-report-asset>${icon('plus')}Report a problem</button>`}${can('records.manage') ? `<a class="secondary" href="/labels?building=${encodeURIComponent(a.building_id)}" target="_blank" rel="noopener">${icon('qr')}Print labels</a>` : ''}</div></header>` +
    (h.repeat
      ? `<div class="repeat-flag" role="note"><strong>Repeat problem</strong> ${escape(h.reason)}. Consider a deeper inspection or replacing it.</div>`
      : '') +
    `<div class="asset-stats"><div><span>Open requests</span><strong>${h.open}</strong></div><div><span>Requests</span><strong>${h.tickets.length}</strong></div><div><span>Last completed</span><strong>${h.last_completed ? fmt(h.last_completed.slice(0, 10)) : '—'}</strong></div><div><span>Labor</span><strong>${h.labor_minutes ? minutes(h.labor_minutes) : '—'}</strong></div>${h.parts.length ? `<div><span>Parts</span><strong>${money(h.parts_cost_cents)}</strong></div>` : ''}</div>` +
    `<div class="tp-grid ${plans ? '' : 'single'}">${plans ? `<aside class="tp-side">${plans}</aside>` : ''}<div class="tp-main"><section class="tp-card"><h2>History</h2>${events.length ? `<ol class="timeline">${events.map(e => `<li>${e.html}</li>`).join('')}</ol>` : '<p class="muted-line">No requests for this asset yet.</p>'}</section></div></div></div>`;
  $('[data-ticket-back]').onclick = () => hooks.leaveTicket();
  const report = $('[data-report-asset]');
  if (report) report.onclick = () => hooks.reportProblem({building: a.building_id, asset: a.id});
  for (const b of document.querySelectorAll('#asset-page [data-open-ticket]'))
    b.onclick = () => hooks.openTicket(b.dataset.openTicket);
}

// ---- Scanner ----
let stream = null,
  scanning = false;
const stopCamera = () => {
  scanning = false;
  stream?.getTracks().forEach(t => t.stop());
  stream = null;
};
function loadJsQR() {
  if (window.jsQR) return Promise.resolve(window.jsQR);
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = '/vendor/jsqr.js';
    s.onload = () => resolve(window.jsQR);
    s.onerror = () => reject(new Error('The scanner could not load. Check the connection and try again.'));
    document.head.append(s);
  });
}
async function detector() {
  if ('BarcodeDetector' in window) {
    try {
      if ((await window.BarcodeDetector.getSupportedFormats()).includes('qr_code')) {
        const d = new window.BarcodeDetector({formats: ['qr_code']});
        return async source => (await d.detect(source))[0]?.rawValue || null;
      }
    } catch {
      /* fall back to jsQR */
    }
  }
  const jsQR = await loadJsQR();
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d', {willReadFrequently: true});
  return async source => {
    const w = source.videoWidth || source.naturalWidth || source.width,
      h = source.videoHeight || source.naturalHeight || source.height;
    if (!w || !h) return null;
    const scale = Math.min(1, 800 / Math.max(w, h));
    canvas.width = Math.round(w * scale);
    canvas.height = Math.round(h * scale);
    ctx.drawImage(source, 0, 0, canvas.width, canvas.height);
    const image = ctx.getImageData(0, 0, canvas.width, canvas.height);
    return jsQR(image.data, image.width, image.height)?.data || null;
  };
}

// What a scanned code means: our report links (asset, space or building), ticket and asset addresses.
export function handleScan(text) {
  let url;
  try {
    url = new URL(text, location.origin);
  } catch {
    url = null;
  }
  const p = url?.searchParams;
  const ticket = url?.pathname.match(/^\/tickets\/([^/]+)$/)?.[1];
  const asset = url?.pathname.match(/^\/assets\/([^/]+)$/)?.[1];
  if (url?.pathname === '/report' && p.get('asset')) return hooks.openAsset(p.get('asset'));
  if (url?.pathname === '/report' && p.get('building'))
    return hooks.reportProblem({building: p.get('building'), space: p.get('space') || ''});
  if (ticket) return hooks.openTicket(decodeURIComponent(ticket));
  if (asset) return hooks.openAsset(decodeURIComponent(asset));
  toast('That code is not a Facilities label.');
}

export async function openScanner() {
  dialog(
    'Scan a label',
    `<div class="scanner"><div class="scan-view"><video id="scan-video" playsinline muted></video><span class="scan-frame" aria-hidden="true"></span></div><p id="scan-status" role="status">Point the camera at a QR label.</p><label class="secondary upload-button">${icon('upload')}Choose a photo of the label<input type="file" id="scan-photo" accept="image/*" capture="environment"></label></div>`,
  );
  const status = $('#scan-status');
  const done = text => {
    stopCamera();
    closeDialog();
    handleScan(text);
  };
  $('#editor').addEventListener('close', stopCamera, {once: true});
  // The photo option works at once; it waits for the decoder itself.
  const decoderReady = detector();
  $('#scan-photo').onchange = async e => {
    const file = e.target.files[0];
    if (!file) return;
    status.textContent = 'Reading the photo…';
    let decodePhoto;
    try {
      decodePhoto = await decoderReady;
    } catch (err) {
      status.textContent = err.message;
      return;
    }
    const img = new Image();
    img.src = URL.createObjectURL(file);
    await img.decode().catch(() => {});
    const text = await decodePhoto(img).catch(() => null);
    URL.revokeObjectURL(img.src);
    if (text) done(text);
    else status.textContent = 'No QR code found in that photo. Try again closer to the label.';
  };
  let decode;
  try {
    decode = await decoderReady;
  } catch (err) {
    status.textContent = err.message;
    return;
  }
  if (!navigator.mediaDevices?.getUserMedia) {
    status.textContent = 'This browser cannot use the camera here. Choose a photo of the label instead.';
    return;
  }
  try {
    stream = await navigator.mediaDevices.getUserMedia({video: {facingMode: 'environment'}, audio: false});
  } catch {
    status.textContent = 'Camera access was blocked. Allow the camera, or choose a photo of the label.';
    return;
  }
  const video = $('#scan-video');
  if (!video) return stopCamera();
  video.srcObject = stream;
  await video.play().catch(() => {});
  scanning = true;
  const tick = async () => {
    if (!scanning || !$('#scan-video')) return stopCamera();
    const text = await decode(video).catch(() => null);
    if (text) return done(text);
    setTimeout(tick, 220);
  };
  tick();
}
