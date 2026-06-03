// محاسبه‌ی اوقات شرعی (آفلاین) با روشِ مؤسسه ژئوفیزیک دانشگاه تهران
import { Coordinates, CalculationMethod, PrayerTimes } from 'adhan';

export interface PrayerResult {
  fajr: string;
  sunrise: string;
  dhuhr: string;
  asr: string;
  maghrib: string;
  isha: string;
}

const fmt = (d: Date): string =>
  new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Tehran' }).format(d);

export function computePrayerTimes(lat: number, lng: number, date: Date): PrayerResult {
  const pt = new PrayerTimes(new Coordinates(lat, lng), date, CalculationMethod.Tehran());
  return {
    fajr: fmt(pt.fajr),
    sunrise: fmt(pt.sunrise),
    dhuhr: fmt(pt.dhuhr),
    asr: fmt(pt.asr),
    maghrib: fmt(pt.maghrib),
    isha: fmt(pt.isha),
  };
}
