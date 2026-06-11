// حضور و غیابِ simorgh-ledger
// راهبرد در برابرِ «کسری»: بدونِ دستگاهِ ساعت‌زنی، موبایل/ابری، ساده، با محاسبه‌ی کارکرد و
// اضافه‌کار (۱.۴ برابر طبقِ عرفِ قانونِ کار) و حقوقِ تخمینی و گزارشِ ماهانه‌ی قابلِ چاپ.
// مدل عمداً ساده است تا صاحبِ کسب‌وکارِ کوچک بدونِ آموزش بتواند کار کند.
import { useState, useEffect } from 'react';
import { getToday, getMonthNames, getMonthDays, getFirstWeekdayOffset } from './calendar';
import { downloadCsv } from './csv';
import { cleanBarcode } from './barcode';
import Barcode from './BarcodeView';
import CameraScanner from './Scanner';
import type { AccType } from './Accounting';

const fmt = (n: number): string => Math.round(n || 0).toLocaleString('en-US');
const digits = (s: string): number => parseInt((s || '').replace(/[^0-9]/g, ''), 10) || 0;
const withSep = (s: string): string => { const d = digits(s); return d ? d.toLocaleString('en-US') : ''; };

export type DayStatus = 'present' | 'absent' | 'leave' | 'holiday';
export interface Employee { id: string; name: string; code?: string; dailyRate?: number; hourlyRate?: number; position?: string; hire?: string; managerId?: string; pay?: { [componentId: string]: number }; }
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
  // --- Advanced attendance policy (admin-configurable, fed into payroll) ---
  graceLateMin?: number;    // morning grace: lateness up to this many minutes is not penalized
  lateAllowPerMonth?: number; // number of late days per month that are forgiven before any deduction
  otMinMin?: number;        // overtime threshold: staying less than this past end-time does NOT count as overtime
  breakfastMin?: number;    // unpaid breakfast break deducted from worked hours
  lunchMin?: number;        // unpaid lunch break deducted from worked hours
  note?: string;
}
export const DEFAULT_RULES: WorkRules = { start: '08:00', end: '16:00', weekend: [6], thuPolicy: 'normal', thuEarlyMin: 90, shift2: null, altWeeksOff: false, graceLateMin: 0, lateAllowPerMonth: 0, otMinMin: 0, breakfastMin: 0, lunchMin: 0, note: '' };

// ---- Leave / permits workflow (modeled on Kasra's kardex + کارتابل + payroll) ----
// Leave TYPES are user-definable (the combobox the user can extend). Each type carries its own
// rules AND its payroll treatment, so salary can be computed from approved permits:
//   unit:      'day' or 'hour'  → how the amount is counted / paid.
//   paid:      true  → the absence is PAID (adds to salary like worked time);
//              false → بدون حقوق (unpaid → not paid).
//   fromBalance: true → draws from the annual استحقاقی kardex (مانده).
// `kind` on a request is the TYPE id (string), so adding a type just adds an option.
export type LeaveKind = string;
export type LeaveStatus = 'pending' | 'approved' | 'rejected';
export interface LeaveType {
  id: string;
  label: string;
  unit: 'day' | 'hour';
  paid: boolean;
  fromBalance: boolean;
  category?: string;       // نوعِ مجوز (grouping for the worker's two-step combobox) e.g. «کسر حضور ساعتی»
  enabled?: boolean;
  requireReason?: boolean;
  maxDays?: number;        // 0 = no cap
  isMission?: boolean;     // mission permit → show origin/destination/subject fields
  builtin?: boolean;
}
// Default catalogue (user can add/edit/disable these). Mirrors Kasra's مجوز vocabulary, grouped by category.
export const DEFAULT_LEAVE_TYPES: LeaveType[] = [
  { id: 'ent_day', label: 'استحقاقی روزانه', unit: 'day', paid: true, fromBalance: true, category: 'کسر حضور روزانه', enabled: true, builtin: true },
  { id: 'ent_hour', label: 'استحقاقی ساعتی', unit: 'hour', paid: true, fromBalance: true, category: 'کسر حضور ساعتی', enabled: true, builtin: true },
  { id: 'sick', label: 'استعلاجی', unit: 'day', paid: true, fromBalance: false, category: 'کسر حضور روزانه', enabled: true, requireReason: true, builtin: true },
  { id: 'unpaid', label: 'بدون حقوق', unit: 'day', paid: false, fromBalance: false, category: 'کسر حضور روزانه', enabled: true, requireReason: true, builtin: true },
  { id: 'exit', label: 'مجوزِ خروج', unit: 'hour', paid: true, fromBalance: false, category: 'کسر حضور ساعتی', enabled: true, builtin: true },
  { id: 'study_day', label: 'مرخصیِ تحصیلی روزانه', unit: 'day', paid: true, fromBalance: false, category: 'کسر حضور روزانه', enabled: true, builtin: true },
  { id: 'study_hour', label: 'مرخصیِ تحصیلی ساعتی', unit: 'hour', paid: true, fromBalance: false, category: 'کسر حضور ساعتی', enabled: true, builtin: true },
  { id: 'mission_day', label: 'مأموریت برون‌شهری روزانه', unit: 'day', paid: true, fromBalance: false, category: 'مأموریت', enabled: true, requireReason: true, isMission: true, builtin: true },
  { id: 'mission_hour', label: 'مأموریت درون‌شهری ساعتی', unit: 'hour', paid: true, fromBalance: false, category: 'مأموریت', enabled: true, requireReason: true, isMission: true, builtin: true },
  { id: 'overtime', label: 'مازادِ حضور (اضافه‌کار)', unit: 'hour', paid: true, fromBalance: false, category: 'مازاد حضور', enabled: true, builtin: true },
  { id: 'entry', label: 'ثبتِ تردد', unit: 'hour', paid: true, fromBalance: false, category: 'مازاد حضور', enabled: true, requireReason: true, builtin: true },
];
// A single approval action taken by one approver in the chain (کارتابل).
export interface LeaveApproval { by: string; at: string; result: 'approved' | 'rejected'; }
// A request / permit (مجوز). Routed up a chain of approvers (managers) defined by the org hierarchy.
export interface LeaveRequest {
  id: string;
  empId: string;
  kind: LeaveKind;         // = LeaveType.id
  year: number;            // Jalali year the request belongs to (for the annual kardex)
  from: string;            // free Jalali date text e.g. "۱۴۰۵/۰۳/۱۲" (used to bucket into a payroll month)
  to: string;
  fromTime?: string;       // از ساعت (for hourly permits) "HH:MM"
  toTime?: string;         // تا ساعت
  substitute?: string;     // جانشین — covering employee id
  mission?: { origin?: string; dest?: string; subject?: string }; // mission-only fields (مبدا/مقصد/موضوع)
  days: number;            // amount: working days, or hours when the type's unit is 'hour'
  reason?: string;
  status: LeaveStatus;
  chain: string[];         // ordered approver employee-ids (the manager hierarchy, bottom→top)
  level: number;           // index into chain of the approver currently expected to act
  approvals: LeaveApproval[];
  createdAt: string;
}
// Company leave policy (قوانینِ ثبتِ مرخصی) — annual kardex parameters.
export interface LeavePolicy {
  annualEntitled: number;  // استحقاقیِ سالانه (روز) — Iranian labor law ≈ 26 working days
  carryMax: number;        // سقفِ ذخیره‌ی سالیانه به سالِ بعد (روز)
  mustUseMin: number;      // ملزم به استفاده: حداقل روزی که باید در سال مصرف شود
  minNoticeDays?: number;  // حداقل روزِ پیش از شروعِ مرخصی برای ثبت (قانون)
  maxConsecutive?: number; // حداکثر روزِ پیوسته در یک مجوز
}
export const DEFAULT_LEAVE_POLICY: LeavePolicy = {
  annualEntitled: 26, carryMax: 9, mustUseMin: 5, minNoticeDays: 0, maxConsecutive: 0,
};
export interface LeaveState {
  policy: LeavePolicy;
  types: LeaveType[];      // user-definable type catalogue (the combobox)
  requests: LeaveRequest[];
  carry?: { [empId: string]: number }; // ذخیره‌ی منتقل‌شده از سالِ قبل (روز)
}
export function emptyLeave(): LeaveState { return { policy: { ...DEFAULT_LEAVE_POLICY }, types: DEFAULT_LEAVE_TYPES.map((t) => ({ ...t })), requests: [], carry: {} }; }

// Daily punch (تردد): one clock-in / clock-out pair per day. dayKey = "y-m-d" (Jalali, 0-based month).
export interface Punch { in: string; out: string; } // "HH:MM"

// Fixed monthly salary components defined per company (اجزای حکمِ کارگزینی): housing, food, child,
// seniority, job allowance, marriage, … plus worker-side deductions (e.g. insurance share).
// Each employee's حکم holds an amount per component id; they flow into the payslip and payroll.
export interface SalaryComponent { id: string; label: string; kind: 'earning' | 'deduction'; builtin?: boolean; }
export const DEFAULT_PAY_COMPONENTS: SalaryComponent[] = [
  { id: 'housing', label: 'حق مسکن', kind: 'earning', builtin: true },
  { id: 'food', label: 'بنِ کارگری (خواربار)', kind: 'earning', builtin: true },
  { id: 'child', label: 'حق اولاد', kind: 'earning', builtin: true },
  { id: 'seniority', label: 'حق سنوات (پایهٔ سنواتی)', kind: 'earning', builtin: true },
  { id: 'job', label: 'فوق‌العادهٔ شغل', kind: 'earning', builtin: true },
  { id: 'marriage', label: 'حق تأهل', kind: 'earning', builtin: true },
  { id: 'insurance', label: 'بیمه (سهمِ کارگر)', kind: 'deduction', builtin: true },
];

