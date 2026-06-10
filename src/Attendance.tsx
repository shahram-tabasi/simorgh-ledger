// حضور و غیابِ simorgh-ledger
// راهبرد در برابرِ «کسری»: بدونِ دستگاهِ ساعت‌زنی، موبایل/ابری، ساده، با محاسبه‌ی کارکرد و
// اضافه‌کار (۱.۴ برابر طبقِ عرفِ قانونِ کار) و حقوقِ تخمینی و گزارشِ ماهانه‌ی قابلِ چاپ.
// مدل عمداً ساده است تا صاحبِ کسب‌وکارِ کوچک بدونِ آموزش بتواند کار کند.
import { useState } from 'react';
import { getToday, getMonthNames, getMonthDays } from './calendar';
import type { AccType } from './Accounting';

const fmt = (n: number): string => Math.round(n || 0).toLocaleString('en-US');
const digits = (s: string): number => parseInt((s || '').replace(/[^0-9]/g, ''), 10) || 0;
const withSep = (s: string): string => { const d = digits(s); return d ? d.toLocaleString('en-US') : ''; };

export type DayStatus = 'present' | 'absent' | 'leave' | 'holiday';
export interface Employee { id: string; name: string; code?: string; dailyRate?: number; hourlyRate?: number; }
export interface AttendanceState {
  employees: Employee[];
  standardHours: number;                                   // ساعتِ کاریِ استانداردِ روز (پیش‌فرض ۸)
  records: { [empId: string]: { [dayKey: string]: DayStatus } }; // وضعیتِ هر روز؛ dayKey = "y-m-d" (شمسی، ماه ۰مبنا)
  overtime: { [empId: string]: { [ym: string]: number } };       // ساعتِ اضافه‌کارِ هر ماه؛ ym = "y-m"
}

export function emptyAttendance(): AttendanceState { return { employees: [], standardHours: 8, records: {}, overtime: {} }; }

// چرخه‌ی وضعیت با هر لمس: خالی → حاضر → غایب → مرخصی → تعطیل → خالی
const CYCLE: (DayStatus | '')[] = ['', 'present', 'absent', 'leave', 'holiday'];
const STATUS_LABEL: { [k in DayStatus]: string } = { present: 'حاضر', absent: 'غایب', leave: 'مرخصی', holiday: 'تعطیل' };
const STATUS_SHORT: { [k in DayStatus]: string } = { present: 'ح', absent: 'غ', leave: 'م', holiday: 'ت' };

interface Props {
  state: AttendanceState;
  onChange: (s: AttendanceState) => void;
  onClose: () => void;
  confirm: (msg: string, onYes: () => void) => void;
  // Accounting hook: auto-posts the month's payroll as a double-entry journal (optional).
  onPostJournal?: (ref: string, date: { y: number; m: number; d: number }, desc: string, spec: { type: AccType; name?: string; debit?: number; credit?: number }[]) => void;
}
type Tab = 'log' | 'report' | 'staff';

