// Shop server: runs on the shop's own laptop. Serves the built POS app AND a tiny in-memory
// wireless-scanner relay, so a phone on the same Wi-Fi can act as the barcode scanner.
// Usage:  npm run build   then   npm run serve   (or: node server/index.mjs)
import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
app.use(express.json({ limit: '1mb' }));

// ---- wireless scanner relay (in-memory) ----
const TTL = 15 * 60 * 1000;
const channels = new Map();
const touch = (ch) => { let c = channels.get(ch); if (!c) { c = { seq: 0, items: [], touched: Date.now() }; channels.set(ch, c); } c.touched = Date.now(); return c; };
setInterval(() => { const now = Date.now(); for (const [k, c] of channels) if (now - c.touched > TTL) channels.delete(k); }, 60000).unref();

app.post('/api/scan/:ch', (req, res) => {
  const ch = String(req.params.ch || '').replace(/[^0-9A-Za-z]/g, '').slice(0, 12);
  const code = String((req.body && req.body.code) || '').trim().slice(0, 64);
  if (!ch || !code) return res.status(400).json({ error: 'bad' });
  const c = touch(ch); c.seq += 1; c.items.push({ id: c.seq, code });
  if (c.items.length > 200) c.items.splice(0, c.items.length - 200);
  res.json({ ok: true, id: c.seq });
});
app.get('/api/scan/:ch', (req, res) => {
  const ch = String(req.params.ch || '').replace(/[^0-9A-Za-z]/g, '').slice(0, 12);
  const after = parseInt(String(req.query.after || '0'), 10) || 0;
  const c = channels.get(ch); if (!c) return res.json({ scans: [], last: after });
  c.touched = Date.now();
  const scans = c.items.filter((x) => x.id > after).map((x) => ({ id: x.id, code: x.code }));
  res.json({ scans, last: scans.length ? scans[scans.length - 1].id : after });
});

// ---- serve the built SPA ----
const dist = path.join(__dirname, '..', 'dist');
app.use(express.static(dist));
app.get('*', (req, res, next) => { if (req.path.startsWith('/api/')) return next(); res.sendFile(path.join(dist, 'index.html')); });

const PORT = process.env.PORT || 8090;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`صندوقِ سیمرغ روی http://localhost:${PORT} اجرا شد.`);
  console.log('روی گوشی (هم‌شبکه) همین آدرسِ لپ‌تاپ را با /?scan باز کنید تا اسکنر شود.');
});
