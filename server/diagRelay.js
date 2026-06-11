// Diagnostics sink: clients POST their diagnostics report here so the developer can see problems
// remotely. In-memory ring buffer (no DB). Reading the reports is protected by DIAG_KEY (env), so
// only the developer can list them; if DIAG_KEY is unset, reading is disabled (privacy by default).

const MAX = 300;
const reports = [];   // { id, version, t, ua, report }

export default function attachDiagRelay(app) {
  // Client submits a report. `id` = a stable per-install id, `report` = the plain-text log export.
  app.post('/api/diag', (req, res) => {
    const body = req.body || {};
    const report = String(body.report || '').slice(0, 20000);
    if (!report) return res.status(400).json({ error: 'empty' });
    reports.push({
      id: String(body.id || '').slice(0, 64),
      version: String(body.version || '').slice(0, 16),
      t: Date.now(),
      ua: String(req.headers['user-agent'] || '').slice(0, 256),
      report,
    });
    if (reports.length > MAX) reports.splice(0, reports.length - MAX);
    res.json({ ok: true });
  });

  // Developer lists recent reports (protected). Optionally filter by `?after=<ms>` and `?id=`.
  app.get('/api/diag', (req, res) => {
    const key = process.env.DIAG_KEY;
    if (!key || req.query.key !== key) return res.status(403).json({ error: 'forbidden' });
    const after = parseInt(String(req.query.after || '0'), 10) || 0;
    const idFilter = req.query.id ? String(req.query.id) : null;
    const list = reports
      .filter((r) => r.t > after && (!idFilter || r.id === idFilter))
      .map((r) => ({ id: r.id, version: r.version, t: r.t, ua: r.ua, report: r.report }));
    res.json({ count: list.length, reports: list });
  });
}