export default function AttendancePanel({ state, onChange, onClose, confirm, onPostJournal }: Props) {
  const employees = state.employees || [];
  const standardHours = state.standardHours || 8;
  const records = state.records || {};
  const overtime = state.overtime || {};
  const monthNames = getMonthNames('jalali');
  const today = getToday('jalali');

  const [tab, setTab] = useState<Tab>(employees.length ? 'log' : 'staff');
  const [y, setY] = useState<number>(today.year);
  const [m, setM] = useState<number>(today.month);                 // ۰مبنا
  const [empId, setEmpId] = useState<string>(employees[0]?.id || '');

  const daysInMonth = getMonthDays('jalali', y, m);
  const ym = `${y}-${m}`;
  const dayKey = (d: number) => `${y}-${m}-${d}`;

  // ---------- ثبتِ وضعیتِ روز ----------
  const cycleDay = (d: number) => {
    if (!empId) return;
    const cur = records[empId]?.[dayKey(d)] || '';
    const next = CYCLE[(CYCLE.indexOf(cur) + 1) % CYCLE.length];
    const empRec = { ...(records[empId] || {}) };
    if (next === '') delete empRec[dayKey(d)]; else empRec[dayKey(d)] = next as DayStatus;
    onChange({ ...state, records: { ...records, [empId]: empRec }, employees, standardHours, overtime });
  };
  const setOvertime = (val: string) => {
    if (!empId) return;
    const empOt = { ...(overtime[empId] || {}), [ym]: digits(val) };
    onChange({ ...state, overtime: { ...overtime, [empId]: empOt }, employees, standardHours, records });
  };

  // ---------- محاسبه‌ی کارکرد و حقوقِ یک کارمند در ماهِ جاری ----------
  const calc = (e: Employee) => {
    const rec = records[e.id] || {};
    let present = 0, absent = 0, leave = 0, holiday = 0;
    for (let d = 1; d <= daysInMonth; d++) {
      const s = rec[`${y}-${m}-${d}`];
      if (s === 'present') present++; else if (s === 'absent') absent++; else if (s === 'leave') leave++; else if (s === 'holiday') holiday++;
    }
    const ot = overtime[e.id]?.[ym] || 0;
    const workedHours = present * standardHours + ot;
    // نرخِ روز و ساعت را از روی هر کدام که پر شده استخراج می‌کنیم
    const dayRate = e.dailyRate || (e.hourlyRate ? e.hourlyRate * standardHours : 0);
    const hrRate = e.hourlyRate || (e.dailyRate ? e.dailyRate / standardHours : 0);
    const base = dayRate * present;
    const otPay = hrRate * 1.4 * ot;                       // اضافه‌کار ۱.۴ برابر (عرفِ قانونِ کار)
    return { present, absent, leave, holiday, ot, workedHours, pay: base + otPay };
  };

  // ---------- مدیریتِ کارمندان ----------
  const [eName, setEName] = useState(''); const [eCode, setECode] = useState('');
  const [eDaily, setEDaily] = useState(''); const [eHourly, setEHourly] = useState('');
  const addEmployee = () => {
    if (!eName.trim()) return;
    const emp: Employee = { id: `emp-${Date.now()}`, name: eName.trim(), code: eCode.trim() || undefined, dailyRate: digits(eDaily) || undefined, hourlyRate: digits(eHourly) || undefined };
    onChange({ ...state, employees: [...employees, emp], standardHours, records, overtime });
    setEName(''); setECode(''); setEDaily(''); setEHourly('');
    if (!empId) setEmpId(emp.id);
  };
  const delEmployee = (id: string) => confirm('این کارمند و سوابقش حذف شود؟', () => {
    const recs = { ...records }; delete recs[id];
    const ots = { ...overtime }; delete ots[id];
    onChange({ ...state, employees: employees.filter((e) => e.id !== id), records: recs, overtime: ots, standardHours });
    if (empId === id) setEmpId(employees.find((e) => e.id !== id)?.id || '');
  });

  const curEmp = employees.find((e) => e.id === empId) || null;
  const curCalc = curEmp ? calc(curEmp) : null;
  const monthLabel = `${monthNames[m]} ${y}`;
  const shiftMonth = (delta: number) => { let nm = m + delta, ny = y; if (nm < 0) { nm = 11; ny--; } if (nm > 11) { nm = 0; ny++; } setM(nm); setY(ny); };

  return (
    <div className="modal" onClick={onClose}>
      <div className="modal-box tool-panel" onClick={(e) => e.stopPropagation()}>
        <div className="tool-panel-head">
          <button className="close-modal" onClick={onClose}>‹</button>
          <h3>🕒 حضور و غیاب</h3>
          <button className="close-modal" onClick={onClose}>✕</button>
        </div>
        <div className="tool-panel-body">
          <div className="mini-toggle fund-tabs">
            <button type="button" className={`mini-toggle-btn ${tab === 'log' ? 'active' : ''}`} onClick={() => setTab('log')}>ثبتِ ماهانه</button>
            <button type="button" className={`mini-toggle-btn ${tab === 'report' ? 'active' : ''}`} onClick={() => setTab('report')}>گزارش</button>
            <button type="button" className={`mini-toggle-btn ${tab === 'staff' ? 'active' : ''}`} onClick={() => setTab('staff')}>کارمندان</button>
          </div>

          {/* ---------------- ثبتِ ماهانه ---------------- */}
          {tab === 'log' && (employees.length === 0 ? (
            <div className="tool-note">اول از تبِ «کارمندان» چند نفر اضافه کنید.</div>
          ) : (
            <>
              <div className="att-monthnav">
                <button onClick={() => shiftMonth(-1)}>‹</button>
                <span>{monthLabel}</span>
                <button onClick={() => shiftMonth(1)}>›</button>
              </div>
              <select className="tool-text-input" value={empId} onChange={(e) => setEmpId(e.target.value)}>
                {employees.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
              </select>

              <div className="att-legend">
                <span className="att-chip present">ح</span> حاضر
                <span className="att-chip absent">غ</span> غایب
                <span className="att-chip leave">م</span> مرخصی
                <span className="att-chip holiday">ت</span> تعطیل
                <span className="att-hint">(روی روز بزنید تا تغییر کند)</span>
              </div>
              <div className="att-grid">
                {Array.from({ length: daysInMonth }, (_, i) => i + 1).map((d) => {
                  const s = records[empId]?.[dayKey(d)] as DayStatus | undefined;
                  return (
                    <button key={d} className={`att-day ${s || ''}`} onClick={() => cycleDay(d)}>
                      <span className="att-dnum">{d}</span>
                      {s && <span className="att-dstat">{STATUS_SHORT[s]}</span>}
                    </button>
                  );
                })}
              </div>

              {curCalc && (
                <>
                  <div className="tool-result">
                    <div className="tool-result-row"><span>حاضر / غایب / مرخصی</span><strong>{curCalc.present} / {curCalc.absent} / {curCalc.leave}</strong></div>
                    <div className="tool-result-row"><span>کارکرد (ساعت)</span><strong>{fmt(curCalc.workedHours)}</strong></div>
                    <div className="tool-result-row closing"><span>حقوقِ تخمینیِ ماه</span><strong>{fmt(curCalc.pay)} تومان</strong></div>
                  </div>
                  <label className="field-label">اضافه‌کارِ این ماه (ساعت)</label>
                  <input className="tool-text-input" type="text" inputMode="numeric" dir="ltr" value={overtime[empId]?.[ym] ? String(overtime[empId][ym]) : ''} onChange={(e) => setOvertime(e.target.value)} placeholder="مثلاً 12" />
                  <div className="tool-note">اضافه‌کار با ضریبِ ۱.۴ در حقوق حساب می‌شود. ساعتِ استانداردِ روز: {standardHours} ساعت (در تبِ «کارمندان» قابل تغییر).</div>
                </>
              )}
            </>
          ))}

          {/* ---------------- گزارشِ ماهانه ---------------- */}
          {tab === 'report' && (
            <>
              <div className="att-monthnav">
                <button onClick={() => shiftMonth(-1)}>‹</button>
                <span>{monthLabel}</span>
                <button onClick={() => shiftMonth(1)}>›</button>
              </div>
              <div className="acc-print">
                <div className="acc-print-title">گزارشِ حضور و غیاب — {monthLabel}</div>
                <table className="acc-table">
                  <thead><tr><th>کارمند</th><th>حاضر</th><th>غایب</th><th>مرخصی</th><th>کارکرد(س)</th><th>اضافه(س)</th><th>حقوقِ تخمینی</th></tr></thead>
                  <tbody>
                    {employees.length === 0 ? (
                      <tr><td colSpan={7} style={{ textAlign: 'center', opacity: .6 }}>کارمندی ثبت نشده</td></tr>
                    ) : employees.map((e) => { const c = calc(e); return (
                      <tr key={e.id}><td>{e.name}</td><td>{c.present}</td><td>{c.absent}</td><td>{c.leave}</td><td>{fmt(c.workedHours)}</td><td>{fmt(c.ot)}</td><td>{fmt(c.pay)}</td></tr>
                    ); })}
                    {employees.length > 0 && (
                      <tr className="acc-total"><td>جمعِ حقوق</td><td colSpan={5}></td><td>{fmt(employees.reduce((s, e) => s + calc(e).pay, 0))}</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
              <button className="loan-submit acc-noprint" onClick={() => window.print()}>🖨️ چاپ / ذخیره‌ی PDF</button>
              {onPostJournal && employees.length > 0 && (
                <button className="acc-addline acc-noprint" onClick={() => {
                  const total = employees.reduce((s, e) => s + calc(e).pay, 0);
                  if (total <= 0) { confirm('حقوقی برای ثبت نیست (مبلغ صفر است).', () => {}); return; }
                  // Debit: Salary expense  /  Credit: Salaries payable
                  onPostJournal(`payroll-${ym}`, { y, m, d: daysInMonth }, `حقوقِ ${monthLabel}`, [{ type: 'expense', name: 'هزینه‌ی حقوق', debit: total }, { type: 'liability', name: 'حقوقِ پرداختنی', credit: total }]);
                }}>🧾 ثبتِ حقوقِ {monthLabel} در حسابداری</button>
              )}
            </>
          )}

          {/* ---------------- کارمندان ---------------- */}
          {tab === 'staff' && (
            <>
              <label className="field-label">ساعتِ کاریِ استانداردِ روز</label>
              <input className="tool-text-input" type="text" inputMode="numeric" dir="ltr" value={String(standardHours)} onChange={(e) => onChange({ ...state, standardHours: Math.max(1, digits(e.target.value) || 8), employees, records, overtime })} />

              <div className="loan-sched-head"><span>افزودنِ کارمند</span></div>
              <input className="tool-text-input" type="text" placeholder="نام و نام‌خانوادگی" value={eName} onChange={(e) => setEName(e.target.value)} />
              <div className="att-addgrid">
                <input className="tool-text-input" type="text" inputMode="numeric" dir="ltr" placeholder="کد (اختیاری)" value={eCode} onChange={(e) => setECode(e.target.value.replace(/[^0-9]/g, ''))} />
                <input className="tool-text-input" type="text" inputMode="numeric" dir="ltr" placeholder="حقوقِ روزانه" value={eDaily} onChange={(e) => setEDaily(withSep(e.target.value))} />
                <input className="tool-text-input" type="text" inputMode="numeric" dir="ltr" placeholder="نرخِ ساعتی" value={eHourly} onChange={(e) => setEHourly(withSep(e.target.value))} />
              </div>
              <div className="tool-note">یکی از «حقوقِ روزانه» یا «نرخِ ساعتی» کافی است؛ دیگری خودکار حساب می‌شود.</div>
              <button className="loan-submit" disabled={!eName.trim()} onClick={addEmployee}>افزودنِ کارمند</button>

              <div className="loan-sched-head"><span>فهرستِ کارمندان</span><span className="loan-sched-hint">{employees.length} نفر</span></div>
              <div className="loan-detail-list">
                {employees.map((e) => (
                  <div key={e.id} className="loan-detail-row">
                    <div className="ld-info">
                      <span className="ld-amt">{e.name} {e.code ? <span className="fm-shares">#{e.code}</span> : null}</span>
                      <span className="ld-date">{e.dailyRate ? `روزانه ${fmt(e.dailyRate)}` : ''}{e.hourlyRate ? ` · ساعتی ${fmt(e.hourlyRate)}` : ''}</span>
                    </div>
                    <button className="fm-notify" title="حذف" onClick={() => delEmployee(e.id)}>🗑</button>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
