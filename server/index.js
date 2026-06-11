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
import attachScanRelay from './scanRelay.js';
import attachAttRelay from './attRelay.js';
import attachDiagRelay from './diagRelay.js';

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
  // Company-edition upgrade requests (sales leads). Owner reviews → sends a price → activates.
  await pool.query(`CREATE TABLE IF NOT EXISTS quote_requests (
    id SERIAL PRIMARY KEY,
    company TEXT NOT NULL,
    phone TEXT NOT NULL,
    users_count INTEGER NOT NULL DEFAULT 1,
    modules JSONB NOT NULL DEFAULT '[]'::jsonb,
    notes TEXT,
    status TEXT NOT NULL DEFAULT 'new',
    created_at TIMESTAMPTZ DEFAULT now()
  );`);
  // ---- Multi-tenant SaaS foundation: organizations, members (with role), shared org data ----
  await pool.query(`CREATE TABLE IF NOT EXISTS orgs (
    id SERIAL PRIMARY KEY,
    name TEXT NOT NULL,
    owner_user_id INTEGER NOT NULL REFERENCES users(id),
    plan TEXT NOT NULL DEFAULT 'trial',
    active BOOLEAN NOT NULL DEFAULT true,     -- becomes true after payment; trial=true for now
    modules JSONB NOT NULL DEFAULT '[]'::jsonb,
    created_at TIMESTAMPTZ DEFAULT now()
  );`);
  await pool.query(`CREATE TABLE IF NOT EXISTS org_members (
    id SERIAL PRIMARY KEY,
    org_id INTEGER NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role TEXT NOT NULL DEFAULT 'worker',       -- owner | admin | manager | worker
    perms JSONB NOT NULL DEFAULT '[]'::jsonb,
    emp_id TEXT,                               -- links the member to an attendance employee
    created_at TIMESTAMPTZ DEFAULT now(),
    UNIQUE(org_id, user_id)
  );`);
  await pool.query(`CREATE TABLE IF NOT EXISTS org_data (
    org_id INTEGER PRIMARY KEY REFERENCES orgs(id) ON DELETE CASCADE,
    blob JSONB NOT NULL DEFAULT '{}'::jsonb,
    version INTEGER NOT NULL DEFAULT 0,
    updated_at TIMESTAMPTZ DEFAULT now()
  );`);
}

const app = express();
app.use(cors());                       // احراز با توکن است؛ کوکی نداریم، پس CORS باز اشکالی ندارد
app.use(express.json({ limit: '8mb' }));

// Remote-scanner relay (phone as wireless barcode scanner) — in-memory, no DB needed.
attachScanRelay(app);
// Attendance-device relay (external face/fingerprint/card devices push punch logs) — in-memory.
attachAttRelay(app);
// Diagnostics sink (clients submit error reports; dev reads with DIAG_KEY) — in-memory.
attachDiagRelay(app);

const normPhone = (p) => String(p || '').replace(/[^0-9+]/g, '');
const sign = (u) => jwt.sign({ id: u.id, phone: u.phone }, JWT_SECRET, { expiresIn: '180d' });
function auth(req, res, next) {
  const h = req.headers.authorization || '';
  const t = h.startsWith('Bearer ') ? h.slice(7) : '';
  try { req.user = jwt.verify(t, JWT_SECRET); next(); }
  catch { res.status(401).json({ error: 'unauthorized' }); }
}

app.get('/api/health', (_req, res) => res.json({ ok: true }));

// Company-edition quote request (public lead form). Returns an id the customer can reference.
app.post('/api/quote', async (req, res) => {
  const company = String(req.body.company || '').trim();
  const phone = normPhone(req.body.phone);
  const usersCount = Math.max(1, parseInt(req.body.usersCount, 10) || 1);
  const modules = Array.isArray(req.body.modules) ? req.body.modules.map(String).slice(0, 50) : [];
  const notes = String(req.body.notes || '').slice(0, 1000);
  if (company.length < 2 || phone.length < 8) return res.status(400).json({ error: 'invalid' });
  try {
    const r = await pool.query(
      'INSERT INTO quote_requests(company,phone,users_count,modules,notes) VALUES($1,$2,$3,$4,$5) RETURNING id',
      [company, phone, usersCount, JSON.stringify(modules), notes]);
    res.json({ ok: true, id: r.rows[0].id });
  } catch { res.status(500).json({ error: 'server' }); }
});

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

