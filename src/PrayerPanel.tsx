// پنلِ اوقات شرعی: نمایشِ شش وقتِ شرعی + شمارشِ معکوسِ زنده تا وقتِ بعدی
import { useEffect, useMemo, useState } from 'react';
import { computePrayerTimes, fmtTime } from './prayer';
import { PROVINCES, findCity } from './cities';
import { fromDate, getMonthNames, getWeekdayName } from './calendar';

const FA = ['۰', '۱', '۲', '۳', '۴', '۵', '۶', '۷', '۸', '۹'];
const fa = (s: string | number): string => String(s).replace(/[0-9]/g, (d) => FA[+d]);

interface Props {
  province: string;
  city: string;
  onProvinceChange: (p: string) => void;
  onCityChange: (c: string) => void;
  onClose: () => void;
}

export default function PrayerPanel({ province, city, onProvinceChange, onCityChange, onClose }: Props) {
  const [now, setNow] = useState<Date>(() => new Date());
  const [offset, setOffset] = useState(0); // روزِ نمایش نسبت به امروز

  // تیکِ هر ثانیه برای شمارشِ معکوس
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);

  const pcity = findCity(province, city) || findCity('تهران', 'تهران')!;
  const cityList = PROVINCES.find((p) => p.name === province)?.cities || [];

  const shownDate = useMemo(() => {
    const d = new Date();
    d.setHours(12, 0, 0, 0);
    d.setDate(d.getDate() + offset);
    return d;
  }, [offset]);

  const pt = useMemo(
    () => computePrayerTimes(pcity.lat, pcity.lng, shownDate),
    [pcity.lat, pcity.lng, shownDate],
  );

  const jMonths = getMonthNames('jalali');
  const hMonths = getMonthNames('hijri');
  const j = fromDate('jalali', shownDate);
  const h = fromDate('hijri', shownDate);
  const weekday = getWeekdayName(shownDate);

  // شمارشِ معکوس تا وقتِ شرعیِ بعدی (فقط برای امروز معنا دارد)
  const countdown = useMemo(() => {
    if (offset !== 0) return null;
    const t = now.getTime();
    const anchors: { label: string; date: Date }[] = [
      { label: 'اذان صبح', date: pt.fajr },
      { label: 'اذان ظهر', date: pt.dhuhr },
      { label: 'اذان مغرب', date: pt.maghrib },
      { label: 'نیمه‌شب', date: pt.midnight },
    ];
    let next = anchors.find((a) => a.date.getTime() > t);
    if (!next) {
      // همه‌ی اوقاتِ امروز گذشته‌اند → اذان صبحِ فردا
      const tomorrow = new Date(now);
      tomorrow.setDate(tomorrow.getDate() + 1);
      tomorrow.setHours(12, 0, 0, 0);
      const ptT = computePrayerTimes(pcity.lat, pcity.lng, tomorrow);
      next = { label: 'اذان صبح', date: ptT.fajr };
    }
    let diff = Math.max(0, Math.floor((next.date.getTime() - t) / 1000));
    const hh = Math.floor(diff / 3600);
    diff -= hh * 3600;
    const mm = Math.floor(diff / 60);
    const ss = diff - mm * 60;
    return { label: next.label, hh, mm, ss };
  }, [now, offset, pt, pcity.lat, pcity.lng]);

  const cell = (label: string, d: Date) => (
    <div className="prayer-cell">
      <span className="pc-label">{label}</span>
      <span className="pc-time">{fa(fmtTime(d))}</span>
    </div>
  );

  return (
    <div className="modal" onClick={onClose}>
      <div className="modal-box prayer-box" onClick={(e) => e.stopPropagation()}>
        <div className="tool-panel-head">
          <span className="tool-panel-icon">🕌</span>
          <h3>{city}</h3>
          <button className="close-modal" onClick={onClose}>✕</button>
        </div>
        <div className="prayer-body">
          <div className="prayer-navbar">
            <button onClick={() => setOffset(offset - 1)}>‹ قبل</button>
            <span>{offset === 0 ? 'امروز ' : ''}{weekday} {fa(j.day)} {jMonths[j.month]}</span>
            <button onClick={() => setOffset(offset + 1)}>بعد ›</button>
          </div>

          <div className="prayer-grid">
            {cell('اذان صبح', pt.fajr)}
            {cell('طلوع', pt.sunrise)}
            {cell('اذان ظهر', pt.dhuhr)}
            {cell('غروب', pt.sunset)}
            {cell('اذان مغرب', pt.maghrib)}
            {cell('نیمه‌شب', pt.midnight)}
          </div>

          {countdown && (
            <div className="prayer-countdown">
              <div className="pc-title">تا {countdown.label}</div>
              <div className="pc-clock">
                <span className="pc-num">{fa(countdown.hh)}</span> ساعت و{' '}
                <span className="pc-num">{fa(countdown.mm)}</span> دقیقه و{' '}
                <span className="pc-num">{fa(countdown.ss)}</span> ثانیه
              </div>
            </div>
          )}

          <div className="prayer-loc">
            <div className="pl-field">
              <label className="field-label">استان</label>
              <select value={province} onChange={(e) => onProvinceChange(e.target.value)}>
                {PROVINCES.map((p) => <option key={p.name} value={p.name}>{p.name}</option>)}
              </select>
            </div>
            <div className="pl-field">
              <label className="field-label">شهر</label>
              <select value={city} onChange={(e) => onCityChange(e.target.value)}>
                {cityList.map((c) => <option key={c.name} value={c.name}>{c.name}</option>)}
              </select>
            </div>
          </div>

          <div className="prayer-hijri">{fa(h.day)} {hMonths[h.month]}</div>
          <div className="prayer-note">به وقت ایران · روش مؤسسه ژئوفیزیک دانشگاه تهران</div>
        </div>
      </div>
    </div>
  );
}
