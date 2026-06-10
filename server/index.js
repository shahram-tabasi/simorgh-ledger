// بک‌اندِ simorgh-ledger: ورود/ثبت‌نام (شماره‌موبایل + رمز) و همگام‌سازیِ داده‌ها
// و در صورتِ وجود، سروِ نسخه‌ی وب از پوشه‌ی public_web (تک‌دامنه برای API و وب).
import express from 'express';
import cors from 'cors';
import pkg from 'pg';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

dotenv.config();
const { Pool } = pkg;
const __dirname = path.dirname(fileURLToPath(import.meta.url));

const PORT = process.env.PORT || 8080;
const JWT_SECRET = process.env.JWT_SECRET || 'CHANGE_ME_please';
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function init() {
  await pool.query(`CREATE TABLE IF NOT EXISTS users (
    id SERIAL PRIMARY KEY,
    phone TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    created_at TIMESTAMPTZ DEFAULT now()
  );`);
  await pool.query(`CREATE TABLE IF NOT EXISTS user_data (
    user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    blob JSONB NOT NULL DEFAULT '{}'::jsonb,
    version INTEGER NOT NULL DEFAULT 0,
    updated_at TIMESTAMPTZ DEFAULT now()
  );`);
}

const app = express();
app.use(cors());                       // احراز با توکن است؛ کوکی نداریم، پس CORS باز اشکالی ندارد
app.use(express.json({ limit: '8mb' }));

const normPhone = (p) => String(p || '').replace(/[^0-9+]/g, '');
const sign = (u) => jwt.sign({ id: u.id, phone: u.phone }, JWT_SECRET, { expiresIn: '180d' });
function auth(req, res, next) {
  const h = req.headers.authorization || '';
  const t = h.startsWith('Bearer ') ? h.slice(7) : '';
  try { req.user = jwt.verify(t, JWT_SECRET); next(); }
  catch { res.status(401).json({ error: 'unauthorized' }); }
}

app.get('/api/health', (_req, res) => res.json({ ok: true }));

app.post('/api/register', async (req, res) => {
  const phone = normPhone(req.body.phone);
  const pw = String(req.body.password || '');
  if (phone.length < 8 || pw.length < 4) return res.status(400).json({ error: 'invalid' });
  try {
    const hash = await bcrypt.hash(pw, 10);
    const r = await pool.query('INSERT INTO users(phone,password_hash) VALUES($1,$2) RETURNING id,phone', [phone, hash]);
    await pool.query('INSERT INTO user_data(user_id) VALUES($1) ON CONFLICT DO NOTHING', [r.rows[0].id]);
    res.json({ token: sign(r.rows[0]), phone });
  } catch (e) {
    if (e.code === '23505') return res.status(409).json({ error: 'exists' });
    res.status(500).json({ error: 'server' });
  }
});

app.post('/api/login', async (req, res) => {
  const phone = normPhone(req.body.phone);
  const pw = String(req.body.password || '');
  const r = await pool.query('SELECT * FROM users WHERE phone=$1', [phone]);
  if (!r.rows.length) return res.status(401).json({ error: 'nouser' });
  const ok = await bcrypt.compare(pw, r.rows[0].password_hash);
  if (!ok) return res.status(401).json({ error: 'badpass' });
  res.json({ token: sign(r.rows[0]), phone });
});

app.get('/api/data', auth, async (req, res) => {
  const r = await pool.query('SELECT blob,version,updated_at FROM user_data WHERE user_id=$1', [req.user.id]);
  if (!r.rows.length) return res.json({ blob: null, version: 0, updatedAt: null });
  res.json({ blob: r.rows[0].blob, version: r.rows[0].version, updatedAt: r.rows[0].updated_at });
});

app.put('/api/data', auth, async (req, res) => {
  const blob = req.body.blob ?? {};
  const r = await pool.query(
    `INSERT INTO user_data(user_id,blob,version,updated_at) VALUES($1,$2,1,now())
     ON CONFLICT(user_id) DO UPDATE SET blob=$2, version=user_data.version+1, updated_at=now()
     RETURNING version,updated_at`, [req.user.id, blob]);
  res.json({ version: r.rows[0].version, updatedAt: r.rows[0].updated_at });
});

// سروِ نسخه‌ی وب (اگر فایل‌های dist در public_web کپی شده باشند)
const webDir = path.join(__dirname, 'public_web');
if (fs.existsSync(webDir)) {
  app.use(express.static(webDir));
  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api/')) return next();
    res.sendFile(path.join(webDir, 'index.html'));
  });
}

init()
  .then(() => app.listen(PORT, () => console.log('simorgh-ledger server on :' + PORT)))
  .catch((e) => { console.error('DB init failed:', e); process.exit(1); });
