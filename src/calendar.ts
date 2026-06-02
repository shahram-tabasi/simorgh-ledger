// مدیریت تقویم سه‌گانه: شمسی (jalali) / میلادی (gregorian) / قمری (hijri)
// همه‌ی توابع روزِ فیزیکی یکسانی را بین تقویم‌ها نگه می‌دارند تا داده‌ها قاطی نشوند.
import moment from 'moment-jalaali';
import momentHijri from 'moment-hijri';

moment.loadPersian({ dialect: 'persian-modern' });

export type CalendarSystem = 'jalali' | 'gregorian' | 'hijri';

export const CALENDAR_SYSTEMS: CalendarSystem[] = ['jalali', 'gregorian', 'hijri'];

// برچسب هر تقویم برای نمایش در دکمه‌های سه‌وضعیتی
export const SYSTEM_LABELS: Record<CalendarSystem, string> = {
  jalali: 'شمسی',
  gregorian: 'میلادی',
  hijri: 'قمری',
};

const MONTH_NAMES: Record<CalendarSystem, string[]> = {
  jalali: [
    'فروردین', 'اردیبهشت', 'خرداد', 'تیر', 'مرداد', 'شهریور',
    'مهر', 'آبان', 'آذر', 'دی', 'بهمن', 'اسفند',
  ],
  gregorian: [
    'ژانویه', 'فوریه', 'مارس', 'آوریل', 'مه', 'ژوئن',
    'ژوئیه', 'اوت', 'سپتامبر', 'اکتبر', 'نوامبر', 'دسامبر',
  ],
  hijri: [
    'محرم', 'صفر', 'ربیع‌الاول', 'ربیع‌الثانی', 'جمادی‌الاول', 'جمادی‌الثانی',
    'رجب', 'شعبان', 'رمضان', 'شوال', 'ذیقعده', 'ذیحجه',
  ],
};

// روزهای هفته مستقل از تقویم هستند، پس همیشه ثابت‌اند (هفته از شنبه شروع می‌شود)
export const weekDays: string[] = ['شنبه', 'یکشنبه', 'دوشنبه', 'سه‌شنبه', 'چهارشنبه', 'پنجشنبه', 'جمعه'];

export function getMonthNames(system: CalendarSystem): string[] {
  return MONTH_NAMES[system];
}

// ساخت یک لحظه‌ی میلادی از تاریخِ تقویم انتخاب‌شده (month صفرمبنا است)
function toGregorian(system: CalendarSystem, year: number, month: number, day: number) {
  if (system === 'jalali') return moment(`${year}/${month + 1}/${day}`, 'jYYYY/jM/jD');
  if (system === 'hijri') return momentHijri(`${year}/${month + 1}/${day}`, 'iYYYY/iM/iD');
  return moment(`${year}/${month + 1}/${day}`, 'YYYY/M/D');
}

export interface CalendarDate {
  year: number;
  month: number; // صفرمبنا
  day: number;
}

export function getToday(system: CalendarSystem): CalendarDate {
  if (system === 'jalali') {
    const t = moment();
    return { year: t.jYear(), month: t.jMonth(), day: t.jDate() };
  }
  if (system === 'hijri') {
    const t = momentHijri();
    return { year: t.iYear(), month: t.iMonth(), day: t.iDate() };
  }
  const t = moment();
  return { year: t.year(), month: t.month(), day: t.date() };
}

export function getMonthDays(system: CalendarSystem, year: number, month: number): number {
  if (system === 'jalali') return moment.jDaysInMonth(year, month);
  if (system === 'hijri') return momentHijri.iDaysInMonth(year, month);
  return moment(`${year}/${month + 1}`, 'YYYY/M').daysInMonth();
}

// آفست روز اول ماه نسبت به شنبه (۰=شنبه ... ۶=جمعه)
export function getFirstWeekdayOffset(system: CalendarSystem, year: number, month: number): number {
  const g = toGregorian(system, year, month, 1);
  return (g.day() + 1) % 7;
}

export function isToday(system: CalendarSystem, year: number, month: number, day: number): boolean {
  const t = getToday(system);
  return t.year === year && t.month === month && t.day === day;
}

// کلیدِ داده بر مبنای تاریخ میلادی است تا یک روزِ فیزیکی در هر سه تقویم یکسان دیده شود
export function dateKey(system: CalendarSystem, year: number, month: number, day: number): string {
  return toGregorian(system, year, month, day).format('YYYY-M-D');
}

// جابه‌جایی ماه با سرریز صحیحِ سال
export function shiftMonth(system: CalendarSystem, year: number, month: number, delta: number): { year: number; month: number } {
  void system;
  let m = month + delta;
  let y = year;
  while (m < 0) { m += 12; y -= 1; }
  while (m > 11) { m -= 12; y += 1; }
  return { year: y, month: m };
}

// تبدیل ماهِ در حال نمایش هنگام تغییر تقویم تا کاربر روی همان بازه‌ی زمانی بماند
export function convertMonth(from: CalendarSystem, to: CalendarSystem, year: number, month: number): { year: number; month: number } {
  const iso = toGregorian(from, year, month, 15).format('YYYY-M-D');
  if (to === 'jalali') {
    const j = moment(iso, 'YYYY-M-D');
    return { year: j.jYear(), month: j.jMonth() };
  }
  if (to === 'hijri') {
    const h = momentHijri(iso, 'YYYY-M-D');
    return { year: h.iYear(), month: h.iMonth() };
  }
  const g = moment(iso, 'YYYY-M-D');
  return { year: g.year(), month: g.month() };
}

