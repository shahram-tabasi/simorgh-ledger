import { useState, useEffect, useRef } from 'react';
import './App.css';
import { LocalNotifications } from '@capacitor/local-notifications';
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
import {
  IconReport, IconBom, IconLoan, IconConvert, IconAge, IconBio, IconBmi,
  IconToday, IconUsers, IconShare, IconGlobe, IconMenu, IconInfo,
} from './icons';

const getPrayerTimes = (day: number): any => {
  const times = {
    fajr: ['04:28', '04:26', '04:24', '04:22'],
    sunrise: ['06:00', '05:58', '05:56', '05:54'],
    dhuhr: ['12:00', '12:01', '12:02', '12:03'],
    asr: ['15:30', '15:31', '15:32', '15:33'],
    maghrib: ['18:00', '18:02', '18:04', '18:06'],
    isha: ['19:30', '19:32', '19:34', '19:36']
  };
  const index = Math.floor((day - 1) / 10);
  return {
    fajr: times.fajr[index],
    sunrise: times.sunrise[index],
    dhuhr: times.dhuhr[index],
    asr: times.asr[index],
    maghrib: times.maghrib[index],
    isha: times.isha[index]
  };
};

interface Transaction {
  id: string;
  title: string;
  amount: number;
  isPaid: boolean;
  reminderDateTime?: string; // ذخیره زمان یادآوری
  reminderScheduled?: boolean;
}

interface DayData {
  transactions: Transaction[];
}

// تابع فرمت عدد با جداکننده سه‌رقمی
const formatNumber = (num: number): string => {
  return num.toLocaleString('en-US');
};

// تابع تبدیل رشته با جداکننده به عدد
const parseFormattedNumber = (str: string): number => {
  const cleaned = str.replace(/,/g, '');
  return parseFloat(cleaned);
};

