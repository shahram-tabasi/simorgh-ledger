// Attendance-device relay: external face/fingerprint/RFID devices (or a tiny bridge script next to
// the device) push punch logs here; the attendance panel polls the channel and applies them to the
// punch kardex. In-memory like the scan relay; the admin keeps the kiosk screen open while listening.
// Payload: { code, time?: "HH:MM" | ISO, dir?: 'in' | 'out' } — `code` is the employee badge/personnel code.

const TTL_MS = 30 * 60 * 1000;     // channels expire after 30 idle minutes
const MAX_ITEMS = 500;
const channels = new Map();        // channel -> { seq, items: [{ id, code, time, dir, t }], touched }

function touch(ch) {
  let c = channels.get(ch);
  if (!c) { c = { seq: 0, items: [], touched: Date.now() }; channels.set(ch, c); }
  c.touched = Date.now();
  return c;
}

setInterval(() => {
  const now = Date.now();
  for (const [k, c] of channels) if (now - c.touched > TTL_MS) channels.delete(k);
}, 60 * 1000).unref();

export default function attachAttRelay(app) {
  // Device/bridge pushes one punch log.
  app.post('/api/att/:ch', (req, res) => {
    const ch = String(req.params.ch || '').replace(/[^0-9A-Za-z]/g, '').slice(0, 12);
    const body = req.body || {};
    const code = String(body.code || '').trim().slice(0, 64);
    if (!ch || !code) return res.status(400).json({ error: 'bad request' });
    const time = typeof body.time === 'string' ? body.time.slice(0, 32) : undefined;
    const dir = body.dir === 'in' || body.dir === 'out' ? body.dir : undefined;
    const c = touch(ch);
    c.seq += 1;
    c.items.push({ id: c.seq, code, time, dir, t: Date.now() });
    if (c.items.length > MAX_ITEMS) c.items.splice(0, c.items.length - MAX_ITEMS);
    res.json({ ok: true, id: c.seq });
  });

  // App polls for logs newer than `after`.
  app.get('/api/att/:ch', (req, res) => {
    const ch = String(req.params.ch || '').replace(/[^0-9A-Za-z]/g, '').slice(0, 12);
    const after = parseInt(String(req.query.after || '0'), 10) || 0;
    const c = channels.get(ch);
    if (!c) return res.json({ logs: [], last: after });
    c.touched = Date.now();
    const logs = c.items.filter((x) => x.id > after).map((x) => ({ id: x.id, code: x.code, time: x.time, dir: x.dir }));
    res.json({ logs, last: logs.length ? logs[logs.length - 1].id : after });
  });
}
