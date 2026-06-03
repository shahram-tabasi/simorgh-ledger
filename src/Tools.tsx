// هر ابزار، پنلِ اختصاصیِ خودش است (نه آکوردیون)
import { useMemo, useState, useEffect, type ReactNode } from 'react';
import {
  type CalendarSystem,
  CALENDAR_SYSTEMS,
  SYSTEM_LABELS,
  getMonthNames,
  getMonthDays,
  getToday,
  toDate,
  fromDate,
  convertAll,
  ageBetween,
  biorhythm,
  shiftMonth,
  dateKey,
} from './calendar';
import {
  IconReport, IconBom, IconLoan, IconConvert, IconAge, IconBio, IconBmi,
} from './icons';

const formatNumber = (n: number): string => n.toLocaleString('en-US');
const onlyDigits = (s: string): string => s.replace(/[^0-9]/g, '');
const withSeparators = (s: string): string => {
  const d = onlyDigits(s);
  return d ? parseInt(d, 10).toLocaleString('en-US') : '';
};

type CalData = { [key: string]: { transactions: { amount: number; isPaid: boolean }[] } };

export interface DateValue {
  system: CalendarSystem;
  year: number;
  month: number; // صفرمبنا
  day: number;
}

function todayValue(system: CalendarSystem): DateValue {
  const t = getToday(system);
  return { system, year: t.year, month: t.month, day: t.day };
}

function yearsForSystem(system: CalendarSystem): number[] {
  const y = getToday(system).year;
  const arr: number[] = [];
  for (let i = y + 20; i >= y - 120; i--) arr.push(i);
  return arr;
}

// تبدیل کلیدِ میلادیِ ذخیره‌شده (YYYY-M-D) به timestamp
function keyToTs(key: string): number {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(y, (m || 1) - 1, d || 1).getTime();
}

// ورودیِ تاریخِ چندتقویمی با سوییچ شمسی/میلادی/قمری
export function CalendarDateInput({ value, onChange }: { value: DateValue; onChange: (v: DateValue) => void }) {
  const months = getMonthNames(value.system);
  const maxDay = getMonthDays(value.system, value.year, value.month);
  const days = Array.from({ length: maxDay }, (_, i) => i + 1);
  const years = yearsForSystem(value.system);

  const changeSystem = (system: CalendarSystem) => {
    if (system === value.system) return;
    const conv = fromDate(system, toDate(value.system, value.year, value.month, value.day));
    onChange({ system, ...conv });
  };

  const changeField = (patch: Partial<DateValue>) => {
    const next = { ...value, ...patch };
    const md = getMonthDays(next.system, next.year, next.month);
    if (next.day > md) next.day = md;
    onChange(next);
  };

  return (
    <div className="date-input">
      <div className="mini-toggle">
        {CALENDAR_SYSTEMS.map((s) => (
          <button
            key={s}
            type="button"
            className={`mini-toggle-btn ${value.system === s ? 'active' : ''}`}
            onClick={() => changeSystem(s)}
          >
            {SYSTEM_LABELS[s]}
          </button>
        ))}
      </div>
      <div className="date-selects">
        <select value={value.day} onChange={(e) => changeField({ day: +e.target.value })}>
          {days.map((d) => <option key={d} value={d}>{d}</option>)}
        </select>
        <select value={value.month} onChange={(e) => changeField({ month: +e.target.value })}>
          {months.map((m, i) => <option key={i} value={i}>{m}</option>)}
        </select>
        <select value={value.year} onChange={(e) => changeField({ year: +e.target.value })}>
          {years.map((y) => <option key={y} value={y}>{y}</option>)}
        </select>
      </div>
    </div>
  );
}

export interface InstallmentEntry {
  key: string;
  title: string;
  amount: number;
}

interface ToolsPanelProps {
  calendarData: CalData;
  currentSystem: CalendarSystem;
  currentYear: number;
  currentMonth: number;
  onClose: () => void;
  onAddTransactions: (entries: InstallmentEntry[]) => void;
  section: string;
}

