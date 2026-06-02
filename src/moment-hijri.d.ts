// تعریف نوع برای moment-hijri که تایپ همراه خود ندارد
declare module 'moment-hijri' {
  import { Moment } from 'moment';

  interface HijriMoment extends Moment {
    iYear(): number;
    iMonth(): number;
    iDate(): number;
  }

  interface MomentHijri {
    (input?: string, format?: string): HijriMoment;
    iDaysInMonth(year: number, month: number): number;
  }

  const momentHijri: MomentHijri;
  export = momentHijri;
}
