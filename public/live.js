// The browser end of /api/stream (see live.js on the server). One EventSource per tab; the browser
// reconnects by itself after network drops or a server restart, and onReconnect lets the app catch up
// on anything it missed while disconnected. Update and backup progress are re-dispatched as window
// events ('live:update', 'live:backup') for the settings pages that show them.
import {tabId} from './ui.js';

export function connectLive(handlers) {
  if (!('EventSource' in window)) return null;
  const source = new EventSource('/api/stream?client=' + encodeURIComponent(tabId));
  let dropped = false;
  const on = (event, fn) =>
    source.addEventListener(event, e => {
      let data = {};
      try {
        data = JSON.parse(e.data || '{}');
      } catch {
        /* ignore malformed events */
      }
      fn(data);
    });
  on('ready', () => {
    if (dropped) handlers.onReconnect?.();
    dropped = false;
    handlers.onConnected?.();
  });
  source.onerror = () => {
    if (!dropped) handlers.onDisconnect?.();
    dropped = true;
  };
  on('notification', data => handlers.onNotification?.(data));
  on('order', data => handlers.onOrder?.(data));
  on('data', data => handlers.onData?.(data));
  on('update', data => dispatchEvent(new CustomEvent('live:update', {detail: data})));
  on('backup', data => dispatchEvent(new CustomEvent('live:backup', {detail: data})));
  return source;
}