const SECTION_META: Record<string, { title: string; icon: ReactNode }> = {
  report: { title: 'گزارش مالی بازه‌ای', icon: <IconReport /> },
  bom: { title: 'گزارش اول ماه (BOM)', icon: <IconBom /> },
  loan: { title: 'وام و اقساط', icon: <IconLoan /> },
  convert: { title: 'تبدیل تاریخ', icon: <IconConvert /> },
  age: { title: 'محاسبه سن', icon: <IconAge /> },
  bio: { title: 'بیوریتم', icon: <IconBio /> },
  bmi: { title: 'شاخص توده بدنی (BMI)', icon: <IconBmi /> },
};

export default function ToolsPanel({ calendarData, currentSystem, currentYear, currentMonth, onClose, onAddTransactions, section }: ToolsPanelProps) {

  // گزارش مالی بازه‌ای
  const [reportStart, setReportStart] = useState<DateValue>(() => todayValue(currentSystem));
  const [reportEnd, setReportEnd] = useState<DateValue>(() => todayValue(currentSystem));

  // تاریخ تولد مشترک بین «سن» و «بیوریتم»
  const [birth, setBirth] = useState<DateValue>(() => {
    const t = getToday(currentSystem);
    return { system: currentSystem, year: t.year - 20, month: t.month, day: t.day };
  });

  // تبدیل تاریخ
  const [convertDate, setConvertDate] = useState<DateValue>(() => todayValue(currentSystem));

  // BMI
  const [height, setHeight] = useState<string>('');
  const [weight, setWeight] = useState<string>('');

  // وام و اقساط
  const [loanType, setLoanType] = useState<'gharz' | 'azad' | 'manual'>('azad');
  const [loanAmount, setLoanAmount] = useState<string>('');
  const [loanRate, setLoanRate] = useState<string>('23');
  const [loanCount, setLoanCount] = useState<string>('12');
  const [loanPeriod, setLoanPeriod] = useState<'monthly' | 'yearly'>('monthly');
  const [loanFirstDue, setLoanFirstDue] = useState<DateValue>(() => todayValue(currentSystem));
  const [loanEdited, setLoanEdited] = useState<number[] | null>(null);
  const [loanSaved, setLoanSaved] = useState<number>(0);

  const report = useMemo(() => {
    const startTs = toDate(reportStart.system, reportStart.year, reportStart.month, reportStart.day).getTime();
    const endTs = toDate(reportEnd.system, reportEnd.year, reportEnd.month, reportEnd.day).getTime() + 86400000 - 1;
    let unpaid = 0, paid = 0, count = 0;
    Object.entries(calendarData).forEach(([key, data]) => {
      const ts = keyToTs(key);
      if (ts >= startTs && ts <= endTs) {
        data.transactions.forEach((t) => {
          count++;
          if (t.isPaid) paid += t.amount; else unpaid += t.amount;
        });
      }
    });
    return { unpaid, paid, count, total: unpaid + paid, invalid: startTs > endTs };
  }, [calendarData, reportStart, reportEnd]);

  const bom = useMemo(() => {
    const startTs = toDate(currentSystem, currentYear, currentMonth, 1).getTime();
    const md = getMonthDays(currentSystem, currentYear, currentMonth);
    const endTs = toDate(currentSystem, currentYear, currentMonth, md).getTime() + 86400000 - 1;
    let opening = 0, added = 0, paidThis = 0, unpaidThis = 0;
    Object.entries(calendarData).forEach(([key, data]) => {
      const ts = keyToTs(key);
      const sumUnpaid = data.transactions.filter((t) => !t.isPaid).reduce((s, t) => s + t.amount, 0);
      if (ts < startTs) {
        opening += sumUnpaid;
      } else if (ts <= endTs) {
        data.transactions.forEach((t) => {
          added += t.amount;
          if (t.isPaid) paidThis += t.amount; else unpaidThis += t.amount;
        });
      }
    });
    return { opening, added, paidThis, unpaidThis, closing: opening + unpaidThis };
  }, [calendarData, currentSystem, currentYear, currentMonth]);

  const converted = useMemo(
    () => convertAll(convertDate.system, convertDate.year, convertDate.month, convertDate.day),
    [convertDate],
  );

  const age = useMemo(() => {
    const b = toDate(birth.system, birth.year, birth.month, birth.day);
    const now = new Date();
    if (b.getTime() > now.getTime()) return null;
    return ageBetween(b, now);
  }, [birth]);

  const bio = useMemo(() => {
    const b = toDate(birth.system, birth.year, birth.month, birth.day);
    const now = new Date();
    if (b.getTime() > now.getTime()) return null;
    return biorhythm(b, now);
  }, [birth]);

  const bmi = useMemo(() => {
    const h = parseFloat(height);
    const w = parseFloat(weight);
    if (!h || !w || h <= 0 || w <= 0) return null;
    const value = w / Math.pow(h / 100, 2);
    let category = '', cls = '';
    if (value < 18.5) { category = 'کم‌وزن'; cls = 'bmi-low'; }
    else if (value < 25) { category = 'طبیعی'; cls = 'bmi-normal'; }
    else if (value < 30) { category = 'اضافه‌وزن'; cls = 'bmi-over'; }
    else { category = 'چاق'; cls = 'bmi-obese'; }
    return { value: value.toFixed(1), category, cls };
  }, [height, weight]);

  const loanTypeLabel = loanType === 'gharz' ? 'قرض‌الحسنه' : loanType === 'azad' ? 'وام آزاد' : 'بدون سود';

  const loan = useMemo(() => {
    const P = parseFloat(onlyDigits(loanAmount));
    const r = parseFloat(loanRate) || 0;
    const n = parseInt(loanCount, 10);
    if (!P || P <= 0 || !n || n <= 0 || n > 600) return null;

    const periodMonths = loanPeriod === 'monthly' ? 1 : 12;
    const years = (n * periodMonths) / 12;

    // محاسبه‌ی مبلغِ کل بر اساس نوع وام
    let total: number;
    if (loanType === 'manual') total = P;                          // تقسیمِ ساده بدون سود
    else if (loanType === 'gharz') total = P + P * 0.04 * years;    // کارمزدِ ۴٪ سالانه
    else total = P + P * (r / 100) * years;                        // وام آزاد با نرخ سود
    const extra = Math.round(total - P);

    // تقسیمِ مساوی با اصلاحِ روندِ آخرین قسط
    const base = Math.round(total / n);
    const baseSchedule: number[] = Array(n).fill(base);
    baseSchedule[n - 1] = Math.round(total) - base * (n - 1);

    // سررسیدِ هر قسط
    const dueKeys: string[] = [];
    const dueLabels: string[] = [];
    const dn = getMonthNames(loanFirstDue.system);
    for (let k = 0; k < n; k++) {
      const sh = shiftMonth(loanFirstDue.system, loanFirstDue.year, loanFirstDue.month, k * periodMonths);
      const md = getMonthDays(loanFirstDue.system, sh.year, sh.month);
      const day = Math.min(loanFirstDue.day, md);
      dueKeys.push(dateKey(loanFirstDue.system, sh.year, sh.month, day));
      dueLabels.push(`${day} ${dn[sh.month]} ${sh.year}`);
    }
    return { n, base, baseSchedule, dueKeys, dueLabels, principal: P, extra, total: Math.round(total) };
  }, [loanType, loanAmount, loanRate, loanCount, loanPeriod, loanFirstDue]);

  // با تغییرِ پارامترها، ویرایش‌های دستی پاک و دوباره از فرمول پر می‌شود
  useEffect(() => { setLoanEdited(null); setLoanSaved(0); }, [loanType, loanAmount, loanRate, loanCount, loanPeriod, loanFirstDue]);

  const loanSchedule = loanEdited ?? loan?.baseSchedule ?? [];
  const loanScheduleTotal = loanSchedule.reduce((s, a) => s + (a || 0), 0);

  const editLoanRow = (i: number, value: string) => {
    const base = loanEdited ?? loan?.baseSchedule ?? [];
    const copy = [...base];
    copy[i] = parseInt(onlyDigits(value), 10) || 0;
    setLoanEdited(copy);
  };

  const submitLoan = () => {
    if (!loan) return;
    const entries: InstallmentEntry[] = loan.dueKeys.map((key, i) => ({
      key,
      title: `قسط ${i + 1} از ${loan.n} - ${loanTypeLabel}`,
      amount: loanSchedule[i] || 0,
    }));
    onAddTransactions(entries);
    setLoanSaved(entries.length);
  };

  const monthNames = getMonthNames(currentSystem);

  const bioRow = (label: string, val: number) => (
    <div className="bio-row">
      <span className="bio-label">{label}</span>
      <div className="bio-track">
        <div
          className={`bio-fill ${val >= 0 ? 'pos' : 'neg'}`}
          style={{ width: `${Math.abs(val) / 2}%`, [val >= 0 ? 'left' : 'right']: '50%' } as React.CSSProperties}
        />
        <div className="bio-mid" />
      </div>
      <span className={`bio-val ${val >= 0 ? 'pos' : 'neg'}`}>{val > 0 ? '+' : ''}{val}%</span>
    </div>
  );

  const calRow = (label: string, c: { year: number; month: number; day: number }, names: string[]) => (
    <div className="tool-result-row">
      <span>{label}</span>
      <strong>{c.day} {names[c.month]} {c.year}</strong>
    </div>
  );

  const meta = SECTION_META[section] ?? SECTION_META.report;

  return (
    <div className="modal" onClick={onClose}>
      <div className="modal-box tool-panel" onClick={(e) => e.stopPropagation()}>
        <div className="tool-panel-head">
          <span className="tool-panel-icon">{meta.icon}</span>
          <h3>{meta.title}</h3>
          <button className="close-modal" onClick={onClose}>✕</button>
        </div>

        <div className="tool-panel-body">
                  {section === 'report' && (
                    <>
                      <label className="field-label">از تاریخ</label>
                      <CalendarDateInput value={reportStart} onChange={setReportStart} />
                      <label className="field-label">تا تاریخ</label>
                      <CalendarDateInput value={reportEnd} onChange={setReportEnd} />
                      {report.invalid ? (
                        <div className="tool-warn">تاریخ شروع باید قبل از پایان باشد</div>
                      ) : (
                        <div className="tool-result">
                          <div className="tool-result-row"><span>تعداد تراکنش‌ها</span><strong>{report.count}</strong></div>
                          <div className="tool-result-row"><span>جمع کل</span><strong>{formatNumber(report.total)} تومان</strong></div>
                          <div className="tool-result-row paid"><span>پرداخت‌شده</span><strong>{formatNumber(report.paid)} تومان</strong></div>
                          <div className="tool-result-row debt"><span>باقی‌مانده (بدهی)</span><strong>{formatNumber(report.unpaid)} تومان</strong></div>
                        </div>
                      )}
                    </>
                  )}

                  {section === 'bom' && (
                    <>
                      <div className="tool-note">
                        مربوط به ماهِ در حال نمایش: <strong>{monthNames[currentMonth]} {currentYear}</strong>
                      </div>
                      <div className="tool-result">
                        <div className="tool-result-row"><span>مانده منتقل‌شده (اول ماه)</span><strong>{formatNumber(bom.opening)} تومان</strong></div>
                        <div className="tool-result-row"><span>ثبت‌شده در این ماه</span><strong>{formatNumber(bom.added)} تومان</strong></div>
                        <div className="tool-result-row paid"><span>پرداخت‌شده این ماه</span><strong>{formatNumber(bom.paidThis)} تومان</strong></div>
                        <div className="tool-result-row debt"><span>بدهی جدید این ماه</span><strong>{formatNumber(bom.unpaidThis)} تومان</strong></div>
                        <div className="tool-result-row closing"><span>مانده پایان ماه</span><strong>{formatNumber(bom.closing)} تومان</strong></div>
                      </div>
                    </>
                  )}

                  {section === 'loan' && (
                    <>
                      <label className="field-label">نوع وام</label>
                      <div className="mini-toggle">
                        <button type="button" className={`mini-toggle-btn ${loanType === 'gharz' ? 'active' : ''}`} onClick={() => setLoanType('gharz')}>قرض‌الحسنه</button>
                        <button type="button" className={`mini-toggle-btn ${loanType === 'azad' ? 'active' : ''}`} onClick={() => setLoanType('azad')}>وام آزاد</button>
                        <button type="button" className={`mini-toggle-btn ${loanType === 'manual' ? 'active' : ''}`} onClick={() => setLoanType('manual')}>بدون سود</button>
                      </div>
                      <div className="tool-note">
                        {loanType === 'gharz' && 'کارمزدِ سالانه ۴٪ روی اصلِ وام'}
                        {loanType === 'azad' && 'سود بر اساس نرخِ سالانه‌ای که وارد می‌کنید'}
                        {loanType === 'manual' && 'اصلِ وام بدون سود، به‌طور مساوی تقسیم می‌شود'}
                      </div>

                      <label className="field-label">مبلغ وام (تومان)</label>
                      <input
                        className="tool-text-input"
                        type="text"
                        inputMode="numeric"
                        dir="ltr"
                        placeholder="مثلاً 100,000,000"
                        value={loanAmount}
                        onChange={(e) => setLoanAmount(withSeparators(e.target.value))}
                      />
                      <div className="loan-grid">
                        {loanType === 'azad' && (
                          <div>
                            <label className="field-label">نرخ سود سالانه ٪</label>
                            <input className="tool-text-input" type="number" inputMode="decimal" dir="ltr" placeholder="23" value={loanRate} onChange={(e) => setLoanRate(e.target.value)} />
                          </div>
                        )}
                        <div>
                          <label className="field-label">تعداد اقساط</label>
                          <input className="tool-text-input" type="number" inputMode="numeric" dir="ltr" placeholder="12" value={loanCount} onChange={(e) => setLoanCount(onlyDigits(e.target.value))} />
                        </div>
                      </div>

                      <label className="field-label">دوره‌ی پرداخت</label>
                      <div className="mini-toggle">
                        <button type="button" className={`mini-toggle-btn ${loanPeriod === 'monthly' ? 'active' : ''}`} onClick={() => setLoanPeriod('monthly')}>ماهانه</button>
                        <button type="button" className={`mini-toggle-btn ${loanPeriod === 'yearly' ? 'active' : ''}`} onClick={() => setLoanPeriod('yearly')}>سالانه</button>
                      </div>

                      <label className="field-label">سررسید اولین قسط</label>
                      <CalendarDateInput value={loanFirstDue} onChange={setLoanFirstDue} />

                      {!loan ? (
                        <div className="tool-note">مبلغ و تعداد اقساط را وارد کنید</div>
                      ) : (
                        <>
                          <div className="tool-result">
                            <div className="tool-result-row"><span>اصلِ وام</span><strong>{formatNumber(loan.principal)} تومان</strong></div>
                            {loanType !== 'manual' && (
                              <div className="tool-result-row debt"><span>{loanType === 'gharz' ? 'کارمزد' : 'سود'}</span><strong>{formatNumber(loan.extra)} تومان</strong></div>
                            )}
                            <div className="tool-result-row closing"><span>مجموع بازپرداخت</span><strong>{formatNumber(loanScheduleTotal)} تومان</strong></div>
                          </div>

                          <div className="loan-sched-head">
                            <span>اقساط ({loan.n})</span>
                            <span className="loan-sched-hint">مبلغ هر قسط قابل ویرایش است</span>
                          </div>
                          <div className="loan-sched">
                            {loanSchedule.map((amt, i) => (
                              <div key={i} className="loan-sched-row">
                                <span className="ls-num">{i + 1}</span>
                                <span className="ls-date">{loan.dueLabels[i]}</span>
                                <input
                                  className="ls-input"
                                  type="text"
                                  inputMode="numeric"
                                  dir="ltr"
                                  value={formatNumber(amt)}
                                  onChange={(e) => editLoanRow(i, e.target.value)}
                                />
                              </div>
                            ))}
                          </div>

                          {loanSaved > 0 ? (
                            <div className="loan-success">✅ {loanSaved} قسط در تقویم ثبت شد</div>
                          ) : (
                            <button className="loan-submit" onClick={submitLoan}>ثبت {loan.n} قسط در تقویم</button>
                          )}
                        </>
                      )}
                    </>
                  )}

                  {section === 'convert' && (
                    <>
                      <label className="field-label">تاریخ را وارد کنید</label>
                      <CalendarDateInput value={convertDate} onChange={setConvertDate} />
                      <div className="tool-result">
                        <div className="tool-result-row"><span>روز هفته</span><strong>{converted.weekday}</strong></div>
                        {calRow('شمسی', converted.jalali, getMonthNames('jalali'))}
                        {calRow('میلادی', converted.gregorian, getMonthNames('gregorian'))}
                        {calRow('قمری', converted.hijri, getMonthNames('hijri'))}
                      </div>
                    </>
                  )}

                  {section === 'age' && (
                    <>
                      <label className="field-label">تاریخ تولد</label>
                      <CalendarDateInput value={birth} onChange={setBirth} />
                      {!age ? (
                        <div className="tool-warn">تاریخ تولد باید قبل از امروز باشد</div>
                      ) : (
                        <div className="tool-result">
                          <div className="tool-result-row big"><span>سن</span><strong>{age.years} سال و {age.months} ماه و {age.days} روز</strong></div>
                          <div className="tool-result-row"><span>مجموع ماه‌ها</span><strong>{formatNumber(age.totalMonths)} ماه</strong></div>
                          <div className="tool-result-row"><span>مجموع هفته‌ها</span><strong>{formatNumber(age.totalWeeks)} هفته</strong></div>
                          <div className="tool-result-row"><span>مجموع روزها</span><strong>{formatNumber(age.totalDays)} روز</strong></div>
                          <div className="tool-result-row"><span>تا تولد بعدی</span><strong>{age.nextBirthdayInDays} روز</strong></div>
                        </div>
                      )}
                    </>
                  )}

                  {section === 'bio' && (
                    <>
                      <label className="field-label">تاریخ تولد</label>
                      <CalendarDateInput value={birth} onChange={setBirth} />
                      {!bio ? (
                        <div className="tool-warn">تاریخ تولد باید قبل از امروز باشد</div>
                      ) : (
                        <div className="tool-result bio-result">
                          {bioRow('جسمی', bio.physical)}
                          {bioRow('احساسی', bio.emotional)}
                          {bioRow('ذهنی', bio.intellectual)}
                          <div className="tool-note">بر اساس {formatNumber(bio.days)} روز زندگی</div>
                        </div>
                      )}
                    </>
                  )}

                  {section === 'bmi' && (
                    <>
                      <div className="bmi-inputs">
                        <input type="number" inputMode="decimal" placeholder="قد (سانتی‌متر)" value={height} onChange={(e) => setHeight(e.target.value)} />
                        <input type="number" inputMode="decimal" placeholder="وزن (کیلوگرم)" value={weight} onChange={(e) => setWeight(e.target.value)} />
                      </div>
                      {!bmi ? (
                        <div className="tool-note">قد و وزن را وارد کنید</div>
                      ) : (
                        <div className="tool-result">
                          <div className="tool-result-row big"><span>BMI</span><strong>{bmi.value}</strong></div>
                          <div className={`bmi-badge ${bmi.cls}`}>{bmi.category}</div>
                        </div>
                      )}
                    </>
                  )}
        </div>
      </div>
    </div>
  );
}