export interface AttendanceState {
  employees: Employee[];
  standardHours: number;                                   // ساعتِ کاریِ استانداردِ روز (پیش‌فرض ۸)
  records: { [empId: string]: { [dayKey: string]: DayStatus } }; // وضعیتِ هر روز؛ dayKey = "y-m-d" (شمسی، ماه ۰مبنا)
  overtime: { [empId: string]: { [ym: string]: number } };       // ساعتِ اضافه‌کارِ هر ماه؛ ym = "y-m"
  punches?: { [empId: string]: { [dayKey: string]: Punch } };    // ورود/خروجِ روزانه (کاردکسِ ساعتی)
  // WebAuthn credential id per employee — registered on the worker's own phone; the OS biometric
  // (fingerprint/face) must pass before a self check-in punch is accepted.
  bio?: { [empId: string]: string };
  payComponents?: SalaryComponent[];                       // company salary-component catalogue (اجزای حکم)
  // Per-month allowances/deductions for the payslip (bonuses, insurance, advances, ...).
  adjust?: { [empId: string]: { [ym: string]: { allow?: number; deduct?: number } } };
  rules?: WorkRules;                                       // company work-schedule rules
  leave?: LeaveState;                                      // leave kardex + permits + policy
}

export function emptyAttendance(): AttendanceState { return { employees: [], standardHours: 8, records: {}, overtime: {}, punches: {}, payComponents: DEFAULT_PAY_COMPONENTS.map((c) => ({ ...c })), adjust: {}, rules: { ...DEFAULT_RULES }, leave: emptyLeave() }; }
// Hours between two "HH:MM" times.
const hoursBetween = (a: string, b: string) => { const p = (s: string) => { const [h, m] = (s || '0:0').split(':').map(Number); return (h || 0) * 60 + (m || 0); }; return Math.max(0, (p(b) - p(a)) / 60); };
// Minutes for a "HH:MM" time.
const toMin = (s: string) => { const [h, m] = (s || '').split(':').map(Number); return (h || 0) * 60 + (m || 0); };
// Parse a free Jalali date string ("۱۴۰۵/۰۳/۱۲" or "1405-3-12") → { y, m(0-based) } for payroll bucketing.
const FA_DIGITS = '۰۱۲۳۴۵۶۷۸۹';
const toLatinDigits = (s: string) => (s || '').replace(/[۰-۹]/g, (d) => String(FA_DIGITS.indexOf(d)));
const parseJalali = (s: string): { y: number; m: number } | null => {
  const t = toLatinDigits(s).match(/(\d{3,4})\D+(\d{1,2})/);
  return t ? { y: +t[1], m: +t[2] - 1 } : null;
};
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
  // The current user's own employee id (if linked) — used to default their کارتابل (manager inbox).
  viewerEmpId?: string;
}
type Tab = 'kiosk' | 'log' | 'kardex' | 'report' | 'slip' | 'decree' | 'leave' | 'inbox' | 'rules' | 'staff';

