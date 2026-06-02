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
