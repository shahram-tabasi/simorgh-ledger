// In-app diagnostics logger — captures errors and key events to a ring buffer in localStorage so the
// user (or support) can see what went wrong without dev tools. Lightweight and offline; never throws.
export type LogLevel = 'info' | 'warn' | 'error';
export interface LogEntry { t: number; lvl: LogLevel; msg: string; data?: string; }

const KEY = 'simorghLogs';
const MAX = 400;

const safe = (v: unknown): string => {
  try { return typeof v === 'string' ? v : JSON.stringify(v); } catch { return String(v); }
};
const read = (): LogEntry[] => { try { return JSON.parse(localStorage.getItem(KEY) || '[]'); } catch { return []; } };
const write = (arr: LogEntry[]) => { try { localStorage.setItem(KEY, JSON.stringify(arr.slice(-MAX))); } catch { /* quota */ } };

// Record one log line. Never throws (logging must not break the app).
export function logEvent(lvl: LogLevel, msg: string, data?: unknown): void {
  try {
    const arr = read();
    arr.push({ t: Date.now(), lvl, msg: String(msg).slice(0, 300), data: data === undefined ? undefined : safe(data).slice(0, 800) });
    write(arr);
  } catch { /* ignore */ }
}
export const getLogs = (): LogEntry[] => read();
export const clearLogs = (): void => { try { localStorage.removeItem(KEY); } catch { /* ignore */ } };

// Stable per-install id so the developer can group a user's reports.
export function installId(): string {
  try {
    let id = localStorage.getItem('simorghInstallId');
    if (!id) { id = 'i-' + Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4); localStorage.setItem('simorghInstallId', id); }
    return id;
  } catch { return 'i-anon'; }
}

// Send the diagnostics report to the server sink. Returns true on success.
export async function sendReport(version: string): Promise<boolean> {
  try {
    const base = localStorage.getItem('apiBase') || 'https://ledger.simorghai.com';
    const r = await fetch(`${base}/api/diag`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: installId(), version, report: exportLogs(version) }),
    });
    return r.ok;
  } catch { return false; }
}

// Build a shareable plain-text report (newest first) with environment context.
export function exportLogs(version: string): string {
  const ua = typeof navigator !== 'undefined' ? navigator.userAgent : '';
  const cap = (window as unknown as { Capacitor?: unknown }).Capacitor ? 'app' : 'web';
  const head = `سیمرغ — گزارشِ عیب‌یابی\nنسخه: ${version} · محیط: ${cap}\nدستگاه: ${ua}\nزمانِ گزارش: ${new Date().toLocaleString('fa-IR')}\n${'-'.repeat(40)}\n`;
  const body = read().slice().reverse().map((e) => {
    const ts = new Date(e.t).toLocaleString('fa-IR');
    return `[${ts}] ${e.lvl.toUpperCase()}: ${e.msg}${e.data ? `\n    ${e.data}` : ''}`;
  }).join('\n');
  return head + (body || '(لاگی ثبت نشده)');
}

// Install global capture for uncaught errors, promise rejections, and console.error/warn.
export function installErrorCapture(): void {
  if (typeof window === 'undefined') return;
  window.addEventListener('error', (e) => {
    logEvent('error', e.message || 'error', { src: e.filename, line: e.lineno, col: e.colno, stack: (e.error as Error | undefined)?.stack?.slice(0, 400) });
  });
  window.addEventListener('unhandledrejection', (e) => {
    logEvent('error', 'unhandledrejection', String((e as PromiseRejectionEvent).reason).slice(0, 400));
  });
  // Mirror console.error/warn into the log without breaking normal console output.
  (['error', 'warn'] as const).forEach((m) => {
    const orig = console[m].bind(console);
    console[m] = (...args: unknown[]) => { logEvent(m === 'error' ? 'error' : 'warn', args.map(safe).join(' ').slice(0, 600)); orig(...args); };
  });
  logEvent('info', 'app started');
}
