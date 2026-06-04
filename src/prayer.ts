// محاسبه‌ی اوقات شرعی (آفلاین) با روشِ مؤسسه ژئوفیزیک دانشگاه تهران
import { Coordinates, CalculationMethod, PrayerTimes, SunnahTimes } from 'adhan';

export interface PrayerResult {
  fajr: Date;     // اذان صبح
  sunrise: Date;  // طلوع آفتاب
  dhuhr: Date;    // اذان ظهر
  sunset: Date;   // غروب آفتاب
  maghrib: Date;  // اذان مغرب (پس از غروب)
  midnight: Date; // نیمه‌شبِ شرعی
}

// قالب‌بندیِ ساعت به وقتِ ایران (۲۴ ساعته)
export const fmtTime = (d: Date): string =>
  new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Tehran' }).format(d);

export function computePrayerTimes(lat: number, lng: number, date: Date): PrayerResult {
  const pt = new PrayerTimes(new Coordinates(lat, lng), date, CalculationMethod.Tehran());
  const sunnah = new SunnahTimes(pt);
  return {
    fajr: pt.fajr,
    sunrise: pt.sunrise,
    dhuhr: pt.dhuhr,
    sunset: pt.sunset,
    maghrib: pt.maghrib,
    midnight: sunnah.middleOfTheNight,
  };
}