// بازه‌ی سال‌ها برای انتخابگر، حول سالِ جاریِ همان تقویم
export function yearRange(system: CalendarSystem): number[] {
  const { year } = getToday(system);
  const arr: number[] = [];
  for (let y = year - 15; y <= year + 15; y++) arr.push(y);
  return arr;
}

// مهاجرت کلیدهای قدیمیِ شمسی (سال ۱۳۰۰ تا ۱۵۰۰) به کلید میلادی، یک‌بار هنگام بارگذاری
export function migrateKey(key: string): string {
  const parts = key.split('-');
  if (parts.length !== 3) return key;
  const y = parseInt(parts[0], 10);
  if (y >= 1300 && y <= 1500) {
    const g = moment(`${parts[0]}/${parts[1]}/${parts[2]}`, 'jYYYY/jM/jD');
    if (g.isValid()) return g.format('YYYY-M-D');
  }
  return key;
}

// ===== کمک‌توابعِ ابزارها (تبدیل تاریخ، سن، بیوریتم) =====

// تبدیل تاریخِ یک تقویم به آبجکت Date میلادیِ نیمه‌شب
export function toDate(system: CalendarSystem, year: number, month: number, day: number): Date {
  return toGregorian(system, year, month, day).toDate();
}

// خواندن مولفه‌های یک تقویم از روی Date میلادی
export function fromDate(system: CalendarSystem, date: Date): CalendarDate {
  if (system === 'jalali') {
    const m = moment(date);
    return { year: m.jYear(), month: m.jMonth(), day: m.jDate() };
  }
  if (system === 'hijri') {
    const m = momentHijri(date);
    return { year: m.iYear(), month: m.iMonth(), day: m.iDate() };
  }
  const m = moment(date);
  return { year: m.year(), month: m.month(), day: m.date() };
}

// نام روز هفته از روی Date (۰=یکشنبه ... ۶=شنبه در getDay)
const WEEKDAY_NAMES = ['یکشنبه', 'دوشنبه', 'سه‌شنبه', 'چهارشنبه', 'پنجشنبه', 'جمعه', 'شنبه'];
export function getWeekdayName(date: Date): string {
  return WEEKDAY_NAMES[date.getDay()];
}

export interface AllCalendars {
  jalali: CalendarDate;
  gregorian: CalendarDate;
  hijri: CalendarDate;
  weekday: string;
}

// تبدیل همزمانِ یک تاریخ به هر سه تقویم
export function convertAll(system: CalendarSystem, year: number, month: number, day: number): AllCalendars {
  const date = toDate(system, year, month, day);
  return {
    jalali: fromDate('jalali', date),
    gregorian: fromDate('gregorian', date),
    hijri: fromDate('hijri', date),
    weekday: getWeekdayName(date),
  };
}

// بازه‌ی سال برای تاریخِ تولد (تا ۱۲۰ سال قبل)
export function birthYearRange(system: CalendarSystem): number[] {
  const { year } = getToday(system);
  const arr: number[] = [];
  for (let y = year; y >= year - 120; y--) arr.push(y);
  return arr;
}

export interface AgeResult {
  years: number;
  months: number;
  days: number;
  totalDays: number;
  totalWeeks: number;
  totalMonths: number;
  nextBirthdayInDays: number;
}

// محاسبه‌ی سن و مدت‌زمانِ سپری‌شده بین دو تاریخ (بر مبنای میلادی، نتیجه برای شمسی هم یکسان است)
export function ageBetween(birth: Date, now: Date): AgeResult {
  let years = now.getFullYear() - birth.getFullYear();
  let months = now.getMonth() - birth.getMonth();
  let days = now.getDate() - birth.getDate();
  if (days < 0) {
    months -= 1;
    days += new Date(now.getFullYear(), now.getMonth(), 0).getDate();
  }
  if (months < 0) {
    years -= 1;
    months += 12;
  }
  const msPerDay = 86400000;
  const totalDays = Math.floor((now.getTime() - birth.getTime()) / msPerDay);

  // تولدِ بعدی
  let nextBday = new Date(now.getFullYear(), birth.getMonth(), birth.getDate());
  if (nextBday.getTime() < now.getTime()) {
    nextBday = new Date(now.getFullYear() + 1, birth.getMonth(), birth.getDate());
  }
  const nextBirthdayInDays = Math.ceil((nextBday.getTime() - now.getTime()) / msPerDay);

  return {
    years,
    months,
    days,
    totalDays,
    totalWeeks: Math.floor(totalDays / 7),
    totalMonths: years * 12 + months,
    nextBirthdayInDays,
  };
}

export interface Biorhythm {
  physical: number;    // ۲۳ روزه
  emotional: number;   // ۲۸ روزه
  intellectual: number; // ۳۳ روزه
  days: number;
}

// محاسبه‌ی بیوریتم برای امروز بر اساس تعداد روزهای زندگی
export function biorhythm(birth: Date, now: Date): Biorhythm {
  const days = Math.floor((now.getTime() - birth.getTime()) / 86400000);
  const pct = (period: number) => Math.round(Math.sin((2 * Math.PI * days) / period) * 100);
  return {
    physical: pct(23),
    emotional: pct(28),
    intellectual: pct(33),
    days,
  };
}