const SYSTEM_STORAGE_KEY = 'calendarSystem';

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
  const [prayerTimes, setPrayerTimes] = useState<any>(null);
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
  const [showWelcome, setShowWelcome] = useState<boolean>(true);
  const [showRightDrawer, setShowRightDrawer] = useState<boolean>(false);
  const [showLeftDrawer, setShowLeftDrawer] = useState<boolean>(false);
  const [showAboutModal, setShowAboutModal] = useState<boolean>(false);
  const [toolsInitialSection, setToolsInitialSection] = useState<string>('report');
  const [editingTxId, setEditingTxId] = useState<string | null>(null);
  const touchStart = useRef<{ x: number; y: number } | null>(null);

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

  // درج خودکار اقساط وام روی تاریخ سررسید هر قسط در تقویم
  const addInstallments = (entries: { key: string; title: string; amount: number }[]) => {
    const next: { [key: string]: DayData } = { ...calendarData };
    entries.forEach(({ key, title, amount }, idx) => {
      const existing = next[key]?.transactions || [];
      const tx: Transaction = {
        id: `${Date.now()}-${idx}-${Math.random().toString(36).slice(2, 7)}`,
        title,
        amount,
        isPaid: false,
      };
      next[key] = { transactions: [...existing, tx] };
    });
    saveData(next);
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
      alert('لطفاً مجوز نوتیفیکیشن را فعال کنید');
      return false;
    }

    if (!transaction.reminderDateTime) return false;

    const reminderDateTime = new Date(transaction.reminderDateTime);
    const now = new Date();

    if (reminderDateTime <= now) {
      alert('زمان یادآوری باید در آینده باشد');
      return false;
    }

    try {
      await LocalNotifications.schedule({
        notifications: [
          {
            title: '📌 یادآوری قسط',
            body: `${transaction.title} - مبلغ: ${formatNumber(transaction.amount)} تومان`,
            id: parseInt(transaction.id) % 1000000,
            schedule: { at: reminderDateTime },
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
    if (!title.trim()) return alert('عنوان را وارد کنید');
    const amt = parseFormattedNumber(amount);
    if (isNaN(amt) || amt <= 0) return alert('مبلغ معتبر وارد کنید');
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

    // پرسش برای ثبت یادآوری
    const wantReminder = confirm('آیا می‌خواهید برای این قسط یادآوری ثبت کنید؟');
    if (wantReminder) {
      setSelectedTransactionForReminder({ dateKey: selectedDate, transactionId: newTransaction.id });
      setReminderText(newTransaction.title);
      // پیش‌فرضِ تاریخِ یادآوری = روزِ تراکنش، در همان تقویمِ انتخابی
      const [gy, gm, gd] = selectedDate.split('-').map(Number);
      setReminderDateValue({ system: calendarSystem, ...fromDate(calendarSystem, new Date(gy, (gm || 1) - 1, gd || 1)) });
      setShowReminderModal(true);
    }
  };

  // باز کردن یک ابزار از منوی امکانات
  const openTool = (section: string) => {
    setToolsInitialSection(section);
    setShowRightDrawer(false);
    setShowToolsModal(true);
  };

  // تایید یادآوری
  const confirmReminder = async () => {
    if (!selectedTransactionForReminder || !reminderTime) {
      alert('لطفاً تاریخ و ساعت را انتخاب کنید');
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
      alert('✅ یادآوری با موفقیت ثبت شد');
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
    if (!confirm('حذف شود؟')) return;
    const day = calendarData[dateKey];
    if (!day) return;
    const filtered = day.transactions.filter(t => t.id !== id);
    const newData = { ...calendarData };
    if (filtered.length === 0) delete newData[dateKey];
    else newData[dateKey] = { transactions: filtered };
    saveData(newData);
  };

  const openDayDetails = (year: number, month: number, day: number) => {
    const dateKey = getKey(year, month, day);
    setSelectedDate(dateKey);
    setSelectedDayNum(day);
    setShowDayModal(true);
  };

  const openPrayerTimes = (day: number) => {
    const times = getPrayerTimes(day);
    setPrayerTimes(times);
    setShowPrayerModal(true);
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
        >
          <span className="day-num">{d}</span>
          {debt > 0 && (
            <span className="debt-badge" title={`${formatNumber(debt)} تومان`}>
              {formatNumber(debt)}
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
      if (dx > 0) setShowRightDrawer(true);
      else setShowLeftDrawer(true);
    }
  };

  return (
    <div className="app" onTouchStart={onTouchStart} onTouchEnd={onTouchEnd}>
      {showWelcome && <WelcomeScreen onDone={() => setShowWelcome(false)} />}

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
            <div className="modal-header">
              <h3>جزئیات روز {selectedDayNum} {months[currentMonth]}</h3>
              <button className="close-modal" onClick={() => setShowDayModal(false)}>✕</button>
            </div>
            
            <div className="day-debt-summary">
              <span>مجموع بدهی این روز:</span>
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
                openPrayerTimes(selectedDayNum);
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
      )}

      {showAddModal && (
        <div className="modal" onClick={() => { setShowAddModal(false); setEditingTxId(null); }}>
          <div className="modal-box" onClick={e => e.stopPropagation()}>
            <h3>{editingTxId ? '✏️ ویرایش تراکنش' : '➕ افزودن تراکنش جدید'}</h3>
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
      )}

      {showPrayerModal && prayerTimes && (
        <div className="modal" onClick={() => setShowPrayerModal(false)}>
          <div className="modal-box prayer-box" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h3>🕌 اوقات شرعی</h3>
              <button className="close-modal" onClick={() => setShowPrayerModal(false)}>✕</button>
            </div>
            <div className="prayer-list">
              <div className="prayer-row"><span>اذان صبح:</span><strong>{prayerTimes.fajr}</strong></div>
              <div className="prayer-row"><span>طلوع آفتاب:</span><strong>{prayerTimes.sunrise}</strong></div>
              <div className="prayer-row"><span>اذان ظهر:</span><strong>{prayerTimes.dhuhr}</strong></div>
              <div className="prayer-row"><span>اذان عصر:</span><strong>{prayerTimes.asr}</strong></div>
              <div className="prayer-row"><span>اذان مغرب:</span><strong>{prayerTimes.maghrib}</strong></div>
              <div className="prayer-row"><span>اذان عشاء:</span><strong>{prayerTimes.isha}</strong></div>
            </div>
            <button className="close-prayer" onClick={() => setShowPrayerModal(false)}>بستن</button>
          </div>
        </div>
      )}

      {showToolsModal && (
        <ToolsPanel
          calendarData={calendarData}
          currentSystem={calendarSystem}
          currentYear={currentYear}
          currentMonth={currentMonth}
          onClose={() => setShowToolsModal(false)}
          onAddTransactions={addInstallments}
          section={toolsInitialSection}
        />
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
            <div className="drawer-section-label">گزارش‌ها</div>
            <button className="drawer-item" onClick={() => openTool('report')}><span className="di-icon"><IconReport /></span> گزارش مالی بازه‌ای</button>
            <button className="drawer-item" onClick={() => openTool('bom')}><span className="di-icon"><IconBom /></span> گزارش اول ماه (BOM)</button>
            <div className="drawer-section-label">مالی</div>
            <button className="drawer-item" onClick={() => openTool('loan')}><span className="di-icon"><IconLoan /></span> وام و اقساط</button>
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
            <button className="drawer-item" onClick={() => {
              const data = { title: 'simorgh-ledger', text: 'دفترکل و تقویم هوشمند سیمرغ', url: 'https://www.simorghai.com' };
              if (navigator.share) navigator.share(data).catch(() => {});
              else alert('www.simorghai.com');
              setShowLeftDrawer(false);
            }}><span className="di-icon"><IconShare /></span> ارسال نرم‌افزار</button>
            <a className="drawer-item" href="https://www.simorghai.com" target="_blank" rel="noopener noreferrer"><span className="di-icon"><IconGlobe /></span> وب‌سایت سیمرغ</a>
            <div className="drawer-foot">نسخه ۱۴۰۵ · ۱.۰.۱۲</div>
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
    </div>
  );
}

export default App;
