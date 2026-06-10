import { useState, useEffect, useRef } from 'react';
import './App.css';
import { LocalNotifications } from '@capacitor/local-notifications';
import { Share } from '@capacitor/share';
import { StatusBar, Style } from '@capacitor/status-bar';
import { App as CapApp } from '@capacitor/app';
import { Capacitor } from '@capacitor/core';
import {
  type CalendarSystem,
  CALENDAR_SYSTEMS,
  SYSTEM_LABELS,
  weekDays,
  getMonthNames,
  getToday,
  getMonthDays,
  getFirstWeekdayOffset,
  isToday,
  dateKey,
  shiftMonth,
  convertMonth,
  convertAll,
  toDate,
  fromDate,
  yearRange,
  migrateKey,
} from './calendar';

import logoUrl from './assets/logo.png';
import ToolsPanel, { CalendarDateInput, type DateValue } from './Tools';
import WelcomeScreen from './WelcomeScreen';
import { Onboarding, WhatsNew } from './Onboarding';
import FundPanel from './Fund';
import AccountingPanel, { type AccountingState, type AccType, emptyAccounting } from './Accounting';
import AttendancePanel, { type AttendanceState, emptyAttendance } from './Attendance';
import InventoryPanel, { type InventoryState, emptyInventory } from './Inventory';
import AccessPanel, { type AccessState, emptyAccess } from './Access';
import CoachTour, { type CoachStep } from './Coach';
import {
  IconReport, IconBom, IconLoan, IconConvert, IconAge, IconBio, IconBmi,
  IconToday, IconUsers, IconShare, IconGlobe, IconMenu, IconInfo,
} from './icons';
import { PROVINCES } from './cities';
import PrayerPanel from './PrayerPanel';

interface Transaction {
  id: string;
  title: string;
  amount: number;
  isPaid: boolean;
  reminderDateTime?: string; // ذخیره زمان یادآوری
  reminderScheduled?: boolean;
  loanId?: string; // اتصال قسط به وام
}

interface DayData {
  transactions: Transaction[];
}

// متادیتای هر وام (نام و مشخصات)
interface LoanMeta {
  id: string;
  name: string;
  type: 'gharz' | 'azad' | 'manual';
  principal: number;
  total: number;
  count: number;
}

// صندوقِ سهم‌محور (قرض‌الحسنه گردشی)
interface FundMember { name: string; phone?: string; shares: number; }
interface FundRound {
  paid: { [member: string]: boolean };
  winners: string[]; // برندگانِ هر ماه (یک نام می‌تواند چند بار باشد، به‌اندازه‌ی سهم)
  pay?: number;      // مبلغِ پرداخت به هر برنده در آن ماه (گِرد)
}
interface Fund {
  id: string;
  name: string;
  monthlyAmount: number;   // واریزی به ازای هر سهم در ماه
  payoutsPerMonth: number; // تعداد پرداختی در هر ماه
  members: FundMember[];
  rounds: FundRound[];
  carry?: number;          // خرده‌ی جمع‌شده‌ی نزدِ صاحبِ صندوق
  roundLevel?: 'off' | 'low' | 'mid' | 'high'; // شدتِ گِرد کردنِ پرداخت‌ها
}

// مهاجرتِ صندوق‌های قدیمی (اعضای رشته‌ای، برنده‌ی تکی) به مدلِ سهم‌محور
function normalizeFund(f: any): Fund {
  const phones = f.phones || {};
  const members: FundMember[] = Array.isArray(f.members)
    ? f.members.map((m: any) => (typeof m === 'string' ? { name: m, shares: 1, phone: phones[m] } : { name: m.name, shares: m.shares || 1, phone: m.phone }))
    : [];
  const rounds: FundRound[] = (f.rounds && f.rounds.length ? f.rounds : [{ paid: {}, winners: [] }]).map((r: any) => ({
    paid: r.paid || {},
    winners: Array.isArray(r.winners) ? r.winners : (r.winner ? [r.winner] : []),
    pay: typeof r.pay === 'number' ? r.pay : undefined,
  }));
  // مهاجرتِ صندوق‌های قدیمی: تنظیماتِ روندِ قبلی → شدتِ ساده‌ی جدید
  const level: Fund['roundLevel'] = (['off', 'low', 'mid', 'high'].includes(f.roundLevel))
    ? f.roundLevel
    : (f.autoRound === false || f.autoRound === undefined ? 'off' : 'low');
  return { id: f.id, name: f.name, monthlyAmount: f.monthlyAmount, payoutsPerMonth: f.payoutsPerMonth || 1, members, rounds, carry: typeof f.carry === 'number' ? f.carry : 0, roundLevel: level };
}

// تابع فرمت عدد با جداکننده سه‌رقمی
const formatNumber = (num: number): string => {
  return num.toLocaleString('en-US');
};

// خلاصه‌ی مبلغ برای خانه‌ی کوچکِ تقویم (که «نصفه» نشود): میلیارد → میلیارد، میلیون → م، هزار → هـ
const compactAmount = (num: number): string => {
  const n = Math.round(num || 0);
  if (n >= 1_000_000_000) { const v = n / 1_000_000_000; return `${(n % 1_000_000_000 === 0 ? v : +v.toFixed(1)).toLocaleString('en-US')}میلیارد`; }
  if (n >= 1_000_000) { const v = n / 1_000_000; return `${(n % 1_000_000 === 0 ? v : +v.toFixed(1)).toLocaleString('en-US')}م`; }
  if (n >= 1_000) { const v = n / 1_000; return `${(n % 1_000 === 0 ? v : +v.toFixed(0)).toLocaleString('en-US')}هـ`; }
  return n.toLocaleString('en-US');
};

// تابع تبدیل رشته با جداکننده به عدد
const parseFormattedNumber = (str: string): number => {
  const cleaned = str.replace(/,/g, '');
  return parseFloat(cleaned);
};

const SYSTEM_STORAGE_KEY = 'calendarSystem';

// مراحلِ راهنمای تصویری (هایلایتِ عناصرِ واقعیِ صفحه)
const TOUR_STEPS: CoachStep[] = [
  { selector: '.icon-btn[aria-label="امکانات"]', title: 'منوی امکانات', text: 'از این دکمه به وام، صندوق خانوادگی، گزارش‌ها و ابزارها می‌رسید. می‌توانید انگشت را هم از لبه به داخل بکشید.' },
  { selector: '.calendar-toggle', title: 'سه تقویم', text: 'بین تقویمِ شمسی، میلادی و قمری جابه‌جا شوید؛ تاریخِ امروز در هر سه نمایش داده می‌شود.' },
  { selector: '.month-nav', title: 'جابه‌جایی ماه', text: 'با این دکمه‌ها ماهِ قبل/بعد را ببینید یا روی نام ماه بزنید و مستقیم انتخاب کنید.' },
  { selector: '.calendar', title: 'ثبت روی روزها', text: 'روی هر روز بزنید تا بدهی یا قسط ثبت کنید. نگه‌داشتنِ انگشت، خلاصه‌ی بدهیِ آن روز را نشان می‌دهد.' },
  { selector: '.month-summary', title: 'ترازِ مالی', text: 'مانده بدهی، تسویه‌شده و گردشِ کلِ این ماه را یک‌جا می‌بینید.' },
  { selector: '.icon-btn[aria-label="درباره ما"]', title: 'درباره و پوسته', text: 'درباره‌ی ما، تغییر پوسته (روشن/تیره) و همین راهنما از این منو در دسترس است.' },
];

// نسخه و فهرستِ تغییرات برای پنجره‌ی «تازه‌ها»
// Resolve an account id for an auto-posted journal line.
// If `name` is given: find by (type+name) else CREATE that named account (never fall back to a
// different account of the same type — that previously caused e.g. COGS to credit Cash).
// If `name` is omitted: use the first account of that type, else create a default.
type AccLite = { id: string; code: string; name: string; type: AccType };
function resolveAcc(accs: AccLite[], defName: { [k in AccType]: string }, t: AccType, name?: string): string {
  if (name) {
    let a = accs.find((x) => x.type === t && x.name === name);
    if (!a) { a = { id: `a-${t}-${Date.now()}-${accs.length}`, code: '', name, type: t }; accs.push(a); }
    return a.id;
  }
  let a = accs.find((x) => x.type === t);
  if (!a) { a = { id: `a-${t}-${Date.now()}-${accs.length}`, code: '', name: defName[t], type: t }; accs.push(a); }
  return a.id;
}

const APP_VERSION = '1.0.47';
const CHANGELOG: string[] = [
  'ادمین می‌تواند سطحِ دسترسیِ گروه‌ها را ویرایش کند: روی گروه بزنید، دسترسی‌ها را کم/زیاد کنید و نامش را عوض کنید',
  'نقشه‌ی راه به‌روز شد: تطبیقِ دستگاه‌های چهره/اثرانگشت/کارت، اولویتِ SaaS، و گرافیکِ مدرنِ ۲۰۲۶ با محیط‌های مجزا',
];

