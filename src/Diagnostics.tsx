// Diagnostics viewer — shows the captured log so the user can spot/report problems, with
// copy / share / clear. Lets non-technical users send a useful error report.
import { useState } from 'react';
import { getLogs, clearLogs, exportLogs, sendReport, installId, type LogLevel } from './logger';

export default function Diagnostics({ version, onClose, onShare, confirm }: {
  version: string;
  onClose: () => void;
  onShare?: (text: string) => void;        // optional: hand the report to the app's share sheet
  confirm: (msg: string, onYes: () => void) => void;
}) {
  const [filter, setFilter] = useState<'all' | LogLevel>('all');
  const [tick, setTick] = useState(0);     // re-read after clear
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState<null | boolean>(null);
  const send = async () => { setSending(true); const ok = await sendReport(version); setSent(ok); setSending(false); };
  const logs = getLogs().slice().reverse().filter((l) => filter === 'all' || l.lvl === filter);
  const errorCount = getLogs().filter((l) => l.lvl === 'error').length;
  const copy = () => { const t = exportLogs(version); navigator.clipboard?.writeText(t).catch(() => {}); };
  const ts = (t: number) => new Date(t).toLocaleString('fa-IR', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' });
  void tick;
  return (
    <div className="modal" onClick={onClose}>
      <div className="modal-box tool-panel" onClick={(e) => e.stopPropagation()}>
        <div className="tool-panel-head">
          <button className="close-modal" onClick={onClose}>‹</button>
          <h3>🩺 عیب‌یابی و لاگ</h3>
          <button className="close-modal" onClick={onClose}>✕</button>
        </div>
        <div className="tool-panel-body">
          <div className="tool-note">رویدادها و خطاهای برنامه اینجا ثبت می‌شوند. اگر مشکلی دیدید، «اشتراک/کپی» را بزنید و گزارش را برای پشتیبانی بفرستید.</div>
          <div className="diag-summary">
            <span>کل: {getLogs().length}</span>
            <span className={errorCount ? 'diag-err' : ''}>خطا: {errorCount}</span>
          </div>
          <div className="mini-toggle">
            {(['all', 'error', 'warn', 'info'] as const).map((f) => (
              <button key={f} type="button" className={`mini-toggle-btn ${filter === f ? 'active' : ''}`} onClick={() => setFilter(f)}>
                {f === 'all' ? 'همه' : f === 'error' ? 'خطا' : f === 'warn' ? 'هشدار' : 'رویداد'}
              </button>
            ))}
          </div>
          <div className="acc-form-actions">
            <button className="loan-submit" disabled={sending} onClick={send}>{sending ? 'در حالِ ارسال…' : '🛰️ ارسال به پشتیبانی'}</button>
            {onShare && <button className="acc-addline" onClick={() => onShare(exportLogs(version))}>📤 اشتراک</button>}
            <button className="acc-addline" onClick={copy}>📋 کپی</button>
            <button className="acc-cancel" onClick={() => confirm('همه‌ی لاگ‌ها پاک شود؟', () => { clearLogs(); setTick((n) => n + 1); })}>🗑 پاک</button>
          </div>
          {sent !== null && <div className={`att-kiosk-msg ${sent ? 'ok' : 'bad'}`}>{sent ? `گزارش برای پشتیبانی ارسال شد ✓ (کدِ شما: ${installId()})` : 'ارسال ناموفق بود — اتصال به سرور را بررسی کنید یا «کپی/اشتراک» را بزنید.'}</div>}
          <div className="diag-list">
            {logs.length === 0 ? <div className="tool-note">لاگی برای نمایش نیست.</div> : logs.map((l, i) => (
              <div key={i} className={`diag-row diag-${l.lvl}`}>
                <div className="diag-meta"><span className="diag-lvl">{l.lvl}</span><span className="diag-ts" dir="ltr">{ts(l.t)}</span></div>
                <div className="diag-msg">{l.msg}</div>
                {l.data && <div className="diag-data" dir="ltr">{l.data}</div>}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
