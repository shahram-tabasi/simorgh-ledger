// Remote-scanner relay: lets a phone act as a wireless barcode scanner for a desktop session.
// The desktop generates a short channel code and polls it; the phone joins the channel and pushes
// every scanned barcode. Pure in-memory (no DB), channels expire after 10 idle minutes.
// Pairing = knowing the 6-digit channel code shown on the desktop (admin starts/stops it there).

const TTL_MS = 10 * 60 * 1000;     // drop channels idle longer than this
const MAX_ITEMS = 200;             // cap per channel (old scans are trimmed)
const channels = new Map();        // code -> { seq, items: [{ id, code, t }], touched }

function touch(ch) {
  let c = channels.get(ch);
  if (!c) { c = { seq: 0, items: [], touched: Date.now() }; channels.set(ch, c); }
  c.touched = Date.now();
  return c;
}

function sweep() {
  const now = Date.now();
  for (const [k, c] of channels) if (now - c.touched > TTL_MS) channels.delete(k);
}
setInterval(sweep, 60 * 1000).unref();

export default function attachScanRelay(app) {
  // Phone pushes a scanned barcode into the channel.
  app.post('/api/scan/:ch', (req, res) => {
    const ch = String(req.params.ch || '').replace(/[^0-9A-Za-z]/g, '').slice(0, 12);
    const code = String((req.body && req.body.code) || '').trim().slice(0, 64);
    if (!ch || !code) return res.status(400).json({ error: 'bad request' });
    const c = touch(ch);
    c.seq += 1;
    c.items.push({ id: c.seq, code, t: Date.now() });
    if (c.items.length > MAX_ITEMS) c.items.splice(0, c.items.length - MAX_ITEMS);
    res.json({ ok: true, id: c.seq });
  });

  // Desktop polls for scans newer than `after`.
  app.get('/api/scan/:ch', (req, res) => {
    const ch = String(req.params.ch || '').replace(/[^0-9A-Za-z]/g, '').slice(0, 12);
    const after = parseInt(String(req.query.after || '0'), 10) || 0;
    const c = channels.get(ch);
    if (!c) return res.json({ scans: [], last: after });
    c.touched = Date.now();
    const scans = c.items.filter((x) => x.id > after).map((x) => ({ id: x.id, code: x.code }));
    res.json({ scans, last: scans.length ? scans[scans.length - 1].id : after });
  });
}
