// حضور و غیابِ simorgh-ledger
// راهبرد در برابرِ «کسری»: بدونِ دستگاهِ ساعت‌زنی، موبایل/ابری، ساده، با محاسبه‌ی کارکرد و
// اضافه‌کار (۱.۴ برابر طبقِ عرفِ قانونِ کار) و حقوقِ تخمینی و گزارشِ ماهانه‌ی قابلِ چاپ.
// مدل عمداً ساده است تا صاحبِ کسب‌وکارِ کوچک بدونِ آموزش بتواند کار کند.
import { useState } from 'react';
import { getToday, getMonthNames, getMonthDays, getFirstWeekdayOffset } from './calendar';
import { downloadCsv } from './csv';
import type { AccType } from './Accounting';

const fmt = (n: number): string => Math.round(n || 0).toLocaleString('en-US');
const digits = (s: string): number => parseInt((s || '').replace(/[^0-9]/g, ''), 10) || 0;
const withSep = (s: string): string => { const d = digits(s); return d ? d.toLocaleString('en-US') : ''; };

export type DayStatus = 'present' | 'absent' | 'leave' | 'holiday';
export interface Employee { id: string; name: string; code?: string; dailyRate?: number; hourlyRate?: number; position?: string; hire?: string; }
// Per-company work rules (each company defines its own schedule).
// weekend: weekday indices that are weekly day-off (0=شنبه … 5=پنجشنبه … 6=جمعه).
// thuPolicy: Thursday is 'off' (full), 'early' (come but leave earlier by thuEarlyMin), or 'normal'.
export interface WorkRules {
  start: string;            // "07:30"
  end: string;              // "15:45"
  weekend: number[];        // default [6] = جمعه
  thuPolicy: 'normal' | 'off' | 'early';
  thuEarlyMin: number;      // minutes to leave earlier on Thursday when policy='early'
  shift2?: { start: string; end: string } | null; // optional second shift
  altWeeksOff?: boolean;    // 5 days, every-other-week off (alternating weeks)
  note?: string;
}
export const DEFAULT_RULES: WorkRules = { start: '08:00', end: '16:00', weekend: [6], thuPolicy: 'normal', thuEarlyMin: 90, shift2: null, altWeeksOff: false, note: '' };

export interface AttendanceState {
  employees: Employee[];
  standardHours: number;                                   // ساعتِ کاریِ استانداردِ روز (پیش‌فرض ۸)
  records: { [empId: string]: { [dayKey: string]: DayStatus } }; // وضعیتِ هر روز؛ dayKey = "y-m-d" (شمسی، ماه ۰مبنا)
  overtime: { [empId: string]: { [ym: string]: number } };       // ساعتِ اضافه‌کارِ هر ماه؛ ym = "y-m"
  // Per-month allowances/deductions for the payslip (bonuses, insurance, advances, ...).
  adjust?: { [empId: string]: { [ym: string]: { allow?: number; deduct?: number } } };
  rules?: WorkRules;                                       // company work-schedule rules
}

export function emptyAttendance(): AttendanceState { return { employees: [], standardHours: 8, records: {}, overtime: {}, adjust: {}, rules: { ...DEFAULT_RULES } }; }
// Hours between two "HH:MM" times.
const hoursBetween = (a: string, b: string) => { const p = (s: string) => { const [h, m] = (s || '0:0').split(':').map(Number); return (h || 0) * 60 + (m || 0); }; return Math.max(0, (p(b) - p(a)) / 60); };
const WEEKDAY_NAMES = ['شنبه', 'یک‌شنبه', 'دوشنبه', 'سه‌شنبه', 'چهارشنبه', 'پنج‌شنبه', 'جمعه'];

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
  // Worker self-service: lock the panel to one employee, allow only viewing + registering leave.
  selfMode?: boolean;
  selfEmpId?: string;
}
type Tab = 'log' | 'report' | 'slip' | 'decree' | 'rules' | 'staff';