export default function AttendancePanel({ state, onChange, onClose, confirm, onPostJournal, selfMode, selfEmpId, viewerEmpId }: Props) {
  const employees = state.employees || [];
  const standardHours = state.standardHours || 8;
  const records = state.records || {};
  const overtime = state.overtime || {};
  const punches = state.punches || {};
  const payComponents = state.payComponents && state.payComponents.length ? state.payComponents : DEFAULT_PAY_COMPONENTS;
  const monthNames = getMonthNames('jalali');
  const today = getToday('jalali');

  // Leave catalogue + lookup (defined early so payroll calc can use it).
  const leave = state.leave || emptyLeave();
  const policy = leave.policy || DEFAULT_LEAVE_POLICY;
  const leaveTypes = leave.types && leave.types.length ? leave.types : DEFAULT_LEAVE_TYPES;
  // Resolve a request's type; tolerate unknown ids from older data with a sensible fallback.
  const typeOf = (id: string): LeaveType => leaveTypes.find((t) => t.id === id) || { id, label: id, unit: 'day', paid: true, fromBalance: id.startsWith('ent') };

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
  // Set one side (in/out) of a day's punch (تردد). Empty pair is removed.
  const setPunch = (d: number, field: 'in' | 'out', val: string) => {
    if (!empId) return;
    const emp = { ...(punches[empId] || {}) };
    const cur: Punch = { ...(emp[`${y}-${m}-${d}`] || { in: '', out: '' }), [field]: val };
    if (!cur.in && !cur.out) delete emp[`${y}-${m}-${d}`]; else emp[`${y}-${m}-${d}`] = cur;
    onChange({ ...state, punches: { ...punches, [empId]: emp } });
  };

  // ---------- ساعت‌زنی (kiosk): گوشیِ نگهبان به‌جای دستگاهِ حضور و غیاب ----------
  // Each employee has a badge barcode (their personnel code, or a stable code from their id).
  // Scanning the badge punches in (first scan of the day) or updates the exit time (later scans),
  // feeding the same punch kardex used for تأخیر/تعجیل/کسرِ کار and payroll.
  const empBadge = (e: Employee) => cleanBarcode(e.code || '') || ('E' + e.id.replace(/\D/g, '').slice(-8));
  const [kioskScan, setKioskScan] = useState('');
  const [kioskCam, setKioskCam] = useState(false);
  const [kioskMsg, setKioskMsg] = useState<{ text: string; ok: boolean } | null>(null);
  const [clock, setClock] = useState('');
  useEffect(() => {
    if (tab !== 'kiosk') return;
    const tick = () => setClock(new Date().toLocaleTimeString('fa-IR', { hour: '2-digit', minute: '2-digit', second: '2-digit' }));
    tick(); const t = setInterval(tick, 1000);
    return () => clearInterval(t);
  }, [tab]);
  // Record an in/out punch for NOW (shared by the kiosk and the biometric self check-in).
  // First punch of the day = in; later punches update the exit time. The day is auto-marked present.
  const recordPunch = (emp: Employee): { action: string; hm: string } => {
    const t = getToday('jalali');                       // punch on the real current date
    const key = `${t.year}-${t.month}-${t.day}`;
    const hm = new Date().toTimeString().slice(0, 5);   // "HH:MM" now
    const empP = { ...(punches[emp.id] || {}) };
    const cur: Punch = { ...(empP[key] || { in: '', out: '' }) };
    const action = !cur.in ? 'ورود' : 'خروج';
    if (!cur.in) cur.in = hm; else cur.out = hm;
    empP[key] = cur;
    const empRec = { ...(records[emp.id] || {}) };
    if (!empRec[key]) empRec[key] = 'present';
    onChange({ ...state, punches: { ...punches, [emp.id]: empP }, records: { ...records, [emp.id]: empRec } });
    return { action, hm };
  };
  const kioskPunch = (raw: string) => {
    const code = cleanBarcode(raw); setKioskScan('');
    const emp = employees.find((e) => empBadge(e) === code);
    if (!emp) { setKioskMsg({ text: `کارتِ «${raw}» شناخته نشد.`, ok: false }); return; }
    const r = recordPunch(emp);
    setKioskMsg({ text: `${emp.name} — ${r.action} ${r.hm} ✓`, ok: true });
  };
  // Badge card being printed (from the staff tab).
  const [badgeEmp, setBadgeEmp] = useState<Employee | null>(null);

  // ---------- بیومتریکِ گوشیِ کارمند (WebAuthn): اثرانگشت/چهره برای ثبتِ حضورِ خودش ----------
  // The credential is created with userVerification:'required' on a platform authenticator, so the
  // phone's OS biometric prompt (fingerprint/face) must pass for every punch. Device-bound: works on
  // the phone where it was registered; re-registering replaces it.
  const [bioMsg, setBioMsg] = useState<{ text: string; ok: boolean } | null>(null);
  const bioSupported = typeof window !== 'undefined' && !!window.PublicKeyCredential && !!navigator.credentials;
  const b64u = (buf: ArrayBuffer) => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  const b64uDecode = (s: string) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0));
  const bioRegister = async () => {
    const emp = employees.find((e) => e.id === selfEmpId); if (!emp) return;
    if (!bioSupported) { setBioMsg({ text: 'این دستگاه/مرورگر از تأییدِ بیومتریک پشتیبانی نمی‌کند. از نسخه‌ی وب (Chrome) یا کارتِ ساعت‌زنی استفاده کنید.', ok: false }); return; }
    try {
      const cred = (await navigator.credentials.create({
        publicKey: {
          challenge: crypto.getRandomValues(new Uint8Array(32)),
          rp: { name: 'simorgh-ledger' },
          user: { id: new TextEncoder().encode(emp.id), name: emp.name, displayName: emp.name },
          pubKeyCredParams: [{ type: 'public-key', alg: -7 }, { type: 'public-key', alg: -257 }],
          authenticatorSelection: { authenticatorAttachment: 'platform', userVerification: 'required' },
          timeout: 60000,
        },
      })) as PublicKeyCredential | null;
      if (!cred) throw new Error('no credential');
      onChange({ ...state, bio: { ...(state.bio || {}), [emp.id]: b64u(cred.rawId) } });
      setBioMsg({ text: 'اثرانگشت/چهره فعال شد ✓ — از این پس با همین دکمه ورود/خروج بزنید.', ok: true });
    } catch { setBioMsg({ text: 'فعال‌سازی ناموفق بود یا لغو شد.', ok: false }); }
  };
  const bioPunch = async () => {
    const emp = employees.find((e) => e.id === selfEmpId); if (!emp) return;
    const credId = state.bio?.[emp.id];
    if (!credId) { await bioRegister(); return; }
    try {
      const assertion = await navigator.credentials.get({
        publicKey: {
          challenge: crypto.getRandomValues(new Uint8Array(32)),
          allowCredentials: [{ type: 'public-key', id: b64uDecode(credId) }],
          userVerification: 'required',
          timeout: 60000,
        },
      });
      if (!assertion) throw new Error('no assertion');
      const r = recordPunch(emp);
      setBioMsg({ text: `${r.action} ${r.hm} ثبت شد ✓`, ok: true });
    } catch { setBioMsg({ text: 'تأییدِ هویت ناموفق بود. اگر دستگاه عوض شده، دوباره فعال‌سازی کنید.', ok: false }); }
  };

  // ---------- کاردکسِ ساعتی: محاسبه‌ی یک روز از روی ترددِ ورود/خروج ----------
  // Returns null when there is no punch for that day. Applies the company policy: unpaid breaks are
  // deducted from worked hours; morning lateness within the grace window is forgiven; staying past the
  // end-time counts as overtime only beyond the overtime threshold. Returns late/early/shortfall/surplus.
  const punchCalc = (empId2: string, d: number) => {
    const pk = punches[empId2]?.[`${y}-${m}-${d}`];
    if (!pk || (!pk.in && !pk.out)) return null;
    const breaksH = ((rules.breakfastMin || 0) + (rules.lunchMin || 0)) / 60; // unpaid breaks
    const worked = Math.max(0, hoursBetween(pk.in, pk.out) - breaksH);        // net worked (breaks removed)
    let endMin = toMin(rules.end);
    if (isThuEarly(d)) endMin -= (rules.thuEarlyMin || 0); // Thursday leaves earlier → smaller target
    const startMin = toMin(rules.start);
    const expected = isWeekendDay(d) ? 0 : Math.max(0, (endMin - startMin) / 60 - breaksH);
    const grace = (rules.graceLateMin || 0);
    const lateRaw = Math.max(0, toMin(pk.in) - startMin);              // raw minutes late
    const late = Math.max(0, (lateRaw - grace)) / 60;                 // forgiven up to the grace window
    const early = Math.max(0, (endMin - toMin(pk.out)) / 60);
    const shortfall = late + early;                                   // کسرِ کار = تأخیرِ مؤثر + تعجیل
    const surplusRaw = Math.max(0, worked - expected);
    // Overtime counts only beyond the threshold (short overstays are not overtime).
    const surplus = surplusRaw * 60 >= (rules.otMinMin || 0) ? surplusRaw : 0;
    return { in: pk.in, out: pk.out, worked, expected, late, lateRaw, early, shortfall, surplus, isLate: late > 0 };
  };

  // ---------- محاسبه‌ی کارکرد و حقوقِ یک کارمند در ماهِ جاری ----------
  const calc = (e: Employee) => {
    const rec = records[e.id] || {};
    let present = 0, absent = 0, leave = 0, holiday = 0;
    // Aggregate the daily punches (hourly kardex) across the month.
    let punchDays = 0, punchWorked = 0, lateH = 0, earlyH = 0, surplusH = 0;
    const lateList: number[] = [];   // late hours per late-day, to apply the monthly forgiveness
    for (let d = 1; d <= daysInMonth; d++) {
      const s = rec[`${y}-${m}-${d}`];
      if (s === 'present') present++; else if (s === 'absent') absent++; else if (s === 'leave') leave++; else if (s === 'holiday') holiday++;
      const pc = punchCalc(e.id, d);
      if (pc) { punchDays++; punchWorked += pc.worked; lateH += pc.late; earlyH += pc.early; surplusH += pc.surplus; if (pc.late > 0) lateList.push(pc.late); }
    }
    // Forgive the smallest N late occurrences this month (admin's allowed-late count).
    const forgiveN = rules.lateAllowPerMonth || 0;
    lateList.sort((a, b) => a - b);
    const forgivenLateH = lateList.slice(0, forgiveN).reduce((s, v) => s + v, 0);
    const lateCount = lateList.length;
    const effectiveLateH = Math.max(0, lateH - forgivenLateH);
    const shortfallH = effectiveLateH + earlyH;   // کسرِ کار after forgiving allowed lateness
    // Approved leave permits that fall in THIS payroll month feed the salary (paid vs unpaid).
    let paidLeaveDays = 0, paidLeaveHours = 0, unpaidDays = 0, unpaidHours = 0;
    for (const r of (state.leave?.requests || [])) {
      if (r.empId !== e.id || r.status !== 'approved') continue;
      const p = parseJalali(r.from) || { y: r.year, m };   // fall back to its year/current month
      if (p.y !== y || p.m !== m) continue;
      const ty = typeOf(r.kind); const amt = r.days || 0;
      if (ty.paid) { if (ty.unit === 'hour') paidLeaveHours += amt; else paidLeaveDays += amt; }
      else { if (ty.unit === 'hour') unpaidHours += amt; else unpaidDays += amt; }
    }
    // Derive day-rate and hour-rate from whichever the user filled in.
    const dayRate = e.dailyRate || (e.hourlyRate ? e.hourlyRate * standardHours : 0);
    const hrRate = e.hourlyRate || (e.dailyRate ? e.dailyRate / standardHours : 0);
    // Overtime = manual entry + surplus measured from punches (1.4× labor-law factor).
    const manualOt = overtime[e.id]?.[ym] || 0;
    const ot = manualOt + surplusH;
    // Paid days = worked days (from punches if any, else grid-present) + PAID leave days.
    const workedDays = punchDays > 0 ? punchDays : present;
    const workedHours = (punchDays > 0 ? punchWorked : present * standardHours) + paidLeaveHours;
    const base = dayRate * (workedDays + paidLeaveDays) + hrRate * paidLeaveHours;
    const otPay = hrRate * 1.4 * ot;
    const adj = (state.adjust || {})[e.id]?.[ym] || {};
    const allow = adj.allow || 0;                          // allowances / bonuses
    const manualDeduct = adj.deduct || 0;                  // manual deductions (insurance, advances…)
    // Fixed monthly salary components from the حکم (housing, food, child, …) split into earnings/deductions.
    let compEarn = 0, compDeduct = 0;
    for (const c of payComponents) {
      const v = e.pay?.[c.id] || 0;
      if (c.kind === 'deduction') compDeduct += v; else compEarn += v;
    }
    // Shortfall (تأخیر/تعجیل/کسرِ کار) and unpaid hourly leave reduce the salary.
    const shortfallPay = hrRate * (shortfallH + unpaidHours);
    const deduct = manualDeduct + shortfallPay + compDeduct;
    const pay = Math.max(0, base + otPay + allow + compEarn - deduct);
    return { present, absent, leave, holiday, ot, manualOt, workedHours, workedDays, base, otPay, allow, deduct, manualDeduct, pay,
      punchDays, lateH, earlyH, shortfallH, surplusH, lateCount, forgivenLateH, paidLeaveDays, paidLeaveHours, unpaidDays, unpaidHours, shortfallPay, compEarn, compDeduct };
  };
  const setAdjust = (field: 'allow' | 'deduct', val: string) => {
    if (!empId) return;
    const adjust = state.adjust || {};
    const empAdj = { ...(adjust[empId] || {}) };
    empAdj[ym] = { ...(empAdj[ym] || {}), [field]: digits(val) };
    onChange({ ...state, adjust: { ...adjust, [empId]: empAdj }, employees, standardHours, records, overtime });
  };

  // ---------- مرخصی: کاردکس، مجوزها و کارتابلِ مدیران ----------
  const setLeave = (patch: Partial<LeaveState>) => onChange({ ...state, leave: { ...leave, ...patch } });
  const setPolicy = (patch: Partial<LeavePolicy>) => setLeave({ policy: { ...policy, ...patch } });
  const nameOf = (id: string) => employees.find((e) => e.id === id)?.name || '—';
  // Build the approver chain (manager hierarchy) for an employee: their سرپرست, then that manager's
  // manager, and so on to the top. This drives both routing and each manager's کارتابل.
  const managerChain = (id: string): string[] => {
    const chain: string[] = []; const seen = new Set<string>();
    let cur = employees.find((e) => e.id === id)?.managerId;
    while (cur && !seen.has(cur)) { seen.add(cur); chain.push(cur); cur = employees.find((e) => e.id === cur)?.managerId; }
    return chain;
  };
  // Managers = anyone who is someone else's سرپرست (appears as a managerId).
  const managerIds = [...new Set(employees.map((e) => e.managerId).filter(Boolean) as string[])];
  // Annual kardex for one employee in the selected year `y`.
  // entitled (استحقاقی) = yearly grant + carry-in; used (کسر شده) = approved balance-drawing days;
  // remaining (مانده) = entitled − used; saveable (ذخیره‌ی سالیانه) = min(remaining, carryMax).
  // Hour-unit balance types are converted to days at standardHours so the kardex stays in days.
  const leaveKardex = (e: Employee) => {
    const carryIn = leave.carry?.[e.id] || 0;
    const entitled = (policy.annualEntitled || 0) + carryIn;
    const inDays = (r: LeaveRequest) => typeOf(r.kind).unit === 'hour' ? (r.days || 0) / standardHours : (r.days || 0);
    const reqs = (leave.requests || []).filter((r) => r.empId === e.id && r.year === y && typeOf(r.kind).fromBalance);
    const used = reqs.filter((r) => r.status === 'approved').reduce((s, r) => s + inDays(r), 0);
    const pending = reqs.filter((r) => r.status === 'pending').reduce((s, r) => s + inDays(r), 0);
    const remaining = entitled - used;
    const saveable = Math.min(Math.max(0, remaining), policy.carryMax || 0);
    const mustUse = policy.mustUseMin || 0;
    // shortfall = how many of the required-to-use days are still not consumed.
    const shortfall = Math.max(0, mustUse - used);
    return { carryIn, entitled, used, pending, remaining, saveable, mustUse, shortfall };
  };
  // ---------- type catalogue management (the user-extendable combobox) ----------
  const setTypes = (types: LeaveType[]) => setLeave({ types });
  const updateType = (id: string, patch: Partial<LeaveType>) => setTypes(leaveTypes.map((t) => (t.id === id ? { ...t, ...patch } : t)));
  const addType = (label: string, unit: 'day' | 'hour', paid: boolean, fromBalance: boolean, category: string) =>
    setTypes([...leaveTypes, { id: `lt-${Date.now()}`, label: label.trim(), unit, paid, fromBalance, category: category.trim() || 'سایر', enabled: true }]);
  const delType = (id: string) => setTypes(leaveTypes.filter((t) => t.id !== id));
  const enabledTypes = leaveTypes.filter((t) => t.enabled !== false);
  // Distinct categories (نوعِ مجوز) for the worker's first combobox.
  const leaveCats = [...new Set(enabledTypes.map((t) => t.category || 'سایر'))];
  // New-request form state. lkCat = category, lkKind = the specific permit within it.
  const [lkCat, setLkCat] = useState<string>(enabledTypes[0]?.category || leaveCats[0] || '');
  const typesInCat = enabledTypes.filter((t) => (t.category || 'سایر') === lkCat);
  const [lkKind, setLkKind] = useState<LeaveKind>(enabledTypes[0]?.id || 'ent_day');
  const [lkFrom, setLkFrom] = useState(''); const [lkTo, setLkTo] = useState('');
  const [lkFromTime, setLkFromTime] = useState(''); const [lkToTime, setLkToTime] = useState('');
  const [lkSub, setLkSub] = useState(''); const [lkDays, setLkDays] = useState(''); const [lkReason, setLkReason] = useState('');
  const [lkOrigin, setLkOrigin] = useState(''); const [lkDest, setLkDest] = useState(''); const [lkSubject, setLkSubject] = useState('');
  const curType = typeOf(lkKind);
  // New leave-type form state (the user-extendable combobox catalogue).
  const [ntLabel, setNtLabel] = useState(''); const [ntUnit, setNtUnit] = useState<'day' | 'hour'>('day');
  const [ntPaid, setNtPaid] = useState(true); const [ntBalance, setNtBalance] = useState(false); const [ntCat, setNtCat] = useState('');
  const submitLeave = () => {
    if (!empId || !lkDays) return;
    const rule = typeOf(lkKind);
    const days = parseFloat(lkDays.replace(/[^0-9.]/g, '')) || 0;
    if (days <= 0) return;
    if (rule.requireReason && !lkReason.trim()) { confirm('برای این نوعِ درخواست، نوشتنِ علت الزامی است.', () => {}); return; }
    if (rule.maxDays && days > rule.maxDays) { confirm(`حداکثرِ مجازِ این نوعِ درخواست ${rule.maxDays} ${rule.unit === 'hour' ? 'ساعت' : 'روز'} است.`, () => {}); return; }
    const chain = managerChain(empId); // route up the manager hierarchy
    const req: LeaveRequest = {
      id: `lv-${Date.now()}`, empId, kind: lkKind, year: y,
      from: lkFrom.trim(), to: lkTo.trim(),
      fromTime: rule.unit === 'hour' ? (lkFromTime || undefined) : undefined,
      toTime: rule.unit === 'hour' ? (lkToTime || undefined) : undefined,
      substitute: lkSub || undefined,
      mission: rule.isMission ? { origin: lkOrigin.trim() || undefined, dest: lkDest.trim() || undefined, subject: lkSubject.trim() || undefined } : undefined,
      days,
      reason: lkReason.trim() || undefined, status: 'pending', chain, level: 0, approvals: [], createdAt: new Date().toISOString(),
    };
    setLeave({ requests: [req, ...(leave.requests || [])] });
    setLkFrom(''); setLkTo(''); setLkFromTime(''); setLkToTime(''); setLkSub(''); setLkDays(''); setLkReason(''); setLkOrigin(''); setLkDest(''); setLkSubject('');
  };
  // Approve/reject by the current approver. Approving advances up the chain; the last approver finalizes.
  const actLeave = (id: string, result: 'approved' | 'rejected', byEmpId?: string) => {
    setLeave({
      requests: (leave.requests || []).map((r) => {
        if (r.id !== id || r.status !== 'pending') return r;
        const approver = byEmpId ? nameOf(byEmpId) : (r.chain[r.level] ? nameOf(r.chain[r.level]) : 'مدیر');
        const ap: LeaveApproval = { by: approver, at: new Date().toISOString().slice(0, 10), result };
        if (result === 'rejected') return { ...r, status: 'rejected', approvals: [...r.approvals, ap] };
        const nextLevel = r.level + 1;
        const done = nextLevel >= Math.max(1, r.chain.length); // empty chain → single admin approval finalizes
        return { ...r, level: nextLevel, status: done ? 'approved' : 'pending', approvals: [...r.approvals, ap] };
      }),
    });
  };
  const delLeave = (id: string) => setLeave({ requests: (leave.requests || []).filter((r) => r.id !== id) });
  // Current approver employee-id of a pending request (empty chain → handled by admin/مدیرِ ارشد).
  const currentApprover = (r: LeaveRequest): string | null => (r.chain && r.chain.length ? (r.chain[r.level] || null) : null);
  // کارتابل selector: which manager's inbox is shown. Default to the viewer if they are a manager.
  const [inboxMgr, setInboxMgr] = useState<string>(() => (viewerEmpId && employees.some((e) => e.managerId === viewerEmpId)) ? viewerEmpId! : 'all');

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
  // Set one salary-component amount on an employee's حکم.
  const setEmpPay = (id: string, compId: string, val: number) => updateEmployee(id, { pay: { ...(employees.find((e) => e.id === id)?.pay || {}), [compId]: val } });
  // Company salary-component catalogue management (اجزای حکم).
  const setComponents = (payComponents2: SalaryComponent[]) => onChange({ ...state, payComponents: payComponents2 });
  const addComponent = (label: string, kind: 'earning' | 'deduction') => setComponents([...payComponents, { id: `pc-${Date.now()}`, label: label.trim(), kind }]);
  const delComponent = (id: string) => setComponents(payComponents.filter((c) => c.id !== id));
  const [pcLabel, setPcLabel] = useState(''); const [pcKind, setPcKind] = useState<'earning' | 'deduction'>('earning');
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
            {!selfMode && <button type="button" className={`mini-toggle-btn ${tab === 'kiosk' ? 'active' : ''}`} onClick={() => setTab('kiosk')}>ساعت‌زنی</button>}
            <button type="button" className={`mini-toggle-btn ${tab === 'log' ? 'active' : ''}`} onClick={() => setTab('log')}>{selfMode ? 'حضورِ من' : 'ثبتِ ماهانه'}</button>
            <button type="button" className={`mini-toggle-btn ${tab === 'kardex' ? 'active' : ''}`} onClick={() => setTab('kardex')}>{selfMode ? 'کارکردِ من' : 'کارکرد روزانه'}</button>
            {!selfMode && <button type="button" className={`mini-toggle-btn ${tab === 'report' ? 'active' : ''}`} onClick={() => setTab('report')}>گزارش</button>}
            <button type="button" className={`mini-toggle-btn ${tab === 'slip' ? 'active' : ''}`} onClick={() => setTab('slip')}>{selfMode ? 'فیشِ من' : 'فیش'}</button>
            <button type="button" className={`mini-toggle-btn ${tab === 'decree' ? 'active' : ''}`} onClick={() => setTab('decree')}>حکم</button>
            <button type="button" className={`mini-toggle-btn ${tab === 'leave' ? 'active' : ''}`} onClick={() => setTab('leave')}>{selfMode ? 'درخواست‌ها' : 'مرخصی'}</button>
            {!selfMode && <button type="button" className={`mini-toggle-btn ${tab === 'inbox' ? 'active' : ''}`} onClick={() => setTab('inbox')}>کارتابل</button>}
            {!selfMode && <button type="button" className={`mini-toggle-btn ${tab === 'rules' ? 'active' : ''}`} onClick={() => setTab('rules')}>قوانین</button>}
            {!selfMode && <button type="button" className={`mini-toggle-btn ${tab === 'staff' ? 'active' : ''}`} onClick={() => setTab('staff')}>کارمندان</button>}
          </div>

          {/* ---------------- ساعت‌زنی (kiosk: گوشیِ نگهبان به‌جای دستگاه) ---------------- */}
          {tab === 'kiosk' && (employees.length === 0 ? (
            <div className="tool-note">اول از تبِ «کارمندان» چند نفر اضافه کنید و کارتِ هرکدام را چاپ کنید (🪪).</div>
          ) : (
            <>
              <div className="att-kiosk-clock" dir="ltr">{clock}</div>
              <div className="fund-help">گوشی/تبلت را به نگهبان بدهید: کارتِ بارکدیِ کارمند را با دوربین یا کارت‌خوان اسکن کنید. اولین اسکنِ روز = ورود؛ اسکن‌های بعدی = خروج. زمان‌ها مستقیم در کاردکس (تأخیر/تعجیل) و حقوق حساب می‌شوند.</div>
              {kioskMsg && <div className={`att-kiosk-msg ${kioskMsg.ok ? 'ok' : 'bad'}`}>{kioskMsg.text}</div>}
              <div className="att-addgrid">
                <input className="tool-text-input" type="text" dir="ltr" autoFocus placeholder="کارت را اسکن کنید…" value={kioskScan} onChange={(e) => setKioskScan(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && kioskScan.trim()) kioskPunch(kioskScan.trim()); }} />
                <button className="acc-addline" onClick={() => setKioskCam(true)}>📷 دوربین</button>
              </div>
              <div className="loan-sched-head"><span>ترددهای امروز</span></div>
              <div className="loan-detail-list">
                {(() => {
                  const t = getToday('jalali'); const key = `${t.year}-${t.month}-${t.day}`;
                  const rows = employees.map((e) => ({ e, p: punches[e.id]?.[key] })).filter((x) => x.p && (x.p.in || x.p.out));
                  return rows.length === 0 ? <div className="tool-note">امروز هنوز ترددی ثبت نشده.</div> : rows.map(({ e, p }) => (
                    <div key={e.id} className="loan-detail-row">
                      <div className="ld-info">
                        <span className="ld-amt">{e.name}</span>
                        <span className="ld-date" dir="ltr">{p!.in ? `ورود ${p!.in}` : ''}{p!.out ? ` · خروج ${p!.out}` : ''}</span>
                      </div>
                    </div>
                  ));
                })()}
              </div>
              <div className="tool-note">کارت‌خوان‌های RFID/بارکدیِ ارزان که مثلِ صفحه‌کلید عمل می‌کنند هم با همین فیلد کار می‌کنند. دستگاه‌های چهره/اثرانگشتِ شبکه‌ای (مثلاً ZKTeco) در فازِ سرور وصل می‌شوند.</div>
              {kioskCam && <CameraScanner continuous onClose={() => setKioskCam(false)} onResult={(code) => kioskPunch(code)} />}
            </>
          ))}

          {/* ---------------- ثبتِ ماهانه ---------------- */}
          {tab === 'log' && (employees.length === 0 ? (
            <div className="tool-note">اول از تبِ «کارمندان» چند نفر اضافه کنید.</div>
          ) : (
            <>
              {/* biometric self check-in (worker's own phone fingerprint/face) */}
              {selfMode && selfEmpId && (
                <div className="att-bio">
                  {bioMsg && <div className={`att-kiosk-msg ${bioMsg.ok ? 'ok' : 'bad'}`}>{bioMsg.text}</div>}
                  {(() => { const t = getToday('jalali'); const k = `${t.year}-${t.month}-${t.day}`; const pp = punches[selfEmpId]?.[k];
                    return <div className="att-bio-today" dir="rtl">امروز: {pp?.in ? `ورود ${pp.in}` : '—'}{pp?.out ? ` · خروج ${pp.out}` : ''}</div>; })()}
                  {state.bio?.[selfEmpId]
                    ? <button className="loan-submit" onClick={bioPunch}>🔒 ثبتِ ورود/خروج با اثرانگشت/چهره</button>
                    : <button className="loan-submit" onClick={bioRegister}>🔒 فعال‌سازیِ ثبتِ حضور با اثرانگشت/چهره</button>}
                  <div className="tool-note">هویت با اثرانگشت/چهره‌ی همین گوشی تأیید و زمانِ دقیق ثبت می‌شود؛ مستقیم در کاردکس و حقوق حساب می‌شود.</div>
                </div>
              )}
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

          {/* ---------------- daily punch kardex (کارکرد روزانه: ورود/خروج) ---------------- */}
          {tab === 'kardex' && (employees.length === 0 ? (
            <div className="tool-note">اول از تبِ «کارمندان» چند نفر اضافه کنید.</div>
          ) : (
            <>
              <div className="att-monthnav">
                <button onClick={() => shiftMonth(-1)}>‹</button>
                <span>{monthLabel}</span>
                <button onClick={() => shiftMonth(1)}>›</button>
              </div>
              {selfMode ? (
                <div className="acc-ledger-name">{curEmp?.name || '—'}</div>
              ) : (
                <select className="tool-text-input" value={empId} onChange={(e) => setEmpId(e.target.value)}>
                  {employees.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
                </select>
              )}
              <div className="tool-note">ساعتِ ورود/خروج را وارد کنید؛ تأخیر/تعجیل و کسرِ کار و مازادِ حضور بر اساسِ «قوانینِ کاری» ({rules.start}–{rules.end}) محاسبه می‌شود و به حقوق وصل است.</div>
              <div className="att-kardex-wrap">
                <table className="acc-table att-kardex">
                  <thead><tr><th>روز</th><th>ورود</th><th>خروج</th><th>کارکرد</th><th>تأخیر</th><th>تعجیل</th><th>کسر</th><th>مازاد</th></tr></thead>
                  <tbody>
                    {Array.from({ length: daysInMonth }, (_, i) => i + 1).map((d) => {
                      const pc = punchCalc(empId, d);
                      const pk = punches[empId]?.[`${y}-${m}-${d}`];
                      const off = isWeekendDay(d);
                      return (
                        <tr key={d} className={off ? 'att-krow-off' : ''}>
                          <td>{d} <span className="att-krow-wd">{WEEKDAY_NAMES[weekdayOf(d)]}</span></td>
                          <td><input className="att-ktime" type="time" dir="ltr" disabled={selfMode} value={pk?.in || ''} onChange={(e) => setPunch(d, 'in', e.target.value)} /></td>
                          <td><input className="att-ktime" type="time" dir="ltr" disabled={selfMode} value={pk?.out || ''} onChange={(e) => setPunch(d, 'out', e.target.value)} /></td>
                          <td>{pc ? pc.worked.toFixed(1) : '—'}</td>
                          <td className={pc && pc.late > 0 ? 'att-kbad' : ''}>{pc && pc.late > 0 ? pc.late.toFixed(1) : '—'}</td>
                          <td className={pc && pc.early > 0 ? 'att-kbad' : ''}>{pc && pc.early > 0 ? pc.early.toFixed(1) : '—'}</td>
                          <td className={pc && pc.shortfall > 0 ? 'att-kbad' : ''}>{pc && pc.shortfall > 0 ? pc.shortfall.toFixed(1) : '—'}</td>
                          <td className={pc && pc.surplus > 0 ? 'att-kgood' : ''}>{pc && pc.surplus > 0 ? pc.surplus.toFixed(1) : '—'}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              {curCalc && (
                <div className="tool-result">
                  <div className="tool-result-row"><span>روزهای ترددشده</span><strong>{curCalc.punchDays}</strong></div>
                  <div className="tool-result-row"><span>کارکرد / تأخیر / تعجیل (ساعت)</span><strong>{fmt(curCalc.workedHours)} / {curCalc.lateH.toFixed(1)} / {curCalc.earlyH.toFixed(1)}</strong></div>
                  <div className="tool-result-row"><span>دفعاتِ تأخیر (بخشیده‌شده)</span><strong>{curCalc.lateCount} ({curCalc.forgivenLateH.toFixed(1)} ساعت)</strong></div>
                  <div className="tool-result-row"><span>کسرِ کار / مازادِ حضور (ساعت)</span><strong>{curCalc.shortfallH.toFixed(1)} / {curCalc.surplusH.toFixed(1)}</strong></div>
                  <div className="tool-result-row closing"><span>اثرِ کسرِ کار بر حقوق</span><strong>−{fmt(curCalc.shortfallPay)}</strong></div>
                </div>
              )}
              {!selfMode && (
                <button className="acc-addline acc-noprint" onClick={() => downloadCsv(`kardex-${empId}-${ym}.csv`, [['روز', 'هفته', 'ورود', 'خروج', 'کارکرد', 'تأخیر', 'تعجیل', 'کسر', 'مازاد'], ...Array.from({ length: daysInMonth }, (_, i) => i + 1).map((d) => { const pc = punchCalc(empId, d); const pk = punches[empId]?.[`${y}-${m}-${d}`]; return [d, WEEKDAY_NAMES[weekdayOf(d)], pk?.in || '', pk?.out || '', pc ? pc.worked.toFixed(1) : '', pc ? pc.late.toFixed(1) : '', pc ? pc.early.toFixed(1) : '', pc ? pc.shortfall.toFixed(1) : '', pc ? pc.surplus.toFixed(1) : '']; })])}>📤 خروجیِ اکسلِ کارکرد (CSV)</button>
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
                        <tr><td>روزهای کارکرد</td><td>{curCalc.workedDays} روز ({fmt(curCalc.workedHours)} ساعت)</td></tr>
                        {(curCalc.paidLeaveDays > 0 || curCalc.paidLeaveHours > 0) && <tr><td>مرخصیِ با حقوق</td><td>{curCalc.paidLeaveDays} روز{curCalc.paidLeaveHours > 0 ? ` + ${curCalc.paidLeaveHours} ساعت` : ''}</td></tr>}
                        {curCalc.unpaidDays > 0 && <tr><td>مرخصیِ بدون حقوق</td><td>{curCalc.unpaidDays} روز</td></tr>}
                        <tr><td>حقوقِ پایه (شاملِ مرخصیِ با حقوق)</td><td>{fmt(curCalc.base)}</td></tr>
                        <tr><td>اضافه‌کار ({fmt(curCalc.ot)} ساعت × ۱.۴)</td><td>{fmt(curCalc.otPay)}</td></tr>
                        {/* Fixed حکم components, itemized */}
                        {payComponents.filter((c) => (curEmp.pay?.[c.id] || 0) > 0).map((c) => (
                          <tr key={c.id}><td>{c.label}</td><td>{c.kind === 'deduction' ? '−' : ''}{fmt(curEmp.pay![c.id])}</td></tr>
                        ))}
                        <tr><td>مزایای متغیر</td><td>{fmt(curCalc.allow)}</td></tr>
                        {curCalc.shortfallPay > 0 && <tr><td>کسرِ کار (تأخیر/تعجیل {(curCalc.shortfallH + curCalc.unpaidHours).toFixed(1)} ساعت)</td><td>−{fmt(curCalc.shortfallPay)}</td></tr>}
                        <tr><td>کسوراتِ دستی</td><td>−{fmt(curCalc.manualDeduct)}</td></tr>
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
                        {/* Fixed monthly salary components (اجزای حکم) that carry an amount */}
                        {payComponents.filter((c) => (curEmp.pay?.[c.id] || 0) > 0).map((c) => (
                          <tr key={c.id}><td>{c.label}{c.kind === 'deduction' ? ' (کسر)' : ''}</td><td>{c.kind === 'deduction' ? '−' : ''}{fmt(curEmp.pay![c.id])}</td></tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  {!selfMode && (
                    <>
                      <div className="att-addgrid acc-noprint">
                        <input className="tool-text-input" type="text" placeholder="سمت / پست" value={curEmp.position || ''} onChange={(e) => updateEmployee(curEmp.id, { position: e.target.value })} />
                        <input className="tool-text-input" type="text" placeholder="تاریخِ استخدام (مثلاً ۱۴۰۲/۰۵/۰۱)" value={curEmp.hire || ''} onChange={(e) => updateEmployee(curEmp.id, { hire: e.target.value })} />
                      </div>
                      <div className="loan-sched-head acc-noprint"><span>اجزای حکم (مزایا/کسوراتِ ماهانه)</span></div>
                      <div className="att-comp-grid acc-noprint">
                        {payComponents.map((c) => (
                          <label key={c.id} className="att-comp-row">
                            <span className={`att-comp-lbl ${c.kind === 'deduction' ? 'ded' : ''}`}>{c.label}</span>
                            <input className="tool-text-input" type="text" inputMode="numeric" dir="ltr" value={(curEmp.pay?.[c.id]) ? withSep(String(curEmp.pay[c.id])) : ''} onChange={(e) => setEmpPay(curEmp.id, c.id, digits(e.target.value))} placeholder="0" />
                            {!c.builtin && <button className="fm-notify" title="حذفِ این جزء از همه" onClick={() => delComponent(c.id)}>🗑</button>}
                          </label>
                        ))}
                      </div>
                      <div className="att-addgrid acc-noprint">
                        <input className="tool-text-input" type="text" placeholder="نامِ جزءِ جدید (مثلاً حق فنی)" value={pcLabel} onChange={(e) => setPcLabel(e.target.value)} />
                        <select className="tool-text-input" value={pcKind} onChange={(e) => setPcKind(e.target.value as 'earning' | 'deduction')}><option value="earning">مزایا (افزاینده)</option><option value="deduction">کسورات (کاهنده)</option></select>
                        <button className="loan-submit" disabled={!pcLabel.trim()} onClick={() => { addComponent(pcLabel, pcKind); setPcLabel(''); }}>افزودنِ جزء</button>
                      </div>
                      <div className="tool-note">این اجزا در همه‌ی حکم‌ها مشترک‌اند؛ مبلغِ هر کارمند جداست و در فیش و حقوقِ ماهانه و حسابداری اعمال می‌شود.</div>
                    </>
                  )}
                  <button className="loan-submit acc-noprint" onClick={() => window.print()}>🖨️ چاپِ حکم / PDF</button>
                </>
              )}
            </>
          ))}

          {/* ---------------- leave management (مرخصی) ---------------- */}
          {tab === 'leave' && (employees.length === 0 ? (
            <div className="tool-note">اول از تبِ «کارمندان» چند نفر اضافه کنید.</div>
          ) : (
            <>
              <div className="att-monthnav">
                <button onClick={() => setY(y - 1)}>‹</button>
                <span>سالِ {y}</span>
                <button onClick={() => setY(y + 1)}>›</button>
              </div>
              {selfMode ? (
                <div className="acc-ledger-name">{curEmp?.name || '—'}</div>
              ) : (
                <select className="tool-text-input" value={empId} onChange={(e) => setEmpId(e.target.value)}>
                  {employees.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
                </select>
              )}

              {/* kardex (کاردکسِ مرخصی) */}
              {curEmp && (() => {
                const k = leaveKardex(curEmp);
                return (
                  <>
                    <div className="acc-print">
                      <div className="acc-print-title">کاردکسِ مرخصی — {curEmp.name} — سالِ {y}</div>
                      <table className="acc-table">
                        <thead><tr><th>استحقاقیِ سال</th><th>ذخیره از قبل</th><th>کسر شده</th><th>در انتظار</th><th>مانده</th></tr></thead>
                        <tbody>
                          <tr>
                            <td>{fmt(policy.annualEntitled)}</td>
                            <td>{fmt(k.carryIn)}</td>
                            <td>{fmt(k.used)}</td>
                            <td>{fmt(k.pending)}</td>
                            <td><strong>{fmt(k.remaining)}</strong></td>
                          </tr>
                        </tbody>
                      </table>
                    </div>
                    <div className="tool-result">
                      <div className="tool-result-row"><span>ملزم به استفاده (حداقل در سال)</span><strong>{fmt(k.mustUse)} روز</strong></div>
                      {k.shortfall > 0 && <div className="tool-result-row"><span>باقی‌مانده‌ی الزامِ استفاده</span><strong style={{ color: '#d9534f' }}>{fmt(k.shortfall)} روز</strong></div>}
                      <div className="tool-result-row closing"><span>قابلِ ذخیره به سالِ بعد</span><strong>{fmt(k.saveable)} روز</strong></div>
                    </div>
                    {!selfMode && (
                      <div className="att-addgrid acc-noprint">
                        <input className="tool-text-input" type="text" inputMode="numeric" dir="ltr" placeholder="ذخیره از سالِ قبل (روز)" value={k.carryIn ? String(k.carryIn) : ''} onChange={(e) => setLeave({ carry: { ...(leave.carry || {}), [empId]: digits(e.target.value) } })} />
                      </div>
                    )}
                  </>
                );
              })()}

              {/* new permit form (ثبتِ مجوز) — two-step combobox: نوعِ مجوز (category) → مجوز (type) */}
              <div className="loan-sched-head"><span>ثبتِ درخواستِ جدید</span></div>
              <div className="att-addgrid">
                <div><label className="field-label">نوعِ مجوز</label>
                  <select className="tool-text-input" value={lkCat} onChange={(e) => { setLkCat(e.target.value); const first = enabledTypes.find((t) => (t.category || 'سایر') === e.target.value); if (first) setLkKind(first.id); }}>
                    {leaveCats.map((c) => <option key={c} value={c}>{c}</option>)}
                  </select>
                </div>
                <div><label className="field-label">مجوز</label>
                  <select className="tool-text-input" value={lkKind} onChange={(e) => setLkKind(e.target.value)}>
                    {typesInCat.map((t) => <option key={t.id} value={t.id}>{t.label}{t.paid ? '' : ' · بدون حقوق'}</option>)}
                  </select>
                </div>
              </div>
              <div className="att-addgrid">
                <input className="tool-text-input" type="text" dir="ltr" placeholder="از تاریخ (۱۴۰۵/۰۳/۱۲)" value={lkFrom} onChange={(e) => setLkFrom(e.target.value)} />
                <input className="tool-text-input" type="text" dir="ltr" placeholder="تا تاریخ" value={lkTo} onChange={(e) => setLkTo(e.target.value)} />
                <input className="tool-text-input" type="text" inputMode="decimal" dir="ltr" placeholder={curType.unit === 'hour' ? 'تعداد ساعت' : 'تعداد روز'} value={lkDays} onChange={(e) => setLkDays(e.target.value.replace(/[^0-9.]/g, ''))} />
              </div>
              {curType.unit === 'hour' && (
                <div className="att-addgrid">
                  <div><label className="field-label">از ساعت</label><input className="tool-text-input" type="time" dir="ltr" value={lkFromTime} onChange={(e) => setLkFromTime(e.target.value)} /></div>
                  <div><label className="field-label">تا ساعت</label><input className="tool-text-input" type="time" dir="ltr" value={lkToTime} onChange={(e) => setLkToTime(e.target.value)} /></div>
                </div>
              )}
              {curType.isMission && (
                <div className="att-addgrid">
                  <input className="tool-text-input" type="text" placeholder="شهرِ مبدا" value={lkOrigin} onChange={(e) => setLkOrigin(e.target.value)} />
                  <input className="tool-text-input" type="text" placeholder="شهرِ مقصد" value={lkDest} onChange={(e) => setLkDest(e.target.value)} />
                  <input className="tool-text-input" type="text" placeholder="موضوع / پروژه" value={lkSubject} onChange={(e) => setLkSubject(e.target.value)} />
                </div>
              )}
              <label className="field-label">جانشین (اختیاری)</label>
              <select className="tool-text-input" value={lkSub} onChange={(e) => setLkSub(e.target.value)}>
                <option value="">— بدون جانشین —</option>
                {employees.filter((e) => e.id !== empId).map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
              </select>
              <input className="tool-text-input" type="text" placeholder={curType.requireReason ? 'شرح / علت (الزامی)' : 'شرح / علت (اختیاری)'} value={lkReason} onChange={(e) => setLkReason(e.target.value)} />
              <button className="loan-submit" disabled={!lkDays || parseFloat(lkDays) <= 0} onClick={submitLeave}>ثبتِ درخواست</button>
              <div className="tool-note">{(() => { const ch = managerChain(empId); return ch.length ? `این درخواست به کارتابلِ «${nameOf(ch[0])}» می‌رود و به‌ترتیب تا «${nameOf(ch[ch.length - 1])}» تایید می‌شود (${ch.length} سطح).` : 'برای این کارمند سرپرستی تعریف نشده؛ درخواست در کارتابلِ مدیرِ ارشد قرار می‌گیرد. سرپرست را در تبِ «کارمندان» مشخص کنید.'; })()}</div>

              {/* permit list (فهرستِ مجوزها) with multi-level approval */}
              <div className="loan-sched-head"><span>مجوزها — سالِ {y}</span></div>
              <div className="loan-detail-list">
                {(leave.requests || []).filter((r) => r.empId === empId && r.year === y).length === 0 && (
                  <div className="tool-note">مجوزی ثبت نشده.</div>
                )}
                {(leave.requests || []).filter((r) => r.empId === empId && r.year === y).map((r) => {
                  const appr = currentApprover(r);
                  const statusText = r.status === 'approved' ? 'تایید شد' : r.status === 'rejected' ? 'رد شد' : `در انتظارِ ${appr ? nameOf(appr) : 'مدیرِ ارشد'}`;
                  const cls = r.status === 'approved' ? 'present' : r.status === 'rejected' ? 'absent' : 'leave';
                  return (
                    <div key={r.id} className="loan-detail-row">
                      <div className="ld-info">
                        <span className="ld-amt">{typeOf(r.kind).label} · {fmt(r.days)} {typeOf(r.kind).unit === 'hour' ? 'ساعت' : 'روز'} <span className={`att-statpill ${cls}`}>{statusText}</span></span>
                        <span className="ld-date">{r.from || '—'}{r.to ? ` تا ${r.to}` : ''}{r.fromTime ? ` · ${r.fromTime}${r.toTime ? `–${r.toTime}` : ''}` : ''}{r.substitute ? ` · جانشین: ${nameOf(r.substitute)}` : ''}{r.mission?.dest ? ` · مقصد: ${r.mission.dest}` : ''}{r.reason ? ` · ${r.reason}` : ''}</span>
                      </div>
                      <div className="att-approw">
                        {!selfMode && r.status === 'pending' && (
                          <>
                            <button className="att-inlinebtn ok" title="تایید" onClick={() => actLeave(r.id, 'approved')}>✔</button>
                            <button className="att-inlinebtn no" title="رد" onClick={() => actLeave(r.id, 'rejected')}>✖</button>
                          </>
                        )}
                        <button className="fm-notify" title="حذف" onClick={() => delLeave(r.id)}>🗑</button>
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* leave policy (قوانینِ ثبتِ مرخصی + سطوحِ تایید) — managers only */}
              {!selfMode && (
                <>
                  <div className="loan-sched-head"><span>قوانینِ مرخصی</span></div>
                  <div className="att-addgrid">
                    <div><label className="field-label">استحقاقیِ سالانه (روز)</label>
                      <input className="tool-text-input" type="text" inputMode="numeric" dir="ltr" value={String(policy.annualEntitled)} onChange={(e) => setPolicy({ annualEntitled: digits(e.target.value) })} /></div>
                    <div><label className="field-label">سقفِ ذخیره‌ی سالیانه</label>
                      <input className="tool-text-input" type="text" inputMode="numeric" dir="ltr" value={String(policy.carryMax)} onChange={(e) => setPolicy({ carryMax: digits(e.target.value) })} /></div>
                    <div><label className="field-label">ملزم به استفاده</label>
                      <input className="tool-text-input" type="text" inputMode="numeric" dir="ltr" value={String(policy.mustUseMin)} onChange={(e) => setPolicy({ mustUseMin: digits(e.target.value) })} /></div>
                  </div>
                  <div className="tool-note">سطوحِ تایید از «سرپرست»‌های تعریف‌شده در تبِ «کارمندان» ساخته می‌شوند: هر درخواست از سرپرستِ کارمند تا بالاترین مدیر بالا می‌رود و در «کارتابل»ِ هر مدیر دیده می‌شود.</div>

                  <div className="loan-sched-head"><span>انواعِ مجوز (قابلِ افزودن)</span><span className="loan-sched-hint">{leaveTypes.length}</span></div>
                  <div className="tool-note">هر نوعِ مجوز را خودتان می‌سازید و رفتارِ حقوقی‌اش را تعیین می‌کنید: «با حقوق/بدون حقوق» در محاسبه‌ی حقوق اثر می‌گذارد و «از مانده» از کاردکسِ استحقاقی کم می‌کند.</div>
                  <div className="att-kindrules">
                    {leaveTypes.map((t) => (
                      <div key={t.id} className="att-kindrow">
                        <input className="tool-text-input att-typename" type="text" value={t.label} onChange={(e) => updateType(t.id, { label: e.target.value })} />
                        <input className="tool-text-input att-typecat" type="text" placeholder="نوعِ مجوز" value={t.category || ''} onChange={(e) => updateType(t.id, { category: e.target.value })} />
                        <select className="tool-text-input att-typesel" value={t.unit} onChange={(e) => updateType(t.id, { unit: e.target.value as 'day' | 'hour' })}>
                          <option value="day">روزانه</option><option value="hour">ساعتی</option>
                        </select>
                        <label className="att-kindopt"><input type="checkbox" checked={t.paid} onChange={(e) => updateType(t.id, { paid: e.target.checked })} /> با حقوق</label>
                        <label className="att-kindopt"><input type="checkbox" checked={t.fromBalance} onChange={(e) => updateType(t.id, { fromBalance: e.target.checked })} /> از مانده</label>
                        <label className="att-kindopt"><input type="checkbox" checked={t.enabled !== false} onChange={(e) => updateType(t.id, { enabled: e.target.checked })} /> فعال</label>
                        <label className="att-kindopt"><input type="checkbox" checked={!!t.requireReason} onChange={(e) => updateType(t.id, { requireReason: e.target.checked })} /> علتِ اجباری</label>
                        {!t.builtin && <button className="fm-notify" title="حذف" onClick={() => delType(t.id)}>🗑</button>}
                      </div>
                    ))}
                  </div>
                  <div className="att-addgrid">
                    <input className="tool-text-input" type="text" placeholder="نامِ نوعِ جدید (مثلاً مرخصیِ تشویقی)" value={ntLabel} onChange={(e) => setNtLabel(e.target.value)} />
                    <input className="tool-text-input" type="text" placeholder="نوعِ مجوز (دسته)" value={ntCat} onChange={(e) => setNtCat(e.target.value)} />
                    <select className="tool-text-input" value={ntUnit} onChange={(e) => setNtUnit(e.target.value as 'day' | 'hour')}><option value="day">روزانه</option><option value="hour">ساعتی</option></select>
                  </div>
                  <div className="att-addgrid">
                    <label className="att-kindopt"><input type="checkbox" checked={ntPaid} onChange={(e) => setNtPaid(e.target.checked)} /> با حقوق</label>
                    <label className="att-kindopt"><input type="checkbox" checked={ntBalance} onChange={(e) => setNtBalance(e.target.checked)} /> از مانده‌ی استحقاقی</label>
                    <button className="loan-submit" disabled={!ntLabel.trim()} onClick={() => { addType(ntLabel, ntUnit, ntPaid, ntBalance, ntCat); setNtLabel(''); setNtCat(''); }}>افزودنِ نوع</button>
                  </div>
                  <button className="acc-addline acc-noprint" onClick={() => downloadCsv(`leave-${y}.csv`, [['کارمند', 'استحقاقی', 'ذخیره', 'کسرشده', 'مانده', 'قابلِ ذخیره'], ...employees.map((e) => { const k = leaveKardex(e); return [e.name, policy.annualEntitled, k.carryIn, k.used, k.remaining, k.saveable]; })])}>📤 خروجیِ اکسلِ کاردکس (CSV)</button>
                </>
              )}
            </>
          ))}

          {/* ---------------- manager inbox (کارتابل) ---------------- */}
          {tab === 'inbox' && (() => {
            // Pending requests routed to the selected manager (or all, for مدیرِ ارشد / admin oversight).
            const pend = (leave.requests || []).filter((r) => {
              if (r.status !== 'pending') return false;
              if (inboxMgr === 'all') return true;          // admin sees every pending request
              return currentApprover(r) === inboxMgr;       // this manager's turn to act
            });
            // History the selected manager already acted on (for traceability).
            const acted = (leave.requests || []).filter((r) => r.status !== 'pending' && r.approvals.some((a) => inboxMgr === 'all' || a.by === nameOf(inboxMgr)));
            return (
              <>
                <div className="fund-help">کارتابلِ مدیران: هر مدیر فقط درخواست‌هایی را می‌بیند که نوبتِ تاییدِ اوست. «سرپرست»ِ هر کارمند در تبِ «کارمندان» تعریف می‌شود.</div>
                <label className="field-label">کارتابلِ مدیر</label>
                <select className="tool-text-input" value={inboxMgr} onChange={(e) => setInboxMgr(e.target.value)}>
                  <option value="all">مدیرِ ارشد (همه‌ی درخواست‌ها)</option>
                  {managerIds.map((mid) => <option key={mid} value={mid}>{nameOf(mid)} ({employees.filter((e) => e.managerId === mid).length} زیرمجموعه)</option>)}
                </select>
                <div className="tool-note">{managerIds.length === 0 ? 'هنوز هیچ سرپرستی تعریف نشده. در تبِ «کارمندان» برای هر فرد یک سرپرست مشخص کنید.' : `${managerIds.length} مدیر تعریف شده است.`}</div>

                <div className="loan-sched-head"><span>در انتظارِ تایید</span><span className="loan-sched-hint">{pend.length}</span></div>
                <div className="loan-detail-list">
                  {pend.length === 0 && <div className="tool-note">درخواستی در انتظارِ این کارتابل نیست.</div>}
                  {pend.map((r) => {
                    const appr = currentApprover(r);
                    return (
                      <div key={r.id} className="loan-detail-row">
                        <div className="ld-info">
                          <span className="ld-amt">{nameOf(r.empId)} · {typeOf(r.kind).label} · {fmt(r.days)} {typeOf(r.kind).unit === 'hour' ? 'ساعت' : 'روز'} <span className="att-statpill leave">در انتظارِ {appr ? nameOf(appr) : 'مدیرِ ارشد'}</span></span>
                          <span className="ld-date">{r.from || '—'}{r.to ? ` تا ${r.to}` : ''}{r.reason ? ` · ${r.reason}` : ''} · سالِ {r.year}</span>
                        </div>
                        <div className="att-approw">
                          <button className="att-inlinebtn ok" title="تایید" onClick={() => actLeave(r.id, 'approved', inboxMgr === 'all' ? (appr || undefined) : inboxMgr)}>✔</button>
                          <button className="att-inlinebtn no" title="رد" onClick={() => actLeave(r.id, 'rejected', inboxMgr === 'all' ? (appr || undefined) : inboxMgr)}>✖</button>
                        </div>
                      </div>
                    );
                  })}
                </div>

                <div className="loan-sched-head"><span>سوابقِ رسیدگی‌شده</span><span className="loan-sched-hint">{acted.length}</span></div>
                <div className="loan-detail-list">
                  {acted.length === 0 && <div className="tool-note">سابقه‌ای نیست.</div>}
                  {acted.slice(0, 30).map((r) => (
                    <div key={r.id} className="loan-detail-row">
                      <div className="ld-info">
                        <span className="ld-amt">{nameOf(r.empId)} · {typeOf(r.kind).label} · {fmt(r.days)} {typeOf(r.kind).unit === 'hour' ? 'ساعت' : 'روز'} <span className={`att-statpill ${r.status === 'approved' ? 'present' : 'absent'}`}>{r.status === 'approved' ? 'تایید شد' : 'رد شد'}</span></span>
                        <span className="ld-date">{r.approvals.map((a) => `${a.by}: ${a.result === 'approved' ? '✔' : '✖'}`).join(' · ')}</span>
                      </div>
                    </div>
                  ))}
                </div>
              </>
            );
          })()}

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

                <div className="loan-sched-head"><span>قوانینِ پیشرفته‌ی کارکرد (محاسبه‌ی حقوق)</span></div>
                <div className="att-addgrid">
                  <div><label className="field-label">ارفاقِ تأخیرِ صبح (دقیقه)</label>
                    <input className="tool-text-input" type="text" inputMode="numeric" dir="ltr" value={String(rules.graceLateMin || 0)} onChange={(e) => setRules({ graceLateMin: digits(e.target.value) })} placeholder="مثلاً 10" /></div>
                  <div><label className="field-label">دفعاتِ مجازِ تأخیر در ماه</label>
                    <input className="tool-text-input" type="text" inputMode="numeric" dir="ltr" value={String(rules.lateAllowPerMonth || 0)} onChange={(e) => setRules({ lateAllowPerMonth: digits(e.target.value) })} placeholder="مثلاً 3" /></div>
                </div>
                <div className="tool-note">تأخیرِ کمتر از «ارفاق» جریمه ندارد؛ علاوه بر آن، «دفعاتِ مجاز» تأخیرِ کم‌اثرِ ماه بخشیده می‌شود و کسرِ کار نمی‌خورد.</div>
                <div className="att-addgrid">
                  <div><label className="field-label">حداقلِ اضافه‌کار (دقیقه)</label>
                    <input className="tool-text-input" type="text" inputMode="numeric" dir="ltr" value={String(rules.otMinMin || 0)} onChange={(e) => setRules({ otMinMin: digits(e.target.value) })} placeholder="مثلاً 30" /></div>
                </div>
                <div className="tool-note">ماندنِ کمتر از این مقدار پس از پایانِ کار، اضافه‌کار حساب نمی‌شود.</div>
                <div className="att-addgrid">
                  <div><label className="field-label">استراحتِ صبحانه (دقیقه)</label>
                    <input className="tool-text-input" type="text" inputMode="numeric" dir="ltr" value={String(rules.breakfastMin || 0)} onChange={(e) => setRules({ breakfastMin: digits(e.target.value) })} placeholder="مثلاً 15" /></div>
                  <div><label className="field-label">استراحتِ ناهار (دقیقه)</label>
                    <input className="tool-text-input" type="text" inputMode="numeric" dir="ltr" value={String(rules.lunchMin || 0)} onChange={(e) => setRules({ lunchMin: digits(e.target.value) })} placeholder="مثلاً 45" /></div>
                </div>
                <div className="tool-note">زمانِ استراحت (صبحانه و ناهار) بدونِ حقوق است و از کارکردِ روزانه کسر می‌شود؛ نتیجه مستقیم در حقوق و سندِ حسابداریِ حقوق اعمال می‌شود.</div>

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
                  <div key={e.id} className="loan-detail-row att-emprow">
                    <div className="ld-info">
                      <span className="ld-amt">{e.name} {e.code ? <span className="fm-shares">#{e.code}</span> : null}{employees.some((x) => x.managerId === e.id) ? <span className="att-statpill present">مدیر</span> : null}</span>
                      <span className="ld-date">{e.dailyRate ? `روزانه ${fmt(e.dailyRate)}` : ''}{e.hourlyRate ? ` · ساعتی ${fmt(e.hourlyRate)}` : ''}</span>
                      {/* Assign the employee's سرپرست (manager) — this builds the approval hierarchy / کارتابل routing. */}
                      <select className="tool-text-input att-mgrsel" value={e.managerId || ''} onChange={(ev) => updateEmployee(e.id, { managerId: ev.target.value || undefined })}>
                        <option value="">سرپرست: ندارد</option>
                        {employees.filter((m) => m.id !== e.id).map((m) => <option key={m.id} value={m.id}>سرپرست: {m.name}</option>)}
                      </select>
                    </div>
                    <button className="att-inlinebtn" title="کارتِ ساعت‌زنی" onClick={() => setBadgeEmp(e)}>🪪</button>
                    <button className="fm-notify" title="حذف" onClick={() => delEmployee(e.id)}>🗑</button>
                  </div>
                ))}
              </div>
              <div className="tool-note">با تعیینِ «سرپرست» برای هر فرد، سلسله‌مراتبِ تایید ساخته می‌شود: درخواست‌ها از سرپرست تا بالاترین مدیر در «کارتابلِ» هر مدیر بالا می‌روند. هر کس زیرمجموعه داشته باشد، «مدیر» محسوب می‌شود. با 🪪 کارتِ بارکدیِ ساعت‌زنیِ هر نفر را چاپ کنید.</div>

              {/* printable badge card for kiosk punching */}
              {badgeEmp && (
                <div className="inv-label-wrap">
                  <div className="inv-label acc-print">
                    <div className="inv-label-name">{badgeEmp.name}</div>
                    <div className="inv-label-sub">{badgeEmp.position || 'کارتِ ساعت‌زنی'}{badgeEmp.code ? ` · #${badgeEmp.code}` : ''}</div>
                    <Barcode value={empBadge(badgeEmp)} />
                    <div className="inv-label-code">{empBadge(badgeEmp)}</div>
                  </div>
                  <button className="loan-submit acc-noprint" onClick={() => window.print()}>🖨️ چاپِ کارت</button>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
