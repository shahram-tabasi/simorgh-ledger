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