function App() {
  const [calendarSystem, setCalendarSystem] = useState<CalendarSystem>(() => {
    const saved = localStorage.getItem(SYSTEM_STORAGE_KEY) as CalendarSystem | null;
    return saved && CALENDAR_SYSTEMS.includes(saved) ? saved : 'jalali';
  });
  const months = getMonthNames(calendarSystem);
  const years = yearRange(calendarSystem);

  const [currentYear, setCurrentYear] = useState<number>(() => getToday(calendarSystem).year);
  const [currentMonth, setCurrentMonth] = useState<number>(() => getToday(calendarSystem).month);
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [selectedDayNum, setSelectedDayNum] = useState<number | null>(null);
  const [showDayModal, setShowDayModal] = useState<boolean>(false);
  const [showAddModal, setShowAddModal] = useState<boolean>(false);
  const [showPrayerModal, setShowPrayerModal] = useState<boolean>(false);
  const [showToolsModal, setShowToolsModal] = useState<boolean>(false);
  const [showYearMonthModal, setShowYearMonthModal] = useState<boolean>(false);
  const [showReminderModal, setShowReminderModal] = useState<boolean>(false);
  const [title, setTitle] = useState<string>('');
  const [amount, setAmount] = useState<string>('');
  const [calendarData, setCalendarData] = useState<{ [key: string]: DayData }>({});
  const [loans, setLoans] = useState<LoanMeta[]>(() => { try { return JSON.parse(localStorage.getItem('loans') || '[]'); } catch { return []; } });
  const [funds, setFunds] = useState<Fund[]>(() => { try { return (JSON.parse(localStorage.getItem('funds') || '[]')).map(normalizeFund); } catch { return []; } });
  const [showLoansModal, setShowLoansModal] = useState<boolean>(false);
  const [selectedLoanId, setSelectedLoanId] = useState<string | null>(null);
  const [showFundModal, setShowFundModal] = useState<boolean>(false);
  const [showAccModal, setShowAccModal] = useState<boolean>(false);
  const [accounting, setAccounting] = useState<AccountingState>(() => { try { const s = localStorage.getItem('accounting'); return s ? JSON.parse(s) : emptyAccounting(); } catch { return emptyAccounting(); } });
  const saveAccounting = (s: AccountingState) => { localStorage.setItem('accounting', JSON.stringify(s)); setAccounting(s); };
  // Auto-post an accounting journal entry from other modules (payroll / fund / loan).
  // Upsert semantics: if an entry with the same `ref` exists, it is updated; otherwise created.
  // Each spec line resolves to an account by (type [+ optional name]); a missing account is auto-created.
  const postJournal = (ref: string, date: { y: number; m: number; d: number }, desc: string, spec: { type: AccType; name?: string; debit?: number; credit?: number }[]) => {
    const defName: { [k in AccType]: string } = { asset: 'صندوق (نقد)', liability: 'حساب‌های پرداختنی', equity: 'سرمایه', income: 'درآمد', expense: 'هزینه‌ها' };
    const accs = accounting.accounts.slice();
    const lines = spec.map((l) => ({ accountId: resolveAcc(accs, defName, l.type, l.name), debit: l.debit || 0, credit: l.credit || 0 }));
    const exists = accounting.entries.some((e) => e.ref === ref);
    const entries = exists
      ? accounting.entries.map((e) => (e.ref === ref ? { ...e, y: date.y, m: date.m, d: date.d, desc, lines } : e))
      : [...accounting.entries, { id: `je-${Date.now()}`, ref, y: date.y, m: date.m, d: date.d, desc, lines }];
    saveAccounting({ accounts: accs, entries });
    notify(exists ? 'سندِ حسابداری به‌روزرسانی شد ✅' : 'سندِ حسابداری ثبت شد ✅ (در منوی «حسابداری»)');
  };
  // Silent variant for modules that auto-post on every change (no toast) — used by inventory.
  const upsertJournal = (ref: string, date: { y: number; m: number; d: number }, desc: string, spec: { type: AccType; name?: string; debit?: number; credit?: number }[]) => {
    const defName: { [k in AccType]: string } = { asset: 'صندوق (نقد)', liability: 'حساب‌های پرداختنی', equity: 'سرمایه', income: 'درآمد', expense: 'هزینه‌ها' };
    const accs = accounting.accounts.slice();
    const lines = spec.filter((l) => (l.debit || 0) || (l.credit || 0)).map((l) => ({ accountId: resolveAcc(accs, defName, l.type, l.name), debit: l.debit || 0, credit: l.credit || 0 }));
    const exists = accounting.entries.some((e) => e.ref === ref);
    const entries = exists
      ? accounting.entries.map((e) => (e.ref === ref ? { ...e, y: date.y, m: date.m, d: date.d, desc, lines } : e))
      : [...accounting.entries, { id: `je-${Date.now()}`, ref, y: date.y, m: date.m, d: date.d, desc, lines }];
    saveAccounting({ accounts: accs, entries });
  };
  // Remove an auto-posted entry by ref (e.g. when its source inventory transaction is deleted).
  const removeJournal = (ref: string) => {
    if (!accounting.entries.some((e) => e.ref === ref)) return;
    saveAccounting({ accounts: accounting.accounts, entries: accounting.entries.filter((e) => e.ref !== ref) });
  };
  const [showAttModal, setShowAttModal] = useState<boolean>(false);
  const [attendance, setAttendance] = useState<AttendanceState>(() => { try { const s = localStorage.getItem('attendance'); return s ? JSON.parse(s) : emptyAttendance(); } catch { return emptyAttendance(); } });
  const saveAttendance = (s: AttendanceState) => { localStorage.setItem('attendance', JSON.stringify(s)); setAttendance(s); };
  const [showInvModal, setShowInvModal] = useState<boolean>(false);
  const [inventory, setInventory] = useState<InventoryState>(() => { try { const s = localStorage.getItem('inventory'); return s ? JSON.parse(s) : emptyInventory(); } catch { return emptyInventory(); } });
  const saveInventory = (s: InventoryState) => { localStorage.setItem('inventory', JSON.stringify(s)); setInventory(s); };
  const [showAccessModal, setShowAccessModal] = useState<boolean>(false);
  const [access, setAccess] = useState<AccessState>(() => { try { const s = localStorage.getItem('access'); return s ? JSON.parse(s) : emptyAccess(); } catch { return emptyAccess(); } });
  const saveAccess = (s: AccessState) => { localStorage.setItem('access', JSON.stringify(s)); setAccess(s); };
  // Active-user role gating (device-side). When disabled, everything is allowed.
  const activeUser = access.activeUserId ? access.users.find((u) => u.id === access.activeUserId) : null;
  const activeGroup = activeUser ? access.groups.find((g) => g.id === activeUser.groupId) : null;
  const can = (key: string) => !access.enabled || !activeUser || !!activeGroup?.perms.includes(key);
  // Worker self-service mode: active user only has personal attendance and is linked to an employee.
  const selfMode = !!(access.enabled && activeUser && activeGroup && !activeGroup.perms.includes('attendance') && activeGroup.perms.includes('attendance_self'));
  const selfEmpId = selfMode ? activeUser?.empId : undefined;
  const [fundStartReport, setFundStartReport] = useState<boolean>(false);
  const [theme, setTheme] = useState<'light' | 'dark'>(() => (localStorage.getItem('theme') as 'light' | 'dark') || 'light');
  const [prayerProvince, setPrayerProvince] = useState<string>(() => localStorage.getItem('prayerProvince') || 'تهران');
  const [prayerCity, setPrayerCity] = useState<string>(() => localStorage.getItem('prayerCity') || 'تهران');
  const [tempYear, setTempYear] = useState<number>(currentYear);
  const [tempMonth, setTempMonth] = useState<number>(currentMonth);
  const [reminderText, setReminderText] = useState<string>('');
  const [reminderDateValue, setReminderDateValue] = useState<DateValue>(() => {
    const t = getToday(calendarSystem);
    return { system: calendarSystem, year: t.year, month: t.month, day: t.day };
  });
  const [reminderTime, setReminderTime] = useState<string>('09:00');
  const [selectedTransactionForReminder, setSelectedTransactionForReminder] = useState<{ dateKey: string; transactionId: string } | null>(null);
  const [notificationPermission, setNotificationPermission] = useState<boolean>(false);
  const [showOnboarding, setShowOnboarding] = useState<boolean>(() => !localStorage.getItem('onboardedVersion'));
  const [showWhatsNew, setShowWhatsNew] = useState<boolean>(() => {
    const onboarded = localStorage.getItem('onboardedVersion');
    return !!onboarded && localStorage.getItem('lastSeenVersion') !== APP_VERSION;
  });
  const [showWelcome, setShowWelcome] = useState<boolean>(() => !!localStorage.getItem('onboardedVersion'));
  const [showRightDrawer, setShowRightDrawer] = useState<boolean>(false);
  const [showLeftDrawer, setShowLeftDrawer] = useState<boolean>(false);
  const [showAboutModal, setShowAboutModal] = useState<boolean>(false);
  const [toolsInitialSection, setToolsInitialSection] = useState<string>('report');
  const [editingTxId, setEditingTxId] = useState<string | null>(null);
  const [dayPreview, setDayPreview] = useState<{ x: number; y: number; day: number } | null>(null);
  const [dialog, setDialog] = useState<{ type: 'alert' | 'confirm'; message: string; onYes?: () => void } | null>(null);
  const [exitHint, setExitHint] = useState<boolean>(false);
  const [showTour, setShowTour] = useState<boolean>(false);
  const touchStart = useRef<{ x: number; y: number } | null>(null);
  const longPressTimer = useRef<number | null>(null);
  const suppressClick = useRef<boolean>(false);
  const lastBack = useRef<number>(0);
  const restoreInputRef = useRef<HTMLInputElement | null>(null);

  // دیالوگ‌های سفارشی به‌جای alert/confirm زشتِ سیستم
  const notify = (message: string) => setDialog({ type: 'alert', message });
  const askConfirm = (message: string, onYes: () => void) => setDialog({ type: 'confirm', message, onYes });

  // درخواست مجوز نوتیفیکیشن در شروع برنامه
  useEffect(() => {
    const requestNotificationPermission = async () => {
      try {
        const { display } = await LocalNotifications.requestPermissions();
        if (display === 'granted') {
          setNotificationPermission(true);
          console.log('✅ مجوز نوتیفیکیشن دریافت شد');
        }
      } catch (error) {
        console.log('❌ خطا در دریافت مجوز:', error);
      }
    };
    requestNotificationPermission();
  }, []);

  useEffect(() => {
    const saved = localStorage.getItem('calendarData');
    if (!saved) return;
    const parsed = JSON.parse(saved) as { [key: string]: DayData };
    // مهاجرت کلیدهای قدیمیِ شمسی به کلید میلادیِ مشترک بین تقویم‌ها
    const migrated: { [key: string]: DayData } = {};
    let changed = false;
    Object.entries(parsed).forEach(([key, value]) => {
      const newKey = migrateKey(key);
      if (newKey !== key) changed = true;
      migrated[newKey] = value;
    });
    setCalendarData(migrated);
    if (changed) localStorage.setItem('calendarData', JSON.stringify(migrated));
  }, []);

  // اعمال و ذخیره‌ی پوسته (روشن/تیره)
  useEffect(() => {
    document.body.classList.toggle('dark', theme === 'dark');
    localStorage.setItem('theme', theme);
  }, [theme]);

  // نوار وضعیتِ گوشی روی هدرِ سرمه‌ای می‌افتد (بدون نوار سفید)، با آیکون‌های روشن
  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return;
    StatusBar.setOverlaysWebView({ overlay: true }).catch(() => {});
    StatusBar.setStyle({ style: Style.Dark }).catch(() => {});
  }, []);

  // دکمه‌ی برگشتِ اندروید: ابتدا پنجره‌ی باز را می‌بندد، در نهایت با دوبار زدن خارج می‌شود
  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return;
    const closers: [boolean, () => void][] = [
      [showTour, () => { setShowTour(false); localStorage.setItem('tourSeen', '1'); }],
      [!!dialog, () => setDialog(null)],
      [showAddModal, () => { setShowAddModal(false); setEditingTxId(null); }],
      [showReminderModal, () => setShowReminderModal(false)],
      [showPrayerModal, () => setShowPrayerModal(false)],
      [showToolsModal, () => setShowToolsModal(false)],
      [!!selectedLoanId, () => setSelectedLoanId(null)],
      [showLoansModal, () => setShowLoansModal(false)],
      [showFundModal, () => setShowFundModal(false)],
      [showAccModal, () => setShowAccModal(false)],
      [showAttModal, () => setShowAttModal(false)],
      [showInvModal, () => setShowInvModal(false)],
      [showAccessModal, () => setShowAccessModal(false)],
      [showAboutModal, () => setShowAboutModal(false)],
      [showYearMonthModal, () => setShowYearMonthModal(false)],
      [showDayModal, () => setShowDayModal(false)],
      [showRightDrawer, () => setShowRightDrawer(false)],
      [showLeftDrawer, () => setShowLeftDrawer(false)],
      [showWhatsNew, () => setShowWhatsNew(false)],
      [showOnboarding, () => setShowOnboarding(false)],
    ];
    const sub = CapApp.addListener('backButton', () => {
      const open = closers.find(([isOpen]) => isOpen);
      if (open) { open[1](); return; }
      const now = Date.now();
      if (now - lastBack.current < 2000) { CapApp.exitApp(); }
      else { lastBack.current = now; setExitHint(true); setTimeout(() => setExitHint(false), 2000); }
    });
    return () => { sub.then((h) => h.remove()); };
  }, [showTour, dialog, showAddModal, showReminderModal, showPrayerModal, showToolsModal, selectedLoanId, showLoansModal, showFundModal, showAccModal, showAttModal, showInvModal, showAccessModal, showAboutModal, showYearMonthModal, showDayModal, showRightDrawer, showLeftDrawer, showWhatsNew, showOnboarding]);

  // هنگام تغییر تقویم، انتخابِ نظام را ذخیره و ماهِ در حال نمایش را تبدیل می‌کنیم
  const switchCalendar = (system: CalendarSystem) => {
    if (system === calendarSystem) return;
    const converted = convertMonth(calendarSystem, system, currentYear, currentMonth);
    setCalendarSystem(system);
    setCurrentYear(converted.year);
    setCurrentMonth(converted.month);
    localStorage.setItem(SYSTEM_STORAGE_KEY, system);
  };

  const saveData = (data: any) => {
    localStorage.setItem('calendarData', JSON.stringify(data));
    setCalendarData(data);
  };

  // درج خودکار اقساط وام روی تاریخ سررسید هر قسط در تقویم (با اتصال به وام)
  const addInstallments = (entries: { key: string; title: string; amount: number }[], loanId?: string) => {
    const next: { [key: string]: DayData } = { ...calendarData };
    entries.forEach(({ key, title, amount }, idx) => {
      const existing = next[key]?.transactions || [];
      const tx: Transaction = {
        id: `${Date.now()}-${idx}-${Math.random().toString(36).slice(2, 7)}`,
        title,
        amount,
        isPaid: false,
        loanId,
      };
      next[key] = { transactions: [...existing, tx] };
    });
    saveData(next);
  };

  // ساخت یک وامِ نام‌دار به همراه اقساطش
  const createLoan = (meta: Omit<LoanMeta, 'id'>, entries: { key: string; title: string; amount: number }[]) => {
    const id = `loan-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const list = [...loans, { ...meta, id }];
    localStorage.setItem('loans', JSON.stringify(list));
    setLoans(list);
    addInstallments(entries, id);
  };

  const deleteLoan = (id: string) => {
    askConfirm('این وام و همه‌ی اقساطش حذف شود؟', () => {
      // حذف اقساطِ متصل به این وام از تقویم
      const next: { [key: string]: DayData } = {};
      Object.entries(calendarData).forEach(([key, day]) => {
        const kept = day.transactions.filter((t) => t.loanId !== id);
        if (kept.length) next[key] = { transactions: kept };
      });
      saveData(next);
      const list = loans.filter((l) => l.id !== id);
      localStorage.setItem('loans', JSON.stringify(list));
      setLoans(list);
      setSelectedLoanId(null);
    });
  };

  // جمع‌بندیِ وضعیتِ یک وام از روی اقساطِ موجود در تقویم
  const loanInstallments = (id: string): { key: string; tx: Transaction }[] => {
    const out: { key: string; tx: Transaction }[] = [];
    Object.entries(calendarData).forEach(([key, day]) => {
      day.transactions.forEach((t) => { if (t.loanId === id) out.push({ key, tx: t }); });
    });
    return out.sort((a, b) => {
      const [ay, am, ad] = a.key.split('-').map(Number);
      const [by, bm, bd] = b.key.split('-').map(Number);
      return new Date(ay, am - 1, ad).getTime() - new Date(by, bm - 1, bd).getTime();
    });
  };

  const saveFunds = (f: Fund[]) => { localStorage.setItem('funds', JSON.stringify(f)); setFunds(f); };

  // ثبتِ واریزی‌های ماهانه‌ی صندوق به‌عنوان یادآور در تقویمِ کاربر
  const addFundDeposits = (fundName: string, amount: number, count: number) => {
    const t = getToday(calendarSystem);
    const entries: { key: string; title: string; amount: number }[] = [];
    for (let k = 0; k < count; k++) {
      const sh = shiftMonth(calendarSystem, t.year, t.month, k);
      const md = getMonthDays(calendarSystem, sh.year, sh.month);
      const day = Math.min(t.day, md);
      entries.push({ key: dateKey(calendarSystem, sh.year, sh.month, day), title: `واریزی صندوق ${fundName}`, amount });
    }
    addInstallments(entries);
    notify(`${count} واریزی در تقویم ثبت شد`);
  };

  // باز کردن یادآوری برای یک تراکنشِ موجود (قسط/وام)
  const openReminderFor = (dKey: string, tx: Transaction) => {
    setSelectedTransactionForReminder({ dateKey: dKey, transactionId: tx.id });
    setReminderText(tx.title);
    const [gy, gm, gd] = dKey.split('-').map(Number);
    setReminderDateValue({ system: calendarSystem, ...fromDate(calendarSystem, new Date(gy, (gm || 1) - 1, gd || 1)) });
    setReminderTime('09:00');
    setShowReminderModal(true);
  };

  // تنظیمِ تاریخِ یادآوری بر اساس «چند روز قبل از سررسید»
  const setReminderOffset = (daysBefore: number) => {
    if (!selectedTransactionForReminder) return;
    const [gy, gm, gd] = selectedTransactionForReminder.dateKey.split('-').map(Number);
    const d = new Date(gy, (gm || 1) - 1, gd || 1);
    d.setDate(d.getDate() - daysBefore);
    setReminderDateValue({ system: calendarSystem, ...fromDate(calendarSystem, d) });
  };

  // تغییر وضعیتِ پرداختِ یک تراکنش با کلیدِ مشخص
  const togglePaidByKey = (dKey: string, id: string) => {
    const day = calendarData[dKey];
    if (!day) return;
    const updated = day.transactions.map(t => t.id === id ? { ...t, isPaid: !t.isPaid } : t);
    saveData({ ...calendarData, [dKey]: { transactions: updated } });
  };

  const getKey = (y: number, m: number, d: number): string => dateKey(calendarSystem, y, m, d);

  const getDayTransactions = (y: number, m: number, d: number): Transaction[] => {
    const day = calendarData[getKey(y, m, d)];
    return day?.transactions || [];
  };

  const getDayDebt = (y: number, m: number, d: number): number => {
    return getDayTransactions(y, m, d)
      .filter(t => !t.isPaid)
      .reduce((s, t) => s + t.amount, 0);
  };

  const getDayTotalTransactions = (y: number, m: number, d: number): number => {
    return getDayTransactions(y, m, d).reduce((s, t) => s + t.amount, 0);
  };

  const getDayPaid = (y: number, m: number, d: number): number => {
    return getDayTransactions(y, m, d)
      .filter(t => t.isPaid)
      .reduce((s, t) => s + t.amount, 0);
  };

  // جمع‌های ماه
  const getMonthTotal = (): number => {
    let total = 0;
    const days = getMonthDays(calendarSystem, currentYear, currentMonth);
    for (let d = 1; d <= days; d++) {
      total += getDayTotalTransactions(currentYear, currentMonth, d);
    }
    return total;
  };

  const getMonthRemaining = (): number => {
    let remaining = 0;
    const days = getMonthDays(calendarSystem, currentYear, currentMonth);
    for (let d = 1; d <= days; d++) {
      remaining += getDayDebt(currentYear, currentMonth, d);
    }
    return remaining;
  };

  const getMonthPaid = (): number => {
    let paid = 0;
    const days = getMonthDays(calendarSystem, currentYear, currentMonth);
    for (let d = 1; d <= days; d++) {
      paid += getDayPaid(currentYear, currentMonth, d);
    }
    return paid;
  };

  // تابع ثبت یادآوری
  const scheduleReminder = async (transaction: Transaction) => {
    if (!notificationPermission) {
      notify('لطفاً مجوز نوتیفیکیشن را فعال کنید');
      return false;
    }

    if (!transaction.reminderDateTime) return false;

    const reminderDateTime = new Date(transaction.reminderDateTime);
    const now = new Date();

    if (reminderDateTime <= now) {
      notify('زمان یادآوری باید در آینده باشد');
      return false;
    }

    try {
      await LocalNotifications.schedule({
        notifications: [
          {
            title: '📌 یادآوری قسط',
            body: `${transaction.title} - مبلغ: ${formatNumber(transaction.amount)} تومان`,
            id: parseInt(transaction.id) % 1000000,
            schedule: { at: reminderDateTime, allowWhileIdle: true },
            sound: null,
            attachments: null,
            actionTypeId: '',
            extra: null
          }
        ]
      });
      console.log('✅ یادآوری با موفقیت ثبت شد');
      return true;
    } catch (error) {
      console.log('❌ خطا در ثبت یادآوری:', error);
      return false;
    }
  };

  // شروع ویرایش یک تراکنش (مثلاً مبلغ یک قسط در همان ماه)
  const startEdit = (t: Transaction) => {
    setEditingTxId(t.id);
    setTitle(t.title);
    setAmount(t.amount.toLocaleString('en-US'));
    setShowDayModal(false);
    setShowAddModal(true);
  };

  // افزودن یا ویرایش تراکنش
  const addTransaction = async () => {
    if (!title.trim()) { notify('عنوان را وارد کنید'); return; }
    const amt = parseFormattedNumber(amount);
    if (isNaN(amt) || amt <= 0) { notify('مبلغ معتبر وارد کنید'); return; }
    if (!selectedDate) return;

    const existing = calendarData[selectedDate] || { transactions: [] };

    // حالت ویرایش: همان تراکنش را به‌روزرسانی می‌کنیم
    if (editingTxId) {
      const updatedTx = existing.transactions.map(t =>
        t.id === editingTxId ? { ...t, title, amount: amt } : t
      );
      saveData({ ...calendarData, [selectedDate]: { transactions: updatedTx } });
      setEditingTxId(null);
      setTitle('');
      setAmount('');
      setShowAddModal(false);
      setShowDayModal(true);
      return;
    }

    const newTransaction: Transaction = {
      id: Date.now().toString(),
      title,
      amount: amt,
      isPaid: false,
      reminderScheduled: false
    };
    const updated = { transactions: [...existing.transactions, newTransaction] };
    saveData({ ...calendarData, [selectedDate]: updated });

    setTitle('');
    setAmount('');
    setShowAddModal(false);

    // پرسش برای ثبت یادآوری (دیالوگ سفارشی)
    const dateForReminder = selectedDate;
    askConfirm('آیا می‌خواهید برای این قسط یادآوری ثبت کنید؟', () => {
      setSelectedTransactionForReminder({ dateKey: dateForReminder, transactionId: newTransaction.id });
      setReminderText(newTransaction.title);
      const [gy, gm, gd] = dateForReminder.split('-').map(Number);
      setReminderDateValue({ system: calendarSystem, ...fromDate(calendarSystem, new Date(gy, (gm || 1) - 1, gd || 1)) });
      setShowReminderModal(true);
    });
  };

  // باز کردن یک ابزار از منوی امکانات
  const openTool = (section: string) => {
    setToolsInitialSection(section);
    setShowRightDrawer(false);
    setShowToolsModal(true);
  };

  // اشتراک‌گذاری نرم‌افزار (شیت اشتراک‌گذاری بومی، با fallback وب)
  const shareApp = async () => {
    setShowLeftDrawer(false);
    const data = {
      title: 'simorgh-ledger',
      text: 'دفترکل و تقویم هوشمند سیمرغ — شمسی، میلادی و قمری',
      url: 'https://www.simorghai.com',
      dialogTitle: 'اشتراک‌گذاری simorgh-ledger',
    };
    try {
      await Share.share(data);
    } catch {
      try {
        if (navigator.share) await navigator.share(data);
        else {
          await navigator.clipboard?.writeText('simorgh-ledger\nwww.simorghai.com');
          notify('لینک نرم‌افزار کپی شد:\nwww.simorghai.com');
        }
      } catch { /* کاربر منصرف شد */ }
    }
  };

  // ---------- پشتیبان‌گیری و بازیابی ----------
  // کلیدهایی که در فایلِ پشتیبان ذخیره می‌شوند (داده‌ها + تنظیمات)
  const BACKUP_KEYS = ['calendarData', 'funds', 'loans', 'accounting', 'attendance', 'inventory', 'access', 'calendarSystem', 'theme', 'prayerProvince', 'prayerCity'];
  const [ghRepo, setGhRepo] = useState<string>(() => localStorage.getItem('ghBackupRepo') || '');
  const [ghToken, setGhToken] = useState<string>(() => localStorage.getItem('ghBackupToken') || '');
  // حساب کاربری و همگام‌سازیِ ابری (سرورِ خودمان)
  const API_BASE = localStorage.getItem('apiBase') || 'https://ledger.simorghai.com';
  const [authToken, setAuthToken] = useState<string>(() => localStorage.getItem('authToken') || '');
  const [authPhone, setAuthPhone] = useState<string>(() => localStorage.getItem('authPhone') || '');
  const [acctPhone, setAcctPhone] = useState<string>('');
  const [acctPw, setAcctPw] = useState<string>('');

  // ساختِ متنِ پشتیبان از داده‌های فعلی
  const buildBackup = (): string => {
    const payload: { [k: string]: string } = {};
    BACKUP_KEYS.forEach((k) => { const v = localStorage.getItem(k); if (v !== null) payload[k] = v; });
    return JSON.stringify({ app: 'simorgh-ledger', version: APP_VERSION, date: new Date().toISOString(), data: payload }, null, 2);
  };
  // اعمالِ داده‌ی پشتیبان روی حافظه و بازگشاییِ برنامه
  const applyBackup = (data: any) => {
    if (!data || typeof data !== 'object' || (!data.calendarData && !data.funds && !data.loans)) { notify('فایل پشتیبانِ معتبری نیست.'); return; }
    askConfirm('بازیابیِ پشتیبان جایگزینِ داده‌های فعلی می‌شود. ادامه می‌دهید؟', () => {
      BACKUP_KEYS.forEach((k) => { if (typeof data[k] === 'string') localStorage.setItem(k, data[k]); });
      notify('پشتیبان بازیابی شد. برنامه دوباره باز می‌شود…');
      setTimeout(() => window.location.reload(), 900);
    });
  };
  // کدگذاری/کدگشاییِ base64 با پشتیبانی از فارسی (UTF-8)
  const utf8ToB64 = (s: string): string => btoa(unescape(encodeURIComponent(s)));
  const b64ToUtf8 = (b: string): string => decodeURIComponent(escape(atob(b.replace(/\n/g, ''))));

  const exportBackup = () => {
    const blob = new Blob([buildBackup()], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    const stamp = new Date().toISOString().slice(0, 10);
    a.href = url; a.download = `simorgh-backup-${stamp}.json`;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    setShowLeftDrawer(false);
    notify('پشتیبان ساخته شد. فایلِ «simorgh-backup» را جایی امن نگه دارید. 🗂️');
  };

  // فاز ۱: ارسالِ مستقیمِ فایلِ پشتیبان به پیام‌رسان‌ها (بله/ایتا/تلگرام/…)
  const shareBackup = async () => {
    const stamp = new Date().toISOString().slice(0, 10);
    try {
      const file = new File([buildBackup()], `simorgh-backup-${stamp}.json`, { type: 'application/json' });
      const nav: any = navigator;
      if (nav.canShare && nav.canShare({ files: [file] })) {
        await nav.share({ files: [file], title: 'پشتیبانِ simorgh-ledger', text: 'فایلِ پشتیبانِ simorgh-ledger' });
        setShowLeftDrawer(false);
        return;
      }
    } catch { /* کاربر منصرف شد یا پشتیبانی نمی‌شود */ }
    exportBackup(); // اگر اشتراکِ فایل ممکن نبود، دانلود می‌کنیم تا از فایل‌منیجر بفرستد
  };

  const onRestoreFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = ''; // اجازه‌ی انتخابِ دوباره‌ی همان فایل
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const parsed = JSON.parse(String(reader.result || '{}'));
        applyBackup(parsed && parsed.data);
      } catch {
        notify('خواندنِ فایل ناموفق بود؛ فایلِ پشتیبانِ درست را انتخاب کنید.');
      }
    };
    reader.readAsText(file);
  };

  // فاز ۲: همگام‌سازی با گیت‌هاب (آپلود/بازیابیِ فایلِ پشتیبان در ریپوی خصوصی)
  const ghHeaders = (token: string) => ({ Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json' });
  const ghSaveCreds = (repo: string, token: string) => { localStorage.setItem('ghBackupRepo', repo); localStorage.setItem('ghBackupToken', token); };
  const ghUpload = async () => {
    const repo = ghRepo.trim(), token = ghToken.trim();
    if (!repo.includes('/') || !token) { notify('آدرسِ ریپو (مثلِ user/backup) و توکن را وارد کنید.'); return; }
    const url = `https://api.github.com/repos/${repo}/contents/simorgh-backup.json`;
    notify('در حالِ آپلود به گیت‌هاب…');
    try {
      let sha: string | undefined;
      const g = await fetch(url, { headers: ghHeaders(token) });
      if (g.ok) { const j = await g.json(); sha = j.sha; }
      const body: any = { message: `backup ${new Date().toISOString()}`, content: utf8ToB64(buildBackup()) };
      if (sha) body.sha = sha;
      const r = await fetch(url, { method: 'PUT', headers: { ...ghHeaders(token), 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      if (r.ok) { ghSaveCreds(repo, token); notify('پشتیبان در گیت‌هاب ذخیره شد ✅'); }
      else if (r.status === 401 || r.status === 403) notify('توکن نامعتبر است یا دسترسیِ Contents ندارد.');
      else if (r.status === 404) notify('ریپو پیدا نشد؛ آدرس را درست وارد کنید (user/repo).');
      else notify('خطا در آپلود به گیت‌هاب (کد ' + r.status + ').');
    } catch { notify('اتصال به گیت‌هاب برقرار نشد (احتمالاً فیلتر/اینترنت). با VPN امتحان کنید.'); }
  };
  const ghRestore = async () => {
    const repo = ghRepo.trim(), token = ghToken.trim();
    if (!repo.includes('/') || !token) { notify('آدرسِ ریپو و توکن را وارد کنید.'); return; }
    const url = `https://api.github.com/repos/${repo}/contents/simorgh-backup.json`;
    notify('در حالِ دریافت از گیت‌هاب…');
    try {
      const g = await fetch(url, { headers: ghHeaders(token) });
      if (!g.ok) { notify(g.status === 404 ? 'هنوز پشتیبانی در گیت‌هاب نیست.' : 'دریافت ناموفق بود (کد ' + g.status + ').'); return; }
      const j = await g.json();
      const parsed = JSON.parse(b64ToUtf8(j.content || ''));
      ghSaveCreds(repo, token);
      applyBackup(parsed && parsed.data);
    } catch { notify('اتصال به گیت‌هاب برقرار نشد (احتمالاً فیلتر/اینترنت). با VPN امتحان کنید.'); }
  };

  // ---------- حساب کاربری و همگام‌سازی با سرورِ خودمان ----------
  const backupDataObject = (): { [k: string]: string } => {
    const o: { [k: string]: string } = {};
    BACKUP_KEYS.forEach((k) => { const v = localStorage.getItem(k); if (v !== null) o[k] = v; });
    return o;
  };
  const saveAuth = (token: string, phone: string) => {
    localStorage.setItem('authToken', token); localStorage.setItem('authPhone', phone);
    setAuthToken(token); setAuthPhone(phone);
  };
  const apiAuth = async (kind: 'login' | 'register') => {
    const phone = acctPhone.trim(), password = acctPw;
    if (phone.replace(/[^0-9+]/g, '').length < 8 || password.length < 4) { notify('شماره‌موبایل و رمز (حداقل ۴ کاراکتر) را درست وارد کنید.'); return; }
    try {
      const r = await fetch(`${API_BASE}/api/${kind}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ phone, password }) });
      const j = await r.json().catch(() => ({}));
      if (r.ok && j.token) { saveAuth(j.token, j.phone || phone); setAcctPw(''); notify(kind === 'register' ? 'حساب ساخته شد و وارد شدید ✅' : 'خوش آمدید ✅'); }
      else if (r.status === 409) notify('این شماره قبلاً ثبت شده؛ «ورود» را بزنید.');
      else if (r.status === 401) notify('شماره یا رمز درست نیست.');
      else notify('خطا (کد ' + r.status + ').');
    } catch { notify('اتصال به سرور برقرار نشد. اینترنت/آدرسِ سرور را بررسی کنید.'); }
  };
  const apiLogout = () => { localStorage.removeItem('authToken'); localStorage.removeItem('authPhone'); setAuthToken(''); setAuthPhone(''); };
  const cloudPush = async () => {
    if (!authToken) return;
    notify('در حالِ ارسال به سرور…');
    try {
      const r = await fetch(`${API_BASE}/api/data`, { method: 'PUT', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${authToken}` }, body: JSON.stringify({ blob: backupDataObject() }) });
      if (r.ok) notify('داده‌ها روی سرور ذخیره شد ✅');
      else if (r.status === 401) { notify('نشستِ شما منقضی شده؛ دوباره وارد شوید.'); apiLogout(); }
      else notify('ارسال ناموفق بود (کد ' + r.status + ').');
    } catch { notify('اتصال به سرور برقرار نشد.'); }
  };
  const cloudPull = async () => {
    if (!authToken) return;
    notify('در حالِ دریافت از سرور…');
    try {
      const r = await fetch(`${API_BASE}/api/data`, { headers: { Authorization: `Bearer ${authToken}` } });
      if (r.status === 401) { notify('نشستِ شما منقضی شده؛ دوباره وارد شوید.'); apiLogout(); return; }
      if (!r.ok) { notify('دریافت ناموفق بود (کد ' + r.status + ').'); return; }
      const j = await r.json();
      if (!j.blob) { notify('هنوز داده‌ای روی سرور نیست؛ اول «ارسال» را بزنید.'); return; }
      applyBackup(j.blob);
    } catch { notify('اتصال به سرور برقرار نشد.'); }
  };

  // اشتراک‌گذاریِ یک متنِ دلخواه (برای پیامِ یادآوریِ صندوق)
  const shareText = async (text: string) => {
    try {
      await Share.share({ text, dialogTitle: 'اشتراک‌گذاری پیام' });
    } catch {
      try {
        if (navigator.share) await navigator.share({ text });
        else { await navigator.clipboard?.writeText(text); notify('پیام کپی شد؛ در گروه بفرستید'); }
      } catch { /* منصرف شد */ }
    }
  };

  // تایید یادآوری
  const confirmReminder = async () => {
    if (!selectedTransactionForReminder || !reminderTime) {
      notify('لطفاً تاریخ و ساعت را انتخاب کنید');
      return;
    }

    // تاریخِ انتخاب‌شده (در هر تقویمی) را به زمانِ واقعی تبدیل می‌کنیم
    const base = toDate(reminderDateValue.system, reminderDateValue.year, reminderDateValue.month, reminderDateValue.day);
    const [hh, mm] = reminderTime.split(':').map(Number);
    base.setHours(hh || 0, mm || 0, 0, 0);
    const reminderDateTime = base.toISOString();
    const transaction = calendarData[selectedTransactionForReminder.dateKey]?.transactions.find(
      t => t.id === selectedTransactionForReminder.transactionId
    );

    if (transaction) {
      const updatedTransaction = { ...transaction, reminderDateTime, reminderScheduled: true };
      const dayData = calendarData[selectedTransactionForReminder.dateKey];
      const updatedTransactions = dayData.transactions.map(t => 
        t.id === selectedTransactionForReminder.transactionId ? updatedTransaction : t
      );
      const updatedDay = { transactions: updatedTransactions };
      saveData({ ...calendarData, [selectedTransactionForReminder.dateKey]: updatedDay });

      await scheduleReminder(updatedTransaction);
      notify('✅ یادآوری با موفقیت ثبت شد');
    }
    setShowReminderModal(false);
    setSelectedTransactionForReminder(null);
    setReminderText('');
    setReminderTime('09:00');
  };

  const togglePay = (dateKey: string, id: string) => {
    const day = calendarData[dateKey];
    if (!day) return;
    const updated = day.transactions.map(t => t.id === id ? { ...t, isPaid: !t.isPaid } : t);
    saveData({ ...calendarData, [dateKey]: { transactions: updated } });
  };

  const deleteTrans = (dateKey: string, id: string) => {
    askConfirm('این تراکنش حذف شود؟', () => {
      const day = calendarData[dateKey];
      if (!day) return;
      const filtered = day.transactions.filter(t => t.id !== id);
      const newData = { ...calendarData };
      if (filtered.length === 0) delete newData[dateKey];
      else newData[dateKey] = { transactions: filtered };
      saveData(newData);
    });
  };

  const openDayDetails = (year: number, month: number, day: number) => {
    if (suppressClick.current) { suppressClick.current = false; return; }
    setDayPreview(null);
    const dateKey = getKey(year, month, day);
    setSelectedDate(dateKey);
    setSelectedDayNum(day);
    setShowDayModal(true);
  };

  // پیش‌نمایشِ بدهی‌های روز هنگام هاور (دسکتاپ) یا نگه‌داشتنِ انگشت (موبایل)
  const showDayPreview = (el: HTMLElement, day: number) => {
    if (getDayTransactions(currentYear, currentMonth, day).length === 0) return;
    const r = el.getBoundingClientRect();
    setDayPreview({ x: r.left + r.width / 2, y: r.top, day });
  };
  const hideDayPreview = () => setDayPreview(null);
  const startLongPress = (el: HTMLElement, day: number) => {
    clearLongPress();
    longPressTimer.current = window.setTimeout(() => {
      suppressClick.current = true;
      showDayPreview(el, day);
    }, 420);
  };
  const clearLongPress = () => {
    if (longPressTimer.current) { clearTimeout(longPressTimer.current); longPressTimer.current = null; }
  };

  const openPrayerTimes = () => {
    setShowPrayerModal(true);
  };

  // انتخاب شهر برای اوقات شرعی (با ذخیره)
  const changePrayerProvince = (province: string) => {
    const first = PROVINCES.find((p) => p.name === province)?.cities[0]?.name || '';
    setPrayerProvince(province);
    setPrayerCity(first);
    localStorage.setItem('prayerProvince', province);
    localStorage.setItem('prayerCity', first);
  };
  const changePrayerCity = (city: string) => {
    setPrayerCity(city);
    localStorage.setItem('prayerCity', city);
  };

  const changeYearMonth = () => {
    setCurrentYear(tempYear);
    setCurrentMonth(tempMonth);
    setShowYearMonthModal(false);
  };

  const goToToday = () => {
    const today = getToday(calendarSystem);
    setCurrentYear(today.year);
    setCurrentMonth(today.month);
    setShowDayModal(false);
    setShowAddModal(false);
    setShowPrayerModal(false);
    setShowToolsModal(false);
    setShowYearMonthModal(false);
    setSelectedDate(null);
    setSelectedDayNum(null);
  };

  // هندلر تغییر مبلغ با جداکننده سه‌رقمی
  const handleAmountChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    let value = e.target.value;
    // حذف همه کاراکترهای غیرعددی
    const numericValue = value.replace(/[^0-9]/g, '');
    if (numericValue === '') {
      setAmount('');
      return;
    }
    // تبدیل به عدد و فرمت با جداکننده
    const number = parseInt(numericValue, 10);
    setAmount(number.toLocaleString('en-US'));
  };

  const renderDays = () => {
    const days: React.ReactNode[] = [];
    const daysInMonth = getMonthDays(calendarSystem, currentYear, currentMonth);
    const startOffset = getFirstWeekdayOffset(calendarSystem, currentYear, currentMonth);

    for (let i = 0; i < startOffset; i++) {
      days.push(<div key={`e-${i}`} className="day empty"></div>);
    }

    for (let d = 1; d <= daysInMonth; d++) {
      const debt = getDayDebt(currentYear, currentMonth, d);
      const dayIsToday = isToday(calendarSystem, currentYear, currentMonth, d);
      const isFriday = (startOffset + d - 1) % 7 === 6;

      days.push(
        <div
          key={d}
          className={`day ${debt > 0 ? 'has-debt' : ''} ${dayIsToday ? 'today' : ''} ${isFriday ? 'friday' : ''}`}
          onClick={() => openDayDetails(currentYear, currentMonth, d)}
          onMouseEnter={(e) => showDayPreview(e.currentTarget, d)}
          onMouseLeave={hideDayPreview}
          onTouchStart={(e) => startLongPress(e.currentTarget, d)}
          onTouchEnd={() => { clearLongPress(); hideDayPreview(); }}
          onTouchMove={() => { clearLongPress(); hideDayPreview(); }}
        >
          <span className="day-num">{d}</span>
          {debt > 0 && (
            <span className="debt-badge" title={`${formatNumber(debt)} تومان`}>
              {compactAmount(debt)}
            </span>
          )}
        </div>
      );
    }
    return days;
  };

  const selectedDayData = selectedDate ? calendarData[selectedDate] : null;
  const selectedDayDebt = selectedDate && selectedDayNum ?
    getDayDebt(currentYear, currentMonth, selectedDayNum) : 0;

  // اطلاعات امروز در هر سه تقویم برای بنر بالای صفحه
  const todayG = getToday('gregorian');
  const today3 = convertAll('gregorian', todayG.year, todayG.month, todayG.day);
  const fmtDate = (sys: CalendarSystem, c: { year: number; month: number; day: number }) =>
    `${c.day} ${getMonthNames(sys)[c.month]} ${c.year}`;
  const todayBySystem: Record<CalendarSystem, { year: number; month: number; day: number }> = {
    jalali: today3.jalali,
    gregorian: today3.gregorian,
    hijri: today3.hijri,
  };
  const otherSystems = CALENDAR_SYSTEMS.filter((s) => s !== calendarSystem);

  // باز کردن منوها با کشیدنِ انگشت (راست → منوی راست، چپ → منوی چپ)
  const anyOverlayOpen = showWelcome || showRightDrawer || showLeftDrawer || showToolsModal ||
    showDayModal || showAddModal || showPrayerModal || showYearMonthModal || showReminderModal || showAboutModal;
  const onTouchStart = (e: React.TouchEvent) => {
    const t = e.touches[0];
    touchStart.current = { x: t.clientX, y: t.clientY };
  };
  const onTouchEnd = (e: React.TouchEvent) => {
    if (!touchStart.current || anyOverlayOpen) { touchStart.current = null; return; }
    const t = e.changedTouches[0];
    const dx = t.clientX - touchStart.current.x;
    const dy = t.clientY - touchStart.current.y;
    touchStart.current = null;
    if (Math.abs(dx) > 70 && Math.abs(dx) > Math.abs(dy) * 1.8) {
      if (dx > 0) setShowLeftDrawer(true);
      else setShowRightDrawer(true);
    }
  };

  return (
    <div className="app" onTouchStart={onTouchStart} onTouchEnd={onTouchEnd}>
      {showWelcome && <WelcomeScreen onDone={() => setShowWelcome(false)} />}
      {showOnboarding && (
        <Onboarding onDone={() => {
          localStorage.setItem('onboardedVersion', APP_VERSION);
          localStorage.setItem('lastSeenVersion', APP_VERSION);
          setShowOnboarding(false);
          // راهنمای تصویریِ اختیاری، یک‌بار پس از معرفی
          if (!localStorage.getItem('tourSeen')) setTimeout(() => setShowTour(true), 500);
        }} />
      )}
      {showTour && (
        <CoachTour steps={TOUR_STEPS} onClose={() => { setShowTour(false); localStorage.setItem('tourSeen', '1'); }} />
      )}
      {showWhatsNew && (
        <WhatsNew
          version={APP_VERSION}
          items={CHANGELOG}
          onClose={() => { localStorage.setItem('lastSeenVersion', APP_VERSION); setShowWhatsNew(false); }}
        />
      )}

      <div className="header">
        <button className="icon-btn" onClick={() => setShowRightDrawer(true)} aria-label="امکانات"><IconMenu /></button>
        <h1 className="brand">
          <img className="brand-logo" src={logoUrl} alt="simorgh-ledger" />
          <span className="brand-name">simorgh-ledger</span>
        </h1>
        <button className="icon-btn" onClick={() => setShowLeftDrawer(true)} aria-label="درباره ما"><IconInfo /></button>
      </div>

      {/* بنر امروز با هر سه تقویم */}
      <div className="date-banner">
        <button className="today-pill" onClick={goToToday}>برو به امروز</button>
        <div className="db-weekday">{today3.weekday}</div>
        <div className="db-primary">{fmtDate(calendarSystem, todayBySystem[calendarSystem])}</div>
        <div className="db-secondary">
          {otherSystems.map((s) => (
            <span key={s}>{SYSTEM_LABELS[s]}: {fmtDate(s, todayBySystem[s])}</span>
          ))}
        </div>
      </div>

      {/* سوییچ سه‌وضعیتی تقویم: شمسی / میلادی / قمری */}
      <div className="calendar-toggle">
        {CALENDAR_SYSTEMS.map((system) => (
          <button
            key={system}
            className={`calendar-toggle-btn ${calendarSystem === system ? 'active' : ''}`}
            onClick={() => switchCalendar(system)}
          >
            {SYSTEM_LABELS[system]}
          </button>
        ))}
      </div>

      <div className="month-nav">
        <button onClick={() => {
          const p = shiftMonth(calendarSystem, currentYear, currentMonth, -1);
          setCurrentYear(p.year);
          setCurrentMonth(p.month);
        }}>◀</button>
        <div className="month-year-selector" onClick={() => {
          setTempYear(currentYear);
          setTempMonth(currentMonth);
          setShowYearMonthModal(true);
        }}>
          <span>{months[currentMonth]}</span>
          <span className="year-text">{currentYear}</span>
          <span className="dropdown-icon">▼</span>
        </div>
        <button onClick={() => {
          const n = shiftMonth(calendarSystem, currentYear, currentMonth, 1);
          setCurrentYear(n.year);
          setCurrentMonth(n.month);
        }}>▶</button>
      </div>

      <div className="weekdays">
        {weekDays.map((d: string, i: number) => (
          <div key={d} className={`weekday ${i === 6 ? 'friday' : ''}`}>{d}</div>
        ))}
      </div>

      <div className="calendar">
        {renderDays()}
      </div>

      {/* پیش‌نمایشِ بدهی‌های روز (هاور/نگه‌داشتن) */}
      {dayPreview && (() => {
        const items = getDayTransactions(currentYear, currentMonth, dayPreview.day);
        const debt = getDayDebt(currentYear, currentMonth, dayPreview.day);
        return (
          <div className="day-preview" style={{ left: Math.min(Math.max(dayPreview.x, 128), window.innerWidth - 128), top: dayPreview.y }}>
            <div className="dp-title">{dayPreview.day} {months[currentMonth]}</div>
            {items.map((t) => (
              <div key={t.id} className={`dp-row ${t.isPaid ? 'paid' : ''}`}>
                <span className={`dp-dot ${t.isPaid ? 'paid' : 'debt'}`} />
                <span className="dp-name">{t.title}</span>
                <span className="dp-amount">{formatNumber(t.amount)}</span>
              </div>
            ))}
            <div className="dp-foot">
              <span>مانده بدهی</span>
              <strong>{formatNumber(debt)} تومان</strong>
            </div>
          </div>
        );
      })()}

      {/* تراز مالیِ ماه */}
      <div className="month-summary">
        <div className="ms-title">ترازِ مالیِ {months[currentMonth]} {currentYear}</div>
        <div className="ms-cols">
          <div className="ms-col">
            <span className="ms-dot debt" />
            <span className="ms-label">مانده بدهی</span>
            <strong className="ms-value debt">{formatNumber(getMonthRemaining())}</strong>
          </div>
          <div className="ms-col">
            <span className="ms-dot paid" />
            <span className="ms-label">تسویه‌شده</span>
            <strong className="ms-value paid">{formatNumber(getMonthPaid())}</strong>
          </div>
          <div className="ms-col">
            <span className="ms-dot total" />
            <span className="ms-label">گردش ماه</span>
            <strong className="ms-value total">{formatNumber(getMonthTotal())}</strong>
          </div>
        </div>
        <div className="ms-unit">مبالغ به تومان</div>
      </div>

      <footer className="app-footer">
        <div className="footer-content">
          <div className="footer-text-fa">
            ساخته شده توسط <strong>سیمرغ فناوری هوشمند ایرانیان</strong>
          </div>
          <div className="footer-text-en">
            Made by <strong>Simorgh Intelligent Iranian Technology</strong>
          </div>
          <div className="footer-copyright">
            © 2026 Simorgh AI | 
            <a href="https://www.simorghai.com" target="_blank" rel="noopener noreferrer">
              www.simorghai.com
            </a>
          </div>
        </div>
      </footer>

      {/* مودال‌ها... (بقیه مودال‌ها به همین صورت می‌مانند) */}

      {showYearMonthModal && (
        <div className="modal" onClick={() => setShowYearMonthModal(false)}>
          <div className="modal-box select-modal" onClick={e => e.stopPropagation()}>
            <h3>انتخاب سال و ماه</h3>
            <div className="select-row">
              <select value={tempYear} onChange={e => setTempYear(parseInt(e.target.value))}>
                {years.map((y: number) => (
                  <option key={y} value={y}>{y}</option>
                ))}
              </select>
              <select value={tempMonth} onChange={e => setTempMonth(parseInt(e.target.value))}>
                {months.map((m: string, idx: number) => (
                  <option key={idx} value={idx}>{m}</option>
                ))}
              </select>
            </div>
            <div className="modal-btns">
              <button className="submit" onClick={changeYearMonth}>تایید</button>
              <button className="cancel" onClick={() => setShowYearMonthModal(false)}>انصراف</button>
            </div>
          </div>
        </div>
      )}

      {showDayModal && selectedDate && selectedDayNum && (
        <div className="modal" onClick={() => setShowDayModal(false)}>
          <div className="modal-box day-modal" onClick={e => e.stopPropagation()}>
            <div className="tool-panel-head">
              <span className="tool-panel-icon"><IconBom /></span>
              <h3>{selectedDayNum} {months[currentMonth]} {currentYear}</h3>
              <button className="close-modal" onClick={() => setShowDayModal(false)}>✕</button>
            </div>

            <div className="day-modal-body">
            <div className="day-debt-summary">
              <span>مجموع بدهی این روز</span>
              <strong>{formatNumber(selectedDayDebt)} تومان</strong>
            </div>

            <div className="modal-buttons-row">
              <button className="add-trans-btn" onClick={() => {
                setShowDayModal(false);
                setShowAddModal(true);
              }}>
                + افزودن تراکنش
              </button>
              <button className="prayer-btn-modal" onClick={() => {
                openPrayerTimes();
              }}>
                🕌 اوقات شرعی
              </button>
            </div>

            <div className="transactions-list-modal">
              {!selectedDayData?.transactions.length ? (
                <div className="empty-trans">هیچ تراکنشی ثبت نشده است</div>
              ) : (
                selectedDayData.transactions.map((t: Transaction) => (
                  <div key={t.id} className={`trans-item-modal ${t.isPaid ? 'paid' : ''}`}>
                    <div className="trans-info-modal">
                      <span className="trans-title-modal">{t.title}</span>
                      <span className="trans-amount-modal">{formatNumber(t.amount)} تومان</span>
                      {t.reminderDateTime && <span className="reminder-badge">⏰</span>}
                    </div>
                    <div className="trans-actions-modal">
                      <button className="pay-tick-modal" onClick={() => togglePay(selectedDate, t.id)}>
                        {t.isPaid ? '✓ پرداخت شده' : '○ پرداخت نشده'}
                      </button>
                      <button className="edit-trans-modal" onClick={() => startEdit(t)} title="ویرایش مبلغ">
                        ✏️
                      </button>
                      <button className="delete-trans-modal" onClick={() => deleteTrans(selectedDate, t.id)}>
                        🗑
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>
            </div>
          </div>
        </div>
      )}

      {showAddModal && (
        <div className="modal" onClick={() => { setShowAddModal(false); setEditingTxId(null); }}>
          <div className="modal-box add-modal" onClick={e => e.stopPropagation()}>
            <div className="tool-panel-head">
              <span className="tool-panel-icon"><IconLoan /></span>
              <h3>{editingTxId ? 'ویرایش تراکنش' : 'افزودن تراکنش'}</h3>
              <button className="close-modal" onClick={() => { setShowAddModal(false); setEditingTxId(null); if (editingTxId) setShowDayModal(true); }}>✕</button>
            </div>
            <div className="add-modal-body">
            <input
              type="text"
              placeholder="عنوان (مثال: قبوض آب و برق)"
              value={title}
              onChange={e => setTitle(e.target.value)}
            />
            <input
              type="text"
              placeholder="مبلغ (تومان)"
              value={amount}
              onChange={handleAmountChange}
              dir="ltr"
              style={{ textAlign: 'right' }}
            />
            <div className="modal-btns">
              <button className="submit" onClick={addTransaction}>{editingTxId ? 'ذخیره' : 'ثبت'}</button>
              <button className="cancel" onClick={() => { setShowAddModal(false); setEditingTxId(null); if (editingTxId) setShowDayModal(true); }}>انصراف</button>
            </div>
            </div>
          </div>
        </div>
      )}

      {showPrayerModal && (
        <PrayerPanel
          province={prayerProvince}
          city={prayerCity}
          onProvinceChange={changePrayerProvince}
          onCityChange={changePrayerCity}
          onClose={() => setShowPrayerModal(false)}
        />
      )}

      {showToolsModal && (
        <ToolsPanel
          calendarData={calendarData}
          currentSystem={calendarSystem}
          currentYear={currentYear}
          currentMonth={currentMonth}
          onClose={() => setShowToolsModal(false)}
          onAddTransactions={addInstallments}
          onCreateLoan={createLoan}
          section={toolsInitialSection}
        />
      )}

      {/* وام‌های من: فهرست */}
      {showLoansModal && !selectedLoanId && (
        <div className="modal" onClick={() => setShowLoansModal(false)}>
          <div className="modal-box tool-panel" onClick={e => e.stopPropagation()}>
            <div className="tool-panel-head">
              <span className="tool-panel-icon"><IconLoan /></span>
              <h3>وام‌های من</h3>
              <button className="close-modal" onClick={() => setShowLoansModal(false)}>✕</button>
            </div>
            <div className="tool-panel-body">
              {loans.length === 0 ? (
                <div className="tool-note" style={{ marginTop: 16 }}>هنوز وامی ثبت نکرده‌اید. از «وام جدید» بسازید.</div>
              ) : (
                loans.map((ln) => {
                  const items = loanInstallments(ln.id);
                  const paid = items.filter(i => i.tx.isPaid).reduce((s, i) => s + i.tx.amount, 0);
                  const remaining = items.filter(i => !i.tx.isPaid).reduce((s, i) => s + i.tx.amount, 0);
                  const paidCount = items.filter(i => i.tx.isPaid).length;
                  const pct = items.length ? Math.round((paidCount / items.length) * 100) : 0;
                  return (
                    <button key={ln.id} className="loan-card" onClick={() => setSelectedLoanId(ln.id)}>
                      <div className="loan-card-top">
                        <span className="loan-card-name">{ln.name}</span>
                        <span className="loan-card-count">{paidCount}/{items.length} قسط</span>
                      </div>
                      <div className="loan-card-bar"><span style={{ width: `${pct}%` }} /></div>
                      <div className="loan-card-row"><span>مانده</span><strong className="lc-debt">{formatNumber(remaining)} تومان</strong></div>
                      <div className="loan-card-row"><span>پرداخت‌شده</span><strong className="lc-paid">{formatNumber(paid)} تومان</strong></div>
                    </button>
                  );
                })
              )}
            </div>
          </div>
        </div>
      )}

      {/* وام‌های من: جزئیاتِ یک وام */}
      {showLoansModal && selectedLoanId && (() => {
        const ln = loans.find(l => l.id === selectedLoanId);
        if (!ln) return null;
        const items = loanInstallments(ln.id);
        const paid = items.filter(i => i.tx.isPaid).reduce((s, i) => s + i.tx.amount, 0);
        const remaining = items.filter(i => !i.tx.isPaid).reduce((s, i) => s + i.tx.amount, 0);
        return (
          <div className="modal" onClick={() => setShowLoansModal(false)}>
            <div className="modal-box tool-panel" onClick={e => e.stopPropagation()}>
              <div className="tool-panel-head">
                <button className="close-modal" onClick={() => setSelectedLoanId(null)}>‹</button>
                <h3>{ln.name}</h3>
                <button className="close-modal" onClick={() => setShowLoansModal(false)}>✕</button>
              </div>
              <div className="tool-panel-body">
                <div className="tool-result">
                  <div className="tool-result-row"><span>مجموع وام</span><strong>{formatNumber(ln.total)} تومان</strong></div>
                  <div className="tool-result-row paid"><span>پرداخت‌شده</span><strong>{formatNumber(paid)} تومان</strong></div>
                  <div className="tool-result-row closing"><span>ماندهٔ کل وام</span><strong>{formatNumber(remaining)} تومان</strong></div>
                </div>
                <div className="loan-sched-head"><span>اقساط ({items.length})</span><span className="loan-sched-hint">برای پرداخت/یادآوری روی قسط بزنید</span></div>
                <div className="loan-detail-list">
                  {items.map(({ key, tx }, i) => {
                    const [yy, mm, dd] = key.split('-').map(Number);
                    const c = fromDate(calendarSystem, new Date(yy, mm - 1, dd));
                    return (
                      <div key={tx.id} className={`loan-detail-row ${tx.isPaid ? 'paid' : ''}`}>
                        <span className="ls-num">{i + 1}</span>
                        <div className="ld-info">
                          <span className="ld-date">{c.day} {months[c.month]} {c.year} {tx.reminderDateTime && '⏰'}</span>
                          <span className="ld-amt">{formatNumber(tx.amount)} تومان</span>
                        </div>
                        <button className="ld-btn pay" onClick={() => togglePaidByKey(key, tx.id)}>{tx.isPaid ? '✓' : '○'}</button>
                        <button className="ld-btn rem" onClick={() => openReminderFor(key, tx)}>⏰</button>
                        <button className="ld-btn del" onClick={() => deleteTrans(key, tx.id)}>🗑</button>
                      </div>
                    );
                  })}
                </div>
                <button className="acc-addline" onClick={() => {
                  // Borrower-side loan accounting (initial recognition):
                  // Debit Cash (principal received) + Debit Finance cost (interest = total - principal)
                  // Credit Loan payable (total to repay). Re-posting upserts the same ref.
                  const interest = Math.max(0, ln.total - ln.principal);
                  const t = getToday('jalali');
                  const spec: { type: AccType; name?: string; debit?: number; credit?: number }[] = [
                    { type: 'asset', name: 'صندوق (نقد)', debit: ln.principal },
                    ...(interest > 0 ? [{ type: 'expense' as AccType, name: 'هزینه‌ی مالی (سود وام)', debit: interest }] : []),
                    { type: 'liability', name: 'وامِ دریافتی', credit: ln.total },
                  ];
                  postJournal(`loan-${ln.id}`, { y: t.year, m: t.month, d: t.day }, `وامِ ${ln.name}`, spec);
                }}>🧾 ثبتِ وام در حسابداری</button>
                <button className="fund-delete" onClick={() => deleteLoan(ln.id)}>حذف وام</button>
              </div>
            </div>
          </div>
        );
      })()}

      {/* صندوق خانوادگی */}
      {showFundModal && (
        <FundPanel funds={funds} onChange={saveFunds} onClose={() => { setShowFundModal(false); setFundStartReport(false); }} confirm={askConfirm} onAddDeposits={addFundDeposits} onShare={shareText} startInReport={fundStartReport} onPostJournal={postJournal} />
      )}

      {showAccModal && (
        <AccountingPanel state={accounting} onChange={saveAccounting} onClose={() => setShowAccModal(false)} confirm={askConfirm} />
      )}

      {showAttModal && (
        <AttendancePanel state={attendance} onChange={saveAttendance} onClose={() => setShowAttModal(false)} confirm={askConfirm} onPostJournal={postJournal} selfMode={selfMode} selfEmpId={selfEmpId} />
      )}

      {showInvModal && (
        <InventoryPanel state={inventory} onChange={saveInventory} onClose={() => setShowInvModal(false)} confirm={askConfirm} onPostJournal={upsertJournal} onRemoveJournal={removeJournal} />
      )}

      {showAccessModal && (
        <AccessPanel state={access} onChange={saveAccess} onClose={() => setShowAccessModal(false)} confirm={askConfirm} employees={attendance.employees.map((e) => ({ id: e.id, name: e.name }))} requirePin={access.enabled && !!activeUser && !can('users')} />
      )}

      {/* منوی راست: امکانات و ابزارها */}
      {showRightDrawer && (
        <div className="drawer-overlay" onClick={() => setShowRightDrawer(false)}>
          <aside className="drawer drawer-right" onClick={e => e.stopPropagation()}>
            <div className="drawer-head">
              <img className="drawer-logo" src={logoUrl} alt="" />
              <div>
                <div className="drawer-title">امکانات و ابزارها</div>
                <div className="drawer-sub">simorgh-ledger</div>
              </div>
              <button className="drawer-close" onClick={() => setShowRightDrawer(false)} aria-label="بستن">✕</button>
            </div>
            {can('tools') && <>
              <div className="drawer-section-label">گزارش‌ها</div>
              <button className="drawer-item" onClick={() => openTool('report')}><span className="di-icon"><IconReport /></span> گزارش مالی بازه‌ای</button>
              <button className="drawer-item" onClick={() => openTool('bom')}><span className="di-icon"><IconBom /></span> گزارش اول ماه (BOM)</button>
            </>}
            {(can('loans') || can('fund') || can('accounting') || can('attendance') || can('attendance_self') || can('inventory')) && <div className="drawer-section-label">مالی و عملیات</div>}
            {can('loans') && <>
              <button className="drawer-item" onClick={() => openTool('loan')}><span className="di-icon"><IconLoan /></span> وام جدید</button>
              <button className="drawer-item" onClick={() => { setShowRightDrawer(false); setShowLoansModal(true); }}><span className="di-icon"><IconReport /></span> وام‌های من</button>
            </>}
            {can('fund') && <>
              <button className="drawer-item" onClick={() => { setShowRightDrawer(false); setFundStartReport(false); setShowFundModal(true); }}><span className="di-icon"><IconUsers /></span> صندوق خانوادگی</button>
              <button className="drawer-item" onClick={() => { setShowRightDrawer(false); setFundStartReport(true); setShowFundModal(true); }}><span className="di-icon"><IconReport /></span> گزارش صندوق</button>
            </>}
            {can('accounting') && <button className="drawer-item" onClick={() => { setShowRightDrawer(false); setShowAccModal(true); }}><span className="di-icon"><IconBom /></span> حسابداری (دفترداریِ دوطرفه)</button>}
            {(can('attendance') || can('attendance_self')) && <button className="drawer-item" onClick={() => { setShowRightDrawer(false); setShowAttModal(true); }}><span className="di-icon"><IconToday /></span> حضور و غیاب</button>}
            {can('inventory') && <button className="drawer-item" onClick={() => { setShowRightDrawer(false); setShowInvModal(true); }}><span className="di-icon"><IconBom /></span> انبار</button>}
            <div className="drawer-section-label">ابزارهای کاربردی</div>
            <button className="drawer-item" onClick={() => openTool('convert')}><span className="di-icon"><IconConvert /></span> تبدیل تاریخ</button>
            <button className="drawer-item" onClick={() => openTool('age')}><span className="di-icon"><IconAge /></span> محاسبه سن</button>
            <button className="drawer-item" onClick={() => openTool('bio')}><span className="di-icon"><IconBio /></span> بیوریتم</button>
            <button className="drawer-item" onClick={() => openTool('bmi')}><span className="di-icon"><IconBmi /></span> شاخص توده بدنی</button>
            <div className="drawer-section-label">میان‌بر</div>
            <button className="drawer-item" onClick={() => { goToToday(); setShowRightDrawer(false); }}><span className="di-icon"><IconToday /></span> برو به امروز</button>
          </aside>
        </div>
      )}

      {/* منوی چپ: درباره ما */}
      {showLeftDrawer && (
        <div className="drawer-overlay" onClick={() => setShowLeftDrawer(false)}>
          <aside className="drawer drawer-left" onClick={e => e.stopPropagation()}>
            <div className="drawer-head">
              <img className="drawer-logo" src={logoUrl} alt="" />
              <div>
                <div className="drawer-title">درباره ما</div>
                <div className="drawer-sub">سیمرغ فناوری هوشمند</div>
              </div>
              <button className="drawer-close" onClick={() => setShowLeftDrawer(false)} aria-label="بستن">✕</button>
            </div>
            <button className="drawer-item" onClick={() => { setShowLeftDrawer(false); setShowAboutModal(true); }}><span className="di-icon"><IconUsers /></span> طراحان و خدمات</button>
            <button className="drawer-item" onClick={() => { setShowLeftDrawer(false); setTimeout(() => setShowTour(true), 250); }}><span className="di-icon"><IconInfo /></span> راهنمای تصویری</button>
            <button className="drawer-item" onClick={shareApp}><span className="di-icon"><IconShare /></span> ارسال نرم‌افزار</button>
            <a className="drawer-item" href="https://www.simorghai.com" target="_blank" rel="noopener noreferrer"><span className="di-icon"><IconGlobe /></span> وب‌سایت سیمرغ</a>

            <div className="drawer-section-label">کاربران و دسترسی</div>
            {access.enabled && <div className="drawer-hint">کاربرِ فعال: <b>{activeUser ? activeUser.name : 'مدیر (بدونِ محدودیت)'}</b></div>}
            <button className="drawer-item" onClick={() => { setShowLeftDrawer(false); setShowAccessModal(true); }}><span className="di-icon"><IconUsers /></span> کاربران، گروه‌ها و سطحِ دسترسی</button>

            <div className="drawer-section-label">حسابِ کاربری و همگام‌سازیِ ابری</div>
            {authToken ? (
              <div className="gh-sync">
                <div className="acct-row">واردشده: <b dir="ltr">{authPhone}</b></div>
                <div className="gh-actions">
                  <button className="gh-btn up" onClick={cloudPush}>⬆️ ارسالِ داده‌ها</button>
                  <button className="gh-btn down" onClick={cloudPull}>⬇️ دریافتِ داده‌ها</button>
                </div>
                <button className="drawer-item acct-logout" onClick={apiLogout}>خروج از حساب</button>
                <div className="drawer-hint">برای چنددستگاهه‌شدن: روی دستگاهِ اول «ارسال» و روی دستگاهِ دوم «دریافت» را بزنید.</div>
              </div>
            ) : (
              <div className="gh-sync">
                <input className="gh-input" type="tel" inputMode="tel" dir="ltr" placeholder="شماره موبایل" value={acctPhone} onChange={(e) => setAcctPhone(e.target.value)} />
                <input className="gh-input" type="password" dir="ltr" placeholder="رمز عبور" value={acctPw} onChange={(e) => setAcctPw(e.target.value)} />
                <div className="gh-actions">
                  <button className="gh-btn up" onClick={() => apiAuth('login')}>ورود</button>
                  <button className="gh-btn down" onClick={() => apiAuth('register')}>ثبت‌نام</button>
                </div>
                <div className="drawer-hint">با حساب می‌توانید داده‌ها را در سرورِ سیمرغ نگه دارید و بینِ گوشی/کامپیوتر سینک کنید.</div>
              </div>
            )}

            <div className="drawer-section-label">پشتیبان‌گیری</div>
            <button className="drawer-item" onClick={shareBackup}><span className="di-icon"><IconShare /></span> ارسالِ پشتیبان (بله/ایتا/تلگرام)</button>
            <button className="drawer-item" onClick={exportBackup}><span className="di-icon"><IconReport /></span> ذخیره‌ی فایلِ پشتیبان در دستگاه</button>
            <button className="drawer-item" onClick={() => restoreInputRef.current?.click()}><span className="di-icon"><IconLoan /></span> بازیابی از فایلِ پشتیبان</button>
            <input ref={restoreInputRef} type="file" accept="application/json,.json" style={{ display: 'none' }} onChange={onRestoreFile} />
            <div className="drawer-hint">قبل از حذف‌و‌نصبِ برنامه یک پشتیبان بسازید تا داده‌ها (صندوق، وام، تقویم) از بین نرود.</div>

            <div className="drawer-section-label">همگام‌سازی با گیت‌هاب (پیشرفته)</div>
            <div className="gh-sync">
              <input className="gh-input" type="text" inputMode="url" dir="ltr" placeholder="user/repo (ریپوی خصوصی)" value={ghRepo} onChange={(e) => setGhRepo(e.target.value)} />
              <input className="gh-input" type="password" dir="ltr" placeholder="GitHub Token (دسترسیِ Contents)" value={ghToken} onChange={(e) => setGhToken(e.target.value)} />
              <div className="gh-actions">
                <button className="gh-btn up" onClick={ghUpload}>⬆️ آپلود به گیت‌هاب</button>
                <button className="gh-btn down" onClick={ghRestore}>⬇️ بازیابی از گیت‌هاب</button>
              </div>
              <div className="drawer-hint">یک ریپوی <b>خصوصی</b> بسازید و یک Fine-grained Token با دسترسیِ «Contents: Read and write» فقط روی همان ریپو. توکن فقط روی همین دستگاه ذخیره می‌شود. در ایران ممکن است به VPN نیاز باشد.</div>
            </div>

            <div className="drawer-section-label">پوسته</div>
            <div className="theme-switch">
              <button className={`theme-btn ${theme === 'light' ? 'active' : ''}`} onClick={() => setTheme('light')}>☀️ روشن</button>
              <button className={`theme-btn ${theme === 'dark' ? 'active' : ''}`} onClick={() => setTheme('dark')}>🌙 تیره</button>
            </div>

            <div className="drawer-foot">نسخه ۱۴۰۵ · ۱.۰.۴۷</div>
          </aside>
        </div>
      )}

      {/* درباره: طراحان و خدمات */}
      {showAboutModal && (
        <div className="modal" onClick={() => setShowAboutModal(false)}>
          <div className="modal-box about-box" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h3>👥 طراحان و خدمات</h3>
              <button className="close-modal" onClick={() => setShowAboutModal(false)}>✕</button>
            </div>
            <div className="about-brand">
              <img className="about-logo" src={logoUrl} alt="" />
              <div className="about-app">simorgh-ledger</div>
              <div className="about-company">سیمرغ فناوری هوشمند ایرانیان</div>
            </div>

            <div className="about-section-title">طراحان</div>
            <div className="about-designer">هادی ولیخانی</div>
            <div className="about-designer">شهرام طبسی نژاد</div>

            <div className="about-section-title">راه‌های ارتباطی</div>
            <a className="about-row" href="tel:09132734850"><span>📞</span> ۰۹۱۳۲۷۳۴۸۵۰</a>
            <a className="about-row" href="tel:09916505467"><span>📞</span> ۰۹۹۱۶۵۰۵۴۶۷</a>
            <a className="about-row" href="mailto:info@simorghai.com"><span>✉️</span> info@simorghai.com</a>
            <a className="about-row" href="https://www.simorghai.com" target="_blank" rel="noopener noreferrer"><span>🌐</span> www.simorghai.com</a>

            <div className="about-section-title">خدمات ما</div>
            <ul className="about-services">
              <li>طراحی نرم‌افزار با کمک دستیار هوش مصنوعی</li>
              <li>طراحی انواع نرم‌افزارهای سفارشی</li>
              <li>ارائه‌ی اولین نرم‌افزار مبتنی بر اصل SOS</li>
              <li>طراحی وب‌سایت با سئوی حرفه‌ای</li>
            </ul>
          </div>
        </div>
      )}

      {/* مودال یادآوری */}
      {showReminderModal && (
        <div className="modal" onClick={() => setShowReminderModal(false)}>
          <div className="modal-box" onClick={e => e.stopPropagation()}>
            <h3>⏰ تنظیم یادآوری</h3>
            <p style={{ marginBottom: '12px', fontSize: '13px', color: '#666' }}>
              برای: <strong>{reminderText}</strong>
            </p>
            <label className="field-label">یادآوری چند روز قبل از سررسید</label>
            <div className="mini-toggle reminder-offsets">
              {[0, 1, 2, 3, 7].map((d) => (
                <button key={d} type="button" className="mini-toggle-btn" onClick={() => setReminderOffset(d)}>
                  {d === 0 ? 'روزِ سررسید' : `${d} روز`}
                </button>
              ))}
            </div>
            <label className="field-label">تاریخ یادآوری</label>
            <CalendarDateInput value={reminderDateValue} onChange={setReminderDateValue} />
            <label className="field-label">ساعت</label>
            <input
              type="time"
              value={reminderTime}
              onChange={e => setReminderTime(e.target.value)}
              style={{ marginBottom: '12px' }}
            />
            <div className="modal-btns">
              <button className="submit" onClick={confirmReminder}>ثبت یادآوری</button>
              <button className="cancel" onClick={() => setShowReminderModal(false)}>انصراف</button>
            </div>
          </div>
        </div>
      )}

      {/* دیالوگ سفارشی (به‌جای alert/confirm سیستم) */}
      {dialog && (
        <div className="modal dialog-modal" onClick={() => setDialog(null)}>
          <div className="dialog-box" onClick={e => e.stopPropagation()}>
            <div className="dialog-msg">{dialog.message}</div>
            <div className="dialog-btns">
              {dialog.type === 'confirm' && (
                <button className="dialog-cancel" onClick={() => setDialog(null)}>انصراف</button>
              )}
              <button
                className="dialog-ok"
                onClick={() => { const y = dialog.onYes; setDialog(null); y && y(); }}
              >
                {dialog.type === 'confirm' ? 'بله' : 'باشه'}
              </button>
            </div>
          </div>
        </div>
      )}

      {exitHint && <div className="exit-hint">برای خروج، دوباره دکمه‌ی برگشت را بزنید</div>}
    </div>
  );
}

export default App;