// ---------- Multi-tenant organization API (SaaS foundation) ----------
const ALL_ROLE_PERMS = ['fund', 'loans', 'accounting', 'inventory', 'attendance', 'attendance_self', 'tools', 'users'];
const CAN_WRITE_ROLES = ['owner', 'admin', 'manager'];   // workers are read-only on shared data (for now)
// Load the caller's membership (org + role + perms). One org per user in this v1.
async function membership(userId) {
  const r = await pool.query(
    `SELECT m.org_id, m.role, m.perms, m.emp_id, o.name, o.active, o.plan
     FROM org_members m JOIN orgs o ON o.id = m.org_id WHERE m.user_id = $1 LIMIT 1`, [userId]);
  return r.rows[0] || null;
}

// Create an organization; the caller becomes its owner+admin.
app.post('/api/org', auth, async (req, res) => {
  const name = String(req.body.name || '').trim();
  if (name.length < 2) return res.status(400).json({ error: 'invalid' });
  if (await membership(req.user.id)) return res.status(409).json({ error: 'already_member' });
  const o = await pool.query('INSERT INTO orgs(name,owner_user_id) VALUES($1,$2) RETURNING id', [name, req.user.id]);
  const orgId = o.rows[0].id;
  await pool.query('INSERT INTO org_members(org_id,user_id,role,perms) VALUES($1,$2,$3,$4)', [orgId, req.user.id, 'owner', JSON.stringify(ALL_ROLE_PERMS)]);
  await pool.query('INSERT INTO org_data(org_id) VALUES($1) ON CONFLICT DO NOTHING', [orgId]);
  res.json({ org: { id: orgId, name }, role: 'owner', perms: ALL_ROLE_PERMS });
});

// Get the caller's org + role.
app.get('/api/org', auth, async (req, res) => {
  const m = await membership(req.user.id);
  if (!m) return res.json({ org: null });
  res.json({ org: { id: m.org_id, name: m.name, active: m.active, plan: m.plan }, role: m.role, perms: m.perms, empId: m.emp_id });
});

// Add/update a member (by phone). Caller must be owner/admin.
app.post('/api/org/member', auth, async (req, res) => {
  const m = await membership(req.user.id);
  if (!m || !['owner', 'admin'].includes(m.role)) return res.status(403).json({ error: 'forbidden' });
  const phone = normPhone(req.body.phone);
  const role = ['owner', 'admin', 'manager', 'worker'].includes(req.body.role) ? req.body.role : 'worker';
  const perms = Array.isArray(req.body.perms) ? req.body.perms.filter((p) => ALL_ROLE_PERMS.includes(p)) : [];
  const empId = req.body.empId ? String(req.body.empId) : null;
  const u = await pool.query('SELECT id FROM users WHERE phone=$1', [phone]);
  if (!u.rows.length) return res.status(404).json({ error: 'user_must_register' });
  await pool.query(
    `INSERT INTO org_members(org_id,user_id,role,perms,emp_id) VALUES($1,$2,$3,$4,$5)
     ON CONFLICT(org_id,user_id) DO UPDATE SET role=$3, perms=$4, emp_id=$5`,
    [m.org_id, u.rows[0].id, role, JSON.stringify(perms), empId]);
  res.json({ ok: true });
});

// List members of the caller's org.
app.get('/api/org/members', auth, async (req, res) => {
  const m = await membership(req.user.id);
  if (!m) return res.status(404).json({ error: 'no_org' });
  const r = await pool.query(
    `SELECT u.phone, mm.role, mm.perms, mm.emp_id FROM org_members mm JOIN users u ON u.id=mm.user_id
     WHERE mm.org_id=$1 ORDER BY mm.created_at`, [m.org_id]);
  res.json({ members: r.rows });
});

// Shared org data (role-gated). All members can read; only writer roles can write.
app.get('/api/org/data', auth, async (req, res) => {
  const m = await membership(req.user.id);
  if (!m) return res.status(404).json({ error: 'no_org' });
  const r = await pool.query('SELECT blob,version,updated_at FROM org_data WHERE org_id=$1', [m.org_id]);
  res.json(r.rows.length ? { blob: r.rows[0].blob, version: r.rows[0].version, updatedAt: r.rows[0].updated_at } : { blob: null, version: 0 });
});
app.put('/api/org/data', auth, async (req, res) => {
  const m = await membership(req.user.id);
  if (!m) return res.status(404).json({ error: 'no_org' });
  if (!CAN_WRITE_ROLES.includes(m.role)) return res.status(403).json({ error: 'read_only' });
  const blob = req.body.blob ?? {};
  const r = await pool.query(
    `INSERT INTO org_data(org_id,blob,version,updated_at) VALUES($1,$2,1,now())
     ON CONFLICT(org_id) DO UPDATE SET blob=$2, version=org_data.version+1, updated_at=now()
     RETURNING version,updated_at`, [m.org_id, blob]);
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