export default function AttendancePanel({ state, onChange, onClose, confirm, onPostJournal, selfMode, selfEmpId }: Props) {
  const employees = state.employees || [];
  const standardHours = state.standardHours || 8;
  const records = state.records || {};
  const overtime = state.overtime || {};
  const monthNames = getMonthNames('jalali');
  const today = getToday('jalali');

  // In self-mode the worker can only see their own record + the payslip, and may only register leave.
  const [tab, setTab] = useState<Tab>(selfMode ? 'log' : (employees.length ? 'log' : 'staff'));
  const [y, setY] = useState<number>(today.year);
  const [m, setM] = useState<number>(today.month);                 // ۰مبنا
  const [empId, setEmpId] = useState<string>(selfEmpId || employees[0]?.id || '');

  const daysInMonth = getMonthDays('jalali', y, m);
  const ym = `${y}-${m}`;
  const dayKey = (d: number) => `${y}-${m}-${d}`;
  // Work rules + weekday helpers (to reflect weekly day-off / Thursday policy on the grid)
  const rules = state.rules || DEFAULT_RULES;
  const monthOffset = getFirstWeekdayOffset('jalali', y, m);   // column (0=شنبه) of day 1
  const weekdayOf = (d: number) => (monthOffset + d - 1) % 7;  // 0=شنبه … 5=پنجشنبه … 6=جمعه
  const isWeekendDay = (d: number) => rules.weekend.includes(weekdayOf(d)) || (weekdayOf(d) === 5 && rules.thuPolicy === 'off');
  const isThuEarly = (d: number) => weekdayOf(d) === 5 && rules.thuPolicy === 'early';

  // ---------- ثبتِ وضعیتِ روز ----------
  const cycleDay = (d: number) => {
    if (!empId) return;
    const cur = records[empId]?.[dayKey(d)] || '';
    // Worker self-mode may only toggle their own leave; managers cycle all statuses.
    const next = selfMode ? (cur === 'leave' ? '' : 'leave') : CYCLE[(CYCLE.indexOf(cur) + 1) % CYCLE.length];
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
    // Derive day-rate and hour-rate from whichever the user filled in.
    const dayRate = e.dailyRate || (e.hourlyRate ? e.hourlyRate * standardHours : 0);
    const hrRate = e.hourlyRate || (e.dailyRate ? e.dailyRate / standardHours : 0);
    const base = dayRate * present;
    const otPay = hrRate * 1.4 * ot;                       // overtime at 1.4x (common labor-law factor)
    const adj = (state.adjust || {})[e.id]?.[ym] || {};
    const allow = adj.allow || 0;                          // allowances / bonuses
    const deduct = adj.deduct || 0;                        // deductions (insurance, advances, ...)
    const pay = Math.max(0, base + otPay + allow - deduct);
    return { present, absent, leave, holiday, ot, workedHours, base, otPay, allow, deduct, pay };
  };
  const setAdjust = (field: 'allow' | 'deduct', val: string) => {
    if (!empId) return;
    const adjust = state.adjust || {};
    const empAdj = { ...(adjust[empId] || {}) };
    empAdj[ym] = { ...(empAdj[ym] || {}), [field]: digits(val) };
    onChange({ ...state, adjust: { ...adjust, [empId]: empAdj }, employees, standardHours, records, overtime });
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
  const updateEmployee = (id: string, patch: Partial<Employee>) => onChange({ ...state, employees: employees.map((e) => (e.id === id ? { ...e, ...patch } : e)), standardHours, records, overtime });
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
            <button type="button" className={`mini-toggle-btn ${tab === 'log' ? 'active' : ''}`} onClick={() => setTab('log')}>{selfMode ? 'حضورِ من' : 'ثبتِ ماهانه'}</button>
            {!selfMode && <button type="button" className={`mini-toggle-btn ${tab === 'report' ? 'active' : ''}`} onClick={() => setTab('report')}>گزارش</button>}
            <button type="button" className={`mini-toggle-btn ${tab === 'slip' ? 'active' : ''}`} onClick={() => setTab('slip')}>{selfMode ? 'فیشِ من' : 'فیش'}</button>
            <button type="button" className={`mini-toggle-btn ${tab === 'decree' ? 'active' : ''}`} onClick={() => setTab('decree')}>حکم</button>
            {!selfMode && <button type="button" className={`mini-toggle-btn ${tab === 'rules' ? 'active' : ''}`} onClick={() => setTab('rules')}>قوانین</button>}
            {!selfMode && <button type="button" className={`mini-toggle-btn ${tab === 'staff' ? 'active' : ''}`} onClick={() => setTab('staff')}>کارمندان</button>}
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
              {selfMode ? (
                <div className="acc-ledger-name">{employees.find((e) => e.id === empId)?.name || '—'}</div>
              ) : (
                <select className="tool-text-input" value={empId} onChange={(e) => setEmpId(e.target.value)}>
                  {employees.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
                </select>
              )}

              <div className="att-legend">
                <span className="att-chip present">ح</span> حاضر
                <span className="att-chip absent">غ</span> غایب
                <span className="att-chip leave">م</span> مرخصی
                <span className="att-chip holiday">ت</span> تعطیل
                <span className="att-hint">{selfMode ? '(روی روز بزنید تا مرخصی ثبت/حذف شود)' : '(روی روز بزنید تا تغییر کند)'}</span>
              </div>
              <div className="att-grid">
                {Array.from({ length: daysInMonth }, (_, i) => i + 1).map((d) => {
                  const s = records[empId]?.[dayKey(d)] as DayStatus | undefined;
                  const off = isWeekendDay(d);          // weekly day-off per company rules
                  const early = isThuEarly(d);          // Thursday early-leave day
                  return (
                    <button key={d} className={`att-day ${s || ''} ${off && !s ? 'weekoff' : ''}`} onClick={() => cycleDay(d)} title={off ? 'تعطیلِ هفتگی' : early ? `پنج‌شنبه: ${rules.thuEarlyMin} دقیقه زودتر` : ''}>
                      <span className="att-dnum">{d}</span>
                      {s ? <span className="att-dstat">{STATUS_SHORT[s]}</span> : off ? <span className="att-dstat off">×</span> : early ? <span className="att-dstat early">⏱</span> : null}
                    </button>
                  );
                })}
              </div>

              {curCalc && (
                <>
                  <div className="tool-result">
                    <div className="tool-result-row"><span>حاضر / غایب / مرخصی</span><strong>{curCalc.present} / {curCalc.absent} / {curCalc.leave}</strong></div>
                    <div className="tool-result-row closing"><span>کارکرد (ساعت)</span><strong>{fmt(curCalc.workedHours)}</strong></div>
                  </div>
                  {!selfMode && (
                    <>
                      <label className="field-label">اضافه‌کارِ این ماه (ساعت)</label>
                      <input className="tool-text-input" type="text" inputMode="numeric" dir="ltr" value={overtime[empId]?.[ym] ? String(overtime[empId][ym]) : ''} onChange={(e) => setOvertime(e.target.value)} placeholder="مثلاً 12" />
                      <div className="tool-note">اضافه‌کار با ضریبِ ۱.۴ در حقوق حساب می‌شود. ساعتِ استانداردِ روز: {standardHours} ساعت (در تبِ «کارمندان» قابل تغییر).</div>
                    </>
                  )}
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
              <button className="acc-addline acc-noprint" onClick={() => downloadCsv(`payroll-${ym}.csv`, [['کارمند', 'حاضر', 'غایب', 'مرخصی', 'کارکرد(ساعت)', 'اضافه‌کار(ساعت)', 'حقوقِ تخمینی'], ...employees.map((e) => { const c = calc(e); return [e.name, c.present, c.absent, c.leave, c.workedHours, c.ot, c.pay]; })])}>📤 خروجیِ اکسل (CSV)</button>
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

          {/* ---------------- payslip ---------------- */}
          {tab === 'slip' && (employees.length === 0 ? (
            <div className="tool-note">اول از تبِ «کارمندان» چند نفر اضافه کنید.</div>
          ) : (
            <>
              <div className="att-monthnav">
                <button onClick={() => shiftMonth(-1)}>‹</button>
                <span>{monthLabel}</span>
                <button onClick={() => shiftMonth(1)}>›</button>
              </div>
              {selfMode ? (
                <div className="acc-ledger-name">{employees.find((e) => e.id === empId)?.name || '—'}</div>
              ) : (
                <select className="tool-text-input" value={empId} onChange={(e) => setEmpId(e.target.value)}>
                  {employees.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
                </select>
              )}
              {curEmp && curCalc && (
                <>
                  <div className="acc-print">
                    <div className="acc-print-title">فیشِ حقوقی — {monthLabel}</div>
                    <table className="acc-table">
                      <tbody>
                        <tr><td>کارمند</td><td>{curEmp.name}{curEmp.code ? ` (#${curEmp.code})` : ''}</td></tr>
                        <tr><td>روزهای کارکرد</td><td>{curCalc.present} روز ({fmt(curCalc.workedHours)} ساعت)</td></tr>
                        <tr><td>حقوقِ پایه</td><td>{fmt(curCalc.base)}</td></tr>
                        <tr><td>اضافه‌کار ({fmt(curCalc.ot)} ساعت × ۱.۴)</td><td>{fmt(curCalc.otPay)}</td></tr>
                        <tr><td>مزایا</td><td>{fmt(curCalc.allow)}</td></tr>
                        <tr><td>کسورات</td><td>−{fmt(curCalc.deduct)}</td></tr>
                        <tr className="acc-total"><td>خالصِ پرداختی</td><td>{fmt(curCalc.pay)} تومان</td></tr>
                      </tbody>
                    </table>
                  </div>
                  {!selfMode && (
                    <div className="att-addgrid acc-noprint">
                      <input className="tool-text-input" type="text" inputMode="numeric" dir="ltr" placeholder="مزایا (پاداش…)" value={(state.adjust?.[empId]?.[ym]?.allow) ? String(state.adjust[empId][ym].allow) : ''} onChange={(e) => setAdjust('allow', e.target.value)} />
                      <input className="tool-text-input" type="text" inputMode="numeric" dir="ltr" placeholder="کسورات (بیمه…)" value={(state.adjust?.[empId]?.[ym]?.deduct) ? String(state.adjust[empId][ym].deduct) : ''} onChange={(e) => setAdjust('deduct', e.target.value)} />
                    </div>
                  )}
                  <button className="loan-submit acc-noprint" onClick={() => window.print()}>🖨️ چاپِ فیش / PDF</button>
                </>
              )}
            </>
          ))}

          {/* ---------------- personnel order (حکم کارگزینی) ---------------- */}
          {tab === 'decree' && (employees.length === 0 ? (
            <div className="tool-note">اول از تبِ «کارمندان» چند نفر اضافه کنید.</div>
          ) : (
            <>
              {selfMode ? (
                <div className="acc-ledger-name">{curEmp?.name || '—'}</div>
              ) : (
                <select className="tool-text-input" value={empId} onChange={(e) => setEmpId(e.target.value)}>
                  {employees.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
                </select>
              )}
              {curEmp && (
                <>
                  <div className="acc-print">
                    <div className="acc-print-title">حکم کارگزینی</div>
                    <table className="acc-table">
                      <tbody>
                        <tr><td>نام و نام‌خانوادگی</td><td>{curEmp.name}</td></tr>
                        {curEmp.code ? <tr><td>کدِ پرسنلی</td><td>{curEmp.code}</td></tr> : null}
                        <tr><td>سمت / پست</td><td>{curEmp.position || '—'}</td></tr>
                        <tr><td>تاریخِ استخدام</td><td>{curEmp.hire || '—'}</td></tr>
                        <tr><td>حقوقِ پایه</td><td>{curEmp.dailyRate ? `روزانه ${fmt(curEmp.dailyRate)}` : ''}{curEmp.hourlyRate ? ` · ساعتی ${fmt(curEmp.hourlyRate)}` : ''}{(!curEmp.dailyRate && !curEmp.hourlyRate) ? '—' : ''}</td></tr>
                        <tr><td>ساعتِ کاریِ روز</td><td>{standardHours} ساعت</td></tr>
                      </tbody>
                    </table>
                  </div>
                  {!selfMode && (
                    <div className="att-addgrid acc-noprint">
                      <input className="tool-text-input" type="text" placeholder="سمت / پست" value={curEmp.position || ''} onChange={(e) => updateEmployee(curEmp.id, { position: e.target.value })} />
                      <input className="tool-text-input" type="text" placeholder="تاریخِ استخدام (مثلاً ۱۴۰۲/۰۵/۰۱)" value={curEmp.hire || ''} onChange={(e) => updateEmployee(curEmp.id, { hire: e.target.value })} />
                    </div>
                  )}
                  <button className="loan-submit acc-noprint" onClick={() => window.print()}>🖨️ چاپِ حکم / PDF</button>
                </>
              )}
            </>
          ))}

          {/* ---------------- work rules (قوانینِ کاری) ---------------- */}
          {tab === 'rules' && (() => {
            const setRules = (patch: Partial<WorkRules>) => onChange({ ...state, rules: { ...rules, ...patch } });
            const toggleWeekend = (w: number) => setRules({ weekend: rules.weekend.includes(w) ? rules.weekend.filter((x) => x !== w) : [...rules.weekend, w] });
            const computed = hoursBetween(rules.start, rules.end);
            return (
              <>
                <div className="fund-help">قوانینِ کاریِ شرکتِ خود را اینجا تعریف کنید؛ تقویمِ حضور و غیاب بر اساسِ آن نمایش داده می‌شود.</div>
                <label className="field-label">ساعتِ کاری (شروع تا پایان)</label>
                <div className="att-addgrid">
                  <input className="tool-text-input" type="time" dir="ltr" value={rules.start} onChange={(e) => setRules({ start: e.target.value })} />
                  <input className="tool-text-input" type="time" dir="ltr" value={rules.end} onChange={(e) => setRules({ end: e.target.value })} />
                </div>
                <div className="tool-note">ساعتِ کاریِ روز: <b>{computed.toFixed(1)}</b> ساعت. <button className="att-inlinebtn" onClick={() => onChange({ ...state, standardHours: Math.round(computed * 10) / 10 })}>قراردادن به‌عنوانِ ساعتِ استاندارد</button></div>

                <label className="field-label">روزهای تعطیلِ هفته</label>
                <div className="att-weekdays">
                  {WEEKDAY_NAMES.map((nm, w) => (
                    <button key={w} type="button" className={`att-wd ${rules.weekend.includes(w) ? 'on' : ''}`} onClick={() => toggleWeekend(w)}>{nm}</button>
                  ))}
                </div>

                <label className="field-label">سیاستِ پنج‌شنبه</label>
                <div className="mini-toggle">
                  <button type="button" className={`mini-toggle-btn ${rules.thuPolicy === 'normal' ? 'active' : ''}`} onClick={() => setRules({ thuPolicy: 'normal' })}>عادی</button>
                  <button type="button" className={`mini-toggle-btn ${rules.thuPolicy === 'off' ? 'active' : ''}`} onClick={() => setRules({ thuPolicy: 'off' })}>تعطیلِ کامل</button>
                  <button type="button" className={`mini-toggle-btn ${rules.thuPolicy === 'early' ? 'active' : ''}`} onClick={() => setRules({ thuPolicy: 'early' })}>زودتر رفتن</button>
                </div>
                {rules.thuPolicy === 'early' && (
                  <>
                    <label className="field-label">پنج‌شنبه‌ها چند دقیقه زودتر؟</label>
                    <input className="tool-text-input" type="number" inputMode="numeric" dir="ltr" value={String(rules.thuEarlyMin)} onChange={(e) => setRules({ thuEarlyMin: digits(e.target.value) || 0 })} placeholder="مثلاً 90" />
                  </>
                )}

                <label className="fund-switch" style={{ marginTop: 12 }}>
                  <input type="checkbox" checked={!!rules.altWeeksOff} onChange={(e) => setRules({ altWeeksOff: e.target.checked })} />
                  <span>پنج‌شنبه‌ها «یک‌هفته‌درمیان» تعطیل (شیفتِ کاریِ متناوب)</span>
                </label>
                <label className="fund-switch" style={{ marginTop: 8 }}>
                  <input type="checkbox" checked={!!rules.shift2} onChange={(e) => setRules({ shift2: e.target.checked ? { start: '16:00', end: '00:00' } : null })} />
                  <span>شیفتِ دوم دارد (نوبت‌کاری)</span>
                </label>
                {rules.shift2 && (
                  <div className="att-addgrid">
                    <input className="tool-text-input" type="time" dir="ltr" value={rules.shift2.start} onChange={(e) => setRules({ shift2: { ...rules.shift2!, start: e.target.value } })} />
                    <input className="tool-text-input" type="time" dir="ltr" value={rules.shift2.end} onChange={(e) => setRules({ shift2: { ...rules.shift2!, end: e.target.value } })} />
                  </div>
                )}

                <label className="field-label">یادداشتِ قوانین (اختیاری)</label>
                <input className="tool-text-input" type="text" placeholder="مثلاً: نوبت‌کاری شیفت۱ و شیفت۲ هفته‌درمیان" value={rules.note || ''} onChange={(e) => setRules({ note: e.target.value })} />
                <div className="tool-note">این قوانین در دادهٔ سازمان ذخیره می‌شوند؛ پس «هر شرکت قوانینِ خودش» را دارد. در تقویمِ تبِ «حضور»، روزهای تعطیلِ هفتگی با × و پنج‌شنبه‌ی زودتر با ⏱ مشخص می‌شوند.</div>
              </>
            );
          })()}

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
