// صندوقِ سهم‌محورِ قرض‌الحسنه (گردشی) — چند پرداخت در ماه، سهم‌های متفاوت، و گزارشِ حرفه‌ای
import { useEffect, useState } from 'react';

const fmt = (n: number): string => Math.round(n || 0).toLocaleString('en-US');
const digits = (s: string): number => parseInt(s.replace(/[^0-9]/g, ''), 10) || 0;
const withSep = (s: string): string => { const d = digits(s); return d ? d.toLocaleString('en-US') : ''; };

// روندِ مبلغ‌ها برای حذفِ «خرده». هر صندوق می‌تواند روندِ خودکار را خاموش/روشن کند و واحدِ روند را انتخاب کند.
export const FUND_ROUND = 10000;
export const ROUND_UNITS = [1000, 10000, 100000];
// واحدِ مؤثرِ روندِ هر صندوق: اگر روندِ خودکار خاموش باشد ۱ (یعنی بدونِ روند)
const unitOf = (f: { autoRound?: boolean; roundUnit?: number }): number => (f.autoRound === false ? 1 : (f.roundUnit || FUND_ROUND));
const floorUnit = (n: number, unit: number): number => (unit > 1 ? Math.floor((n || 0) / unit) * unit : Math.floor(n || 0));
// آیا مبلغ «خرده» دارد؟ (مضربِ ۱۰٬۰۰۰ نیست)
const hasFraction = (n: number): boolean => Math.round(n || 0) % FUND_ROUND !== 0;

export interface FundMember { name: string; phone?: string; shares: number; }
export interface FundRound { paid: { [m: string]: boolean }; winners: string[]; pay?: number; }
export interface Fund { id: string; name: string; monthlyAmount: number; payoutsPerMonth: number; members: FundMember[]; rounds: FundRound[]; carry?: number; autoRound?: boolean; roundUnit?: number; }

// پیش‌بینیِ نوبت‌های آینده: از وضعیتِ فعلی جلو می‌رود و تعدادِ برنده‌ی هر ماه را می‌دهد (قطعی، مستقل از قرعه)
function forecastRounds(f: Fund): { month: number; winners: number; extra: number }[] {
  const ts = totalSharesOf(f);
  const coll = f.monthlyAmount * ts;
  const unit = unitOf(f);
  const basePay = floorUnit(coll / f.payoutsPerMonth, unit);
  if (basePay <= 0 || ts <= 0) return [];
  let drawn = f.rounds.reduce((c, r) => c + r.winners.length, 0);
  let carry = f.carry || 0;
  let month = f.rounds.filter((r) => r.winners.length > 0).length; // نوبت‌های انجام‌شده
  const out: { month: number; winners: number; extra: number }[] = [];
  let guard = 0;
  while (drawn < ts && guard++ < 1000) {
    const remaining = ts - drawn;
    const avail = carry + coll;
    let n = Math.min(f.payoutsPerMonth + Math.floor(carry / basePay), remaining);
    if (n < 1) n = 1;
    const isFinal = n >= remaining;
    const pay = isFinal ? Math.max(basePay, floorUnit(avail / n, unit)) : basePay;
    carry = Math.max(0, avail - n * pay);
    drawn += n; month += 1;
    out.push({ month, winners: n, extra: Math.max(0, n - f.payoutsPerMonth) });
  }
  return out;
}

interface Props {
  funds: Fund[];
  onChange: (f: Fund[]) => void;
  onClose: () => void;
  confirm: (msg: string, onYes: () => void) => void;
  onShare: (text: string) => void;
  onAddDeposits: (fundName: string, amount: number, count: number) => void;
  startInReport?: boolean;
}

const waNumber = (raw: string): string => {
  let d = (raw || '').replace(/[^0-9]/g, '');
  if (d.startsWith('0098')) d = d.slice(2);
  if (d.startsWith('98')) return d;
  if (d.startsWith('0')) return '98' + d.slice(1);
  return d;
};

// شمارشِ تعدادِ بردِ هر عضو تا کنون
const wonCount = (f: Fund, name: string) => f.rounds.reduce((c, r) => c + r.winners.filter((w) => w === name).length, 0);
const totalSharesOf = (f: Fund) => f.members.reduce((s, m) => s + m.shares, 0);

export default function FundPanel({ funds, onChange, onClose, confirm, onShare, onAddDeposits, startInReport }: Props) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [view, setView] = useState<'round' | 'report'>('round');
  const [notifyFor, setNotifyFor] = useState<string | null>(null);
  const [drawMsg, setDrawMsg] = useState<string | null>(null);
  const [showGuide, setShowGuide] = useState(false);
  const [gi, setGi] = useState(0);

  // فرم ساخت
  const [newName, setNewName] = useState('');
  const [newAmount, setNewAmount] = useState('');
  const [newPayouts, setNewPayouts] = useState('1');
  const [members, setMembers] = useState<FundMember[]>([]);
  const [mName, setMName] = useState('');
  const [mPhone, setMPhone] = useState('');
  const [mShares, setMShares] = useState('1');
  // حالتِ پیشرفته: روندِ خودکار (پیش‌فرض روشن) و واحدِ روند
  const [showAdv, setShowAdv] = useState(false);
  const [newAutoRound, setNewAutoRound] = useState(true);
  const [newRoundUnit, setNewRoundUnit] = useState(FUND_ROUND);

  // ماشین‌حسابِ صندوق
  const [calcShareAmt, setCalcShareAmt] = useState('');
  const [calcShares, setCalcShares] = useState('');
  const [calcPayouts, setCalcPayouts] = useState('');

  useEffect(() => {
    if (startInReport && funds.length === 1) { setSelectedId(funds[0].id); setView('report'); }
  }, [startInReport]);

  // آموزشِ صندوق در اولین باز شدنِ بخش (پیش از ساختِ صندوق)
  useEffect(() => {
    if (!startInReport && !localStorage.getItem('fundGuideSeen')) { setGi(0); setShowGuide(true); }
  }, []);

  const openGuide = () => { setGi(0); setShowGuide(true); };
  const closeGuide = () => { setShowGuide(false); localStorage.setItem('fundGuideSeen', '1'); };

  const GUIDE: { icon: string; title: string; text: string }[] = [
    { icon: '🤝', title: 'صندوقِ قرض‌الحسنه چیست؟', text: 'یک صندوقِ گردشیِ بدونِ سود؛ هر ماه همه واریز می‌کنند و نوبتی یک یا چند نفر کلِ مبلغ را می‌گیرند. مثلِ قرض‌دادنِ دوره‌ای بینِ اعضا.' },
    { icon: '🎟️', title: 'سهم', text: 'هر عضو می‌تواند یک یا چند «سهم» داشته باشد. هر سهم یعنی یک واریزیِ ماهانه و یک نوبتِ دریافت؛ پس کسی که سهمِ بیشتری دارد، بیشتر می‌دهد و بیشتر دریافت می‌کند.' },
    { icon: '➕', title: 'ساختِ صندوق', text: 'نامِ صندوق، «واریزیِ هر سهم در ماه» و «تعدادِ پرداخت در ماه» را وارد کنید؛ سپس اعضا را با نام، شماره (اختیاری) و تعدادِ سهم اضافه کنید.' },
    { icon: '✅', title: 'هر ماه', text: 'واریزیِ اعضا را با زدن روی نامشان تیک بزنید. وقتی همه واریز کردند، دکمه‌ی «قرعه‌کشی» فعال می‌شود و برندگانِ آن ماه نسبت به سهم‌ها انتخاب می‌شوند.' },
    { icon: '💰', title: 'پرداختِ گِرد و مانده‌ی صندوق', text: 'برای اینکه «خرده‌پرداختی» نداشته باشید، مبلغِ هر برنده به نزدیک‌ترین ۱۰٬۰۰۰ تومان گِرد می‌شود و ته‌مانده‌ها در «مانده‌ی صندوق» جمع می‌شوند. هر وقت مانده به‌اندازه‌ی یک پرداختِ کامل رسید، آن ماه یک برنده‌ی اضافه قرعه می‌خورد؛ و در ماهِ آخر تمامِ مانده بینِ برنده‌ها پخش می‌شود تا پولی در صندوق نماند.' },
    { icon: '⚙️', title: 'حالتِ پیشرفته (روندِ دلخواه)', text: 'هنگامِ ساختِ صندوق در «تنظیماتِ پیشرفته» می‌توانید روندِ خودکار را روشن/خاموش کنید و واحدِ روند را ۱٬۰۰۰ یا ۱۰٬۰۰۰ یا ۱۰۰٬۰۰۰ بگذارید. اگر روند را خاموش کنید و مبلغی خرده داشته باشد، خودِ برنامه پیغام می‌دهد و با یک دکمه می‌توانید گِردش کنید. این تنظیم را بعداً هم در «گزارشِ کامل» می‌توانید عوض کنید.' },
    { icon: '🔮', title: 'پیش‌بینیِ نوبت‌های پرشلوغ', text: 'در «گزارشِ کامل» بخشِ «پیش‌بینیِ نوبت‌های پرشلوغ» از پیش می‌گوید کدام ماه‌های آینده برنده‌ی اضافه خواهند داشت و هرکدام چند نفر؛ تا غافلگیر نشوید.' },
    { icon: '📊', title: 'گزارش و معوقات', text: 'در تبِ «گزارشِ کامل» می‌بینید هر نفر چقدر داده، چقدر گرفته، مانده‌ی صندوق چقدر است، کدام ماه‌ها پرداختِ اضافه داشته‌ایم و چند نفر بدهیِ معوق دارند.' },
    { icon: '📤', title: 'یادآوری به اعضا', text: 'با دکمه‌ی کنارِ هر عضو، پیامِ آماده‌ی یادآوریِ پرداخت را با واتساپ، پیامک یا اشتراک‌گذاری (ایتا/تلگرام) برایش بفرستید.' },
    { icon: '🧮', title: 'ماشین‌حساب', text: 'اگر نمی‌دانید چه اعدادی بگذارید، از «ماشین‌حسابِ صندوق» در همین صفحه کمک بگیرید.' },
  ];

  const renderGuide = () => {
    if (!showGuide) return null;
    const s = GUIDE[gi];
    const last = gi === GUIDE.length - 1;
    return (
      <div className="onb fund-guide-overlay">
        <button className="onb-skip" onClick={closeGuide}>رد کردن</button>
        <div className="onb-card" key={gi}>
          <div className="onb-icon">{s.icon}</div>
          <h2 className="onb-title">{s.title}</h2>
          <p className="onb-text">{s.text}</p>
        </div>
        <div className="onb-bottom">
          <div className="onb-dots">{GUIDE.map((_, k) => <span key={k} className={`onb-dot ${k === gi ? 'active' : ''}`} />)}</div>
          <button className="onb-next" onClick={() => (last ? closeGuide() : setGi(gi + 1))}>{last ? 'تمام' : 'بعدی'}</button>
        </div>
      </div>
    );
  };
  const fund = funds.find((f) => f.id === selectedId) || null;
  const update = (id: string, fn: (f: Fund) => Fund) => onChange(funds.map((f) => (f.id === id ? fn(f) : f)));

  const addMember = () => {
    const n = mName.trim();
    if (!n || members.some((x) => x.name === n)) return;
    setMembers([...members, { name: n, phone: mPhone.trim() || undefined, shares: Math.max(1, digits(mShares) || 1) }]);
    setMName(''); setMPhone(''); setMShares('1');
  };

  const createFund = () => {
    const amt = digits(newAmount);
    const payouts = Math.max(1, digits(newPayouts) || 1);
    if (!newName.trim() || !amt || members.length < 2) return;
    const f: Fund = { id: `fund-${Date.now()}`, name: newName.trim(), monthlyAmount: amt, payoutsPerMonth: payouts, members: [...members], rounds: [{ paid: {}, winners: [] }], carry: 0, autoRound: newAutoRound, roundUnit: newRoundUnit };
    onChange([...funds, f]);
    setCreating(false); setNewName(''); setNewAmount(''); setNewPayouts('1'); setMembers([]); setMName(''); setMPhone(''); setMShares('1');
    setShowAdv(false); setNewAutoRound(true); setNewRoundUnit(FUND_ROUND);
    setSelectedId(f.id);
  };

  const togglePaid = (name: string) => {
    if (!fund) return;
    update(fund.id, (f) => {
      const rounds = f.rounds.slice();
      const cur = { ...rounds[rounds.length - 1] };
      cur.paid = { ...cur.paid, [name]: !cur.paid[name] };
      rounds[rounds.length - 1] = cur;
      return { ...f, rounds };
    });
  };

  const draw = () => {
    if (!fund) return;
    const ts = totalSharesOf(fund);
    const coll = fund.monthlyAmount * ts;            // جمع‌آوریِ این ماه (همه می‌پردازند)
    const unit = unitOf(fund);
    const basePay = floorUnit(coll / fund.payoutsPerMonth, unit); // پرداختِ هر برنده (در صورتِ روند، گِرد)
    if (basePay <= 0) return;
    const drawn = fund.rounds.reduce((c, r) => c + r.winners.length, 0);
    const remaining = ts - drawn;                    // سهم‌های قرعه‌نخورده
    if (remaining <= 0) return;
    const carry = fund.carry || 0;                   // مانده‌ی جمع‌شده‌ی صندوق
    const avail = carry + coll;
    // تعدادِ برنده‌ها: پایه + برنده‌های اضافه از محلِ مانده، محدود به سهمِ باقی‌مانده
    let n = Math.min(fund.payoutsPerMonth + Math.floor(carry / basePay), remaining);
    if (n < 1) n = 1;
    const isFinal = n >= remaining;                  // این ماه آخرین سهم‌ها قرعه می‌خورند
    // در ماهِ آخر کلِ مانده بینِ برنده‌ها پخش می‌شود تا پولی در صندوق نماند
    const pay = isFinal ? Math.max(basePay, floorUnit(avail / n, unit)) : basePay;
    const newCarry = Math.max(0, avail - n * pay);

    const pool: string[] = [];
    fund.members.forEach((m) => { const rem = m.shares - wonCount(fund, m.name); for (let i = 0; i < rem; i++) pool.push(m.name); });
    for (let i = pool.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [pool[i], pool[j]] = [pool[j], pool[i]]; }
    const winners = pool.slice(0, n);
    const counts: { [k: string]: number } = {};
    winners.forEach((w) => { counts[w] = (counts[w] || 0) + 1; });
    setDrawMsg(Object.entries(counts).map(([k, c]) => (c > 1 ? `${k} (${c}×)` : k)).join('، '));
    update(fund.id, (f) => {
      const rounds = f.rounds.slice();
      rounds[rounds.length - 1] = { ...rounds[rounds.length - 1], winners, pay };
      const drawnTotal = rounds.reduce((c, r) => c + r.winners.length, 0);
      if (drawnTotal < totalSharesOf(f)) rounds.push({ paid: {}, winners: [] });
      return { ...f, rounds, carry: newCarry };
    });
  };

  const deleteFund = (id: string) => confirm('این صندوق حذف شود؟', () => { onChange(funds.filter((f) => f.id !== id)); setSelectedId(null); });

  const payMessage = (f: Fund, m: FundMember) =>
    `سلام ${m.name} عزیز،\nوقتِ واریزیِ صندوق «${f.name}» رسیده است.\nسهم: ${m.shares} · مبلغ: ${fmt(f.monthlyAmount * m.shares)} تومان\nلطفاً در اولین فرصت واریز کنید. 🙏`;

  // ---------- جزئیاتِ صندوق ----------
  if (fund) {
    const totalShares = totalSharesOf(fund);
    const collection = fund.monthlyAmount * totalShares;
    const unit = unitOf(fund);
    const exactPayout = collection / fund.payoutsPerMonth;       // مبلغِ دقیق (بدونِ روند)
    const payout = floorUnit(exactPayout, unit);                 // پرداختِ هر برنده (در صورتِ روند، گِرد)
    const roundOff = fund.autoRound === false;                   // روندِ خودکار خاموش است
    const needsRound = roundOff && hasFraction(payout);          // خرده دارد و روند خاموش است
    const carry = fund.carry || 0;                              // مانده‌ی جمع‌شده‌ی صندوق
    const totalMonths = Math.ceil(totalShares / fund.payoutsPerMonth);
    const drawnTotal = fund.rounds.reduce((c, r) => c + r.winners.length, 0);
    const cur = fund.rounds[fund.rounds.length - 1];
    const inProgress = cur.winners.length === 0;
    const allPaid = inProgress && fund.members.every((m) => cur.paid[m.name]);
    const monthNo = fund.rounds.length;
    const finished = drawnTotal >= totalShares;
    const unpaidThis = fund.members.filter((m) => !cur.paid[m.name]).length;
    // برنده‌های پیش‌بینی‌شده‌ی این ماه (پایه + اضافه از محلِ مانده)
    const remainingShares = totalShares - drawnTotal;
    const projectedWinners = payout > 0 ? Math.min(fund.payoutsPerMonth + Math.floor(carry / payout), remainingShares) : 0;
    const extraWinners = Math.max(0, projectedWinners - Math.min(fund.payoutsPerMonth, remainingShares));
    // معوقاتِ ماه‌های قبل
    const arrearsMembers = fund.members.map((m) => ({ m, unpaid: fund.rounds.filter((r) => !r.paid[m.name]).length })).filter((x) => x.unpaid > 0);
    // ماه‌هایی که پرداختِ اضافه داشتند (بیش از حدِ پایه)
    const extraMonths = fund.rounds.map((r, i) => ({ i, extra: r.winners.length - fund.payoutsPerMonth, count: r.winners.length })).filter((x) => x.extra > 0);
    // پیش‌بینیِ نوبت‌های آینده که نفراتشان زیاد می‌شود
    const forecast = forecastRounds(fund);
    const forecastExtra = forecast.filter((x) => x.extra > 0);

    return (
      <>
      <div className="modal" onClick={onClose}>
        <div className="modal-box tool-panel" onClick={(e) => e.stopPropagation()}>
          <div className="tool-panel-head">
            <button className="close-modal" onClick={() => { setSelectedId(null); setDrawMsg(null); setView('round'); }}>‹</button>
            <h3>{fund.name}</h3>
            <button className="close-modal" onClick={onClose}>✕</button>
          </div>
          <div className="tool-panel-body">
            <div className="mini-toggle fund-tabs">
              <button type="button" className={`mini-toggle-btn ${view === 'round' ? 'active' : ''}`} onClick={() => setView('round')}>ماهِ جاری</button>
              <button type="button" className={`mini-toggle-btn ${view === 'report' ? 'active' : ''}`} onClick={() => setView('report')}>گزارشِ کامل</button>
            </div>

            <div className="tool-result">
              <div className="tool-result-row"><span>واریزی هر سهم در ماه</span><strong>{fmt(fund.monthlyAmount)} تومان</strong></div>
              <div className="tool-result-row"><span>کلِ سهم‌ها · پرداخت در ماه</span><strong>{totalShares} سهم · {fund.payoutsPerMonth} نفر</strong></div>
              <div className="tool-result-row"><span>جمع‌آوریِ ماهانه</span><strong>{fmt(collection)} تومان</strong></div>
              <div className="tool-result-row"><span>مبلغِ هر پرداخت {roundOff ? '(بدونِ روند)' : `(گِرد به ${fmt(unit)})`}</span><strong>{fmt(payout)} تومان</strong></div>
              <div className="tool-result-row closing"><span>مانده‌ی صندوق</span><strong>{fmt(carry)} تومان</strong></div>
            </div>

            {needsRound && (
              <div className="fund-roundask">
                <span>⚠️ مبلغِ هر پرداخت خرده دارد: <strong>{fmt(payout)}</strong> تومان. می‌خواهید گِرد شود؟</span>
                <button className="fund-roundask-btn" onClick={() => update(fund.id, (f) => ({ ...f, autoRound: true, roundUnit: f.roundUnit || FUND_ROUND }))}>روندش کن به ۱۰٬۰۰۰</button>
              </div>
            )}

            {view === 'round' ? (
              <>
                {drawMsg && <div className="fund-draw">🎉 برندگانِ این ماه: <strong>{drawMsg}</strong></div>}
                {finished ? (
                  <div className="loan-success">✅ همه‌ی سهم‌ها پرداخت شد؛ دوره‌ی صندوق کامل شد</div>
                ) : (
                  <>
                    <div className="loan-sched-head">
                      <span>ماهِ {monthNo} از {totalMonths} — واریزی‌ها</span>
                      <span className="loan-sched-hint">{unpaidThis > 0 ? `${unpaidThis} نفر پرداخت‌نکرده` : 'همه پرداخت کردند'}</span>
                    </div>
                    <div className="fund-members">
                      {fund.members.map((m) => {
                        const won = wonCount(fund, m.name);
                        return (
                          <div key={m.name} className={`fund-member ${cur.paid[m.name] ? 'paid' : ''}`}>
                            <button className="fm-main" onClick={() => togglePaid(m.name)}>
                              <span className="fm-check">{cur.paid[m.name] ? '✓' : '○'}</span>
                              <span className="fm-name">{m.name} <span className="fm-shares">{m.shares} سهم{won > 0 ? ` · ${won}🏆` : ''}</span></span>
                              <span className="fm-amt">{fmt(fund.monthlyAmount * m.shares)}</span>
                            </button>
                            <button className="fm-notify" title="یادآوریِ پرداخت" onClick={() => setNotifyFor(m.name)}>📤</button>
                          </div>
                        );
                      })}
                    </div>
                    {allPaid && extraWinners > 0 && (
                      <div className="fund-draw">💰 مانده‌ی صندوق به یک پرداختِ کامل رسید: این ماه <strong>{extraWinners} برنده‌ی اضافه</strong> قرعه می‌خورد.</div>
                    )}
                    <button className="loan-submit fund-draw-btn" disabled={!allPaid} onClick={draw}>
                      {allPaid ? `قرعه‌کشیِ ماه (${projectedWinners} برنده${extraWinners > 0 ? ` · +${extraWinners} از مانده` : ''})` : 'تا همه واریز نکنند قرعه‌کشی فعال نیست'}
                    </button>
                  </>
                )}
              </>
            ) : (
              <>
                <div className="fund-help">
                  هر ماه <strong>{fmt(collection)}</strong> جمع و بین <strong>{fund.payoutsPerMonth}</strong> برنده تقسیم می‌شود (هرکدام {fmt(payout)}{roundOff ? '، بدونِ روند' : `، گِرد به ${fmt(unit)} بدونِ خرده`}).
                  دوره <strong>{totalMonths} ماه</strong> است و هر سهم یک‌بار دریافت می‌کند. بدون سود. ته‌مانده‌ها در مانده‌ی صندوق جمع و به‌صورتِ برنده‌ی اضافه پخش می‌شوند.
                </div>

                <div className="loan-sched-head"><span>روندِ مبلغ‌ها</span><span className="loan-sched-hint">حالتِ پیشرفته</span></div>
                <div className="fund-setting-row">
                  <label className="fund-switch">
                    <input type="checkbox" checked={fund.autoRound !== false} onChange={(e) => update(fund.id, (f) => ({ ...f, autoRound: e.target.checked, roundUnit: f.roundUnit || FUND_ROUND }))} />
                    <span>روندِ خودکار (حذفِ خرده)</span>
                  </label>
                  {fund.autoRound !== false && (
                    <div className="fund-unit-pick">
                      {ROUND_UNITS.map((u) => (
                        <button key={u} type="button" className={`fund-unit-btn ${unit === u ? 'active' : ''}`} onClick={() => update(fund.id, (f) => ({ ...f, roundUnit: u }))}>{fmt(u)}</button>
                      ))}
                    </div>
                  )}
                </div>

                <div className="loan-sched-head"><span>مانده‌ی صندوق</span><span className="loan-sched-hint">{carry > 0 ? 'منتظرِ پرداختِ بعدی' : 'خالی'}</span></div>
                <div className="tool-result">
                  <div className="tool-result-row closing"><span>پولِ جمع‌شده در صندوق</span><strong>{fmt(carry)} تومان</strong></div>
                </div>

                <div className="loan-sched-head"><span>پیش‌بینیِ نوبت‌های پرشلوغ</span><span className="loan-sched-hint">{forecastExtra.length ? `${forecastExtra.length} نوبت` : 'ندارد'}</span></div>
                {forecastExtra.length === 0 ? (
                  <div className="tool-note">طبقِ روالِ فعلی، نوبتِ آینده‌ای با برنده‌ی اضافه پیش‌بینی نمی‌شود.</div>
                ) : (
                  <div className="tool-result">
                    {forecastExtra.map((x) => (
                      <div key={x.month} className="tool-result-row"><span>ماهِ {x.month} (پیش‌بینی)</span><strong>{x.winners} برنده (+{x.extra} اضافه)</strong></div>
                    ))}
                  </div>
                )}

                <div className="loan-sched-head"><span>پرداخت‌های اضافه (انجام‌شده)</span><span className="loan-sched-hint">{extraMonths.length} ماه</span></div>
                {extraMonths.length === 0 ? (
                  <div className="tool-note">تا این‌جا ماهی با پرداختِ اضافه نداشته‌ایم.</div>
                ) : (
                  <div className="tool-result">
                    {extraMonths.map((x) => (
                      <div key={x.i} className="tool-result-row"><span>ماهِ {x.i + 1}</span><strong>{x.count} برنده (+{x.extra} اضافه)</strong></div>
                    ))}
                  </div>
                )}

                <div className="loan-sched-head"><span>معوقات</span><span className="loan-sched-hint">{arrearsMembers.length} نفر بدهیِ معوق دارند</span></div>
                {arrearsMembers.length === 0 ? (
                  <div className="loan-success">✅ تا این ماه همه به‌روز هستند</div>
                ) : (
                  <div className="tool-result">
                    {arrearsMembers.map(({ m, unpaid }) => (
                      <div key={m.name} className="tool-result-row debt"><span>{m.name} — {unpaid} ماه</span><strong>{fmt(unpaid * fund.monthlyAmount * m.shares)} تومان</strong></div>
                    ))}
                  </div>
                )}

                <div className="loan-sched-head"><span>وضعیتِ هر عضو</span></div>
                <div className="loan-detail-list">
                  {fund.members.map((m) => {
                    const paidMonths = fund.rounds.filter((r) => r.paid[m.name]).length;
                    const due = fund.rounds.length;
                    // دریافتیِ واقعی بر اساسِ پرداختِ هر ماه (ماهِ آخر ممکن است بیشتر باشد)
                    const received = fund.rounds.reduce((s, r) => s + r.winners.filter((w) => w === m.name).length * (r.pay ?? payout), 0);
                    const remShares = m.shares - wonCount(fund, m.name);
                    return (
                      <div key={m.name} className="loan-detail-row">
                        <div className="ld-info">
                          <span className="ld-amt">{m.name} <span className="fm-shares">{m.shares} سهم</span></span>
                          <span className="ld-date">پرداخت: {paidMonths}/{due} ماه · دریافتی: {fmt(received)} · سهمِ مانده: {remShares}</span>
                        </div>
                      </div>
                    );
                  })}
                </div>
                <button className="loan-submit" onClick={() => onAddDeposits(fund.name, fund.monthlyAmount, Math.max(1, totalMonths - fund.rounds.filter((r) => r.winners.length > 0).length))}>
                  افزودنِ یادآورِ واریزی (هر سهم) به تقویم
                </button>
              </>
            )}

            <button className="fund-guide-btn" onClick={openGuide}>🎓 نمایشِ دوباره‌ی آموزش</button>
            <button className="fund-delete" onClick={() => deleteFund(fund.id)}>حذف صندوق</button>
          </div>

          {notifyFor && (() => {
            const m = fund.members.find((x) => x.name === notifyFor)!;
            const phone = m.phone || '';
            const msg = payMessage(fund, m);
            const enc = encodeURIComponent(msg);
            return (
              <div className="notify-sheet" onClick={() => setNotifyFor(null)}>
                <div className="notify-box" onClick={(e) => e.stopPropagation()}>
                  <div className="notify-title">یادآوریِ پرداخت به {m.name}</div>
                  <div className="notify-msg">{msg}</div>
                  <a className="notify-btn wa" href={`https://wa.me/${phone ? waNumber(phone) : ''}?text=${enc}`} target="_blank" rel="noopener noreferrer" onClick={() => setNotifyFor(null)}>واتساپ</a>
                  <a className="notify-btn sms" href={`sms:${phone}?body=${enc}`} onClick={() => setNotifyFor(null)}>پیامک</a>
                  <button className="notify-btn share" onClick={() => { onShare(msg); setNotifyFor(null); }}>اشتراک‌گذاری (ایتا، تلگرام، …)</button>
                  <button className="notify-btn cancel" onClick={() => setNotifyFor(null)}>انصراف</button>
                </div>
              </div>
            );
          })()}
        </div>
      </div>
      {renderGuide()}
    </>
    );
  }

  // ---------- ساختِ صندوق جدید ----------
  if (creating) {
    return (
      <div className="modal" onClick={onClose}>
        <div className="modal-box tool-panel" onClick={(e) => e.stopPropagation()}>
          <div className="tool-panel-head">
            <button className="close-modal" onClick={() => setCreating(false)}>‹</button>
            <h3>صندوق جدید</h3>
            <button className="close-modal" onClick={onClose}>✕</button>
          </div>
          <div className="tool-panel-body">
            <label className="field-label">نام صندوق</label>
            <input className="tool-text-input" type="text" placeholder="مثلاً صندوق فامیلی" value={newName} onChange={(e) => setNewName(e.target.value)} />
            <div className="loan-grid">
              <div>
                <label className="field-label">واریزیِ هر سهم در ماه</label>
                <input className="tool-text-input" type="text" inputMode="numeric" dir="ltr" placeholder="1,000,000" value={newAmount} onChange={(e) => setNewAmount(withSep(e.target.value))} />
              </div>
              <div>
                <label className="field-label">پرداخت در ماه (نفر)</label>
                <input className="tool-text-input" type="number" inputMode="numeric" dir="ltr" placeholder="6" value={newPayouts} onChange={(e) => setNewPayouts(e.target.value.replace(/[^0-9]/g, ''))} />
              </div>
            </div>

            <label className="field-label">افزودن عضو</label>
            <input className="tool-text-input" type="text" placeholder="نام عضو" value={mName} onChange={(e) => setMName(e.target.value)} />
            <div className="loan-grid" style={{ marginTop: 8 }}>
              <div>
                <input className="tool-text-input" type="tel" inputMode="tel" dir="ltr" placeholder="شماره (اختیاری)" value={mPhone} onChange={(e) => setMPhone(e.target.value)} />
              </div>
              <div className="fund-add-row">
                <input className="tool-text-input" type="number" inputMode="numeric" dir="ltr" placeholder="سهم" value={mShares} onChange={(e) => setMShares(e.target.value.replace(/[^0-9]/g, ''))} />
                <button className="fund-add-btn" onClick={addMember}>+</button>
              </div>
            </div>
            <div className="fund-chips">
              {members.map((m) => (
                <span key={m.name} className="fund-chip" onClick={() => setMembers(members.filter((x) => x.name !== m.name))}>
                  {m.name} · {m.shares}سهم{m.phone ? ' ☎' : ''} ✕
                </span>
              ))}
            </div>
            {members.length < 2 && <div className="tool-note">حداقل ۲ عضو اضافه کنید (هر عضو می‌تواند چند سهم داشته باشد)</div>}

            <button type="button" className="fund-adv-toggle" onClick={() => setShowAdv((v) => !v)}>
              {showAdv ? '▾' : '▸'} تنظیماتِ پیشرفته
            </button>
            {showAdv && (
              <div className="fund-adv">
                <label className="fund-switch">
                  <input type="checkbox" checked={newAutoRound} onChange={(e) => setNewAutoRound(e.target.checked)} />
                  <span>روندِ خودکارِ مبلغ‌ها (حذفِ خرده)</span>
                </label>
                {newAutoRound ? (
                  <>
                    <label className="field-label">واحدِ روند</label>
                    <div className="fund-unit-pick">
                      {ROUND_UNITS.map((u) => (
                        <button key={u} type="button" className={`fund-unit-btn ${newRoundUnit === u ? 'active' : ''}`} onClick={() => setNewRoundUnit(u)}>{fmt(u)}</button>
                      ))}
                    </div>
                    <div className="tool-note">مبلغِ هر پرداخت به این مقدار گِرد می‌شود و ته‌مانده در صندوق جمع و به‌صورتِ برنده‌ی اضافه پخش می‌شود.</div>
                  </>
                ) : (
                  <div className="tool-note">روند خاموش است؛ اگر مبلغی خرده داشته باشد، در صفحه‌ی صندوق پیغام می‌آید و می‌توانید همان‌جا روندش کنید.</div>
                )}
              </div>
            )}

            <button className="loan-submit" disabled={!newName.trim() || !digits(newAmount) || members.length < 2} onClick={createFund}>ساختِ صندوق</button>
          </div>
        </div>
      </div>
    );
  }

  // ---------- فهرستِ صندوق‌ها ----------
  return (
    <>
    <div className="modal" onClick={onClose}>
      <div className="modal-box tool-panel" onClick={(e) => e.stopPropagation()}>
        <div className="tool-panel-head">
          <button className="tool-panel-icon fund-guide-icon" title="آموزشِ کار با صندوق" onClick={openGuide}>🎓</button>
          <h3>{startInReport ? 'گزارش صندوق' : 'صندوق خانوادگی'}</h3>
          <button className="close-modal" onClick={onClose}>✕</button>
        </div>
        <div className="tool-panel-body">
          {!startInReport && (
            <button className="fund-guide-banner" onClick={openGuide}>
              <span>🎓</span>
              <span>آموزشِ کار با صندوق — قبل از شروع این را بخوانید</span>
              <span>›</span>
            </button>
          )}
          {startInReport && funds.length === 0 ? (
            <div className="fund-empty">
              <div className="fund-empty-icon">📭</div>
              <div className="fund-empty-title">هنوز صندوقی ساخته نشده</div>
              <div className="tool-note">برای ساختِ صندوق، از منو وارد بخشِ «صندوق خانوادگی» شوید.</div>
            </div>
          ) : (
            <>
              <div className="tool-note">{startInReport ? 'برای دیدنِ گزارش، صندوق را انتخاب کنید.' : 'صندوقِ قرض‌الحسنه بدون سود؛ هر عضو می‌تواند چند سهم داشته باشد و ماهانه به چند نفر با قرعه‌کشی پرداخت می‌شود.'}</div>
              {funds.map((f) => {
                const ts = totalSharesOf(f);
                const drawn = f.rounds.reduce((c, r) => c + r.winners.length, 0);
                return (
                  <button key={f.id} className="loan-card" onClick={() => { setSelectedId(f.id); setView(startInReport ? 'report' : 'round'); }}>
                    <div className="loan-card-top">
                      <span className="loan-card-name">{f.name}</span>
                      <span className="loan-card-count">{drawn}/{ts} سهم</span>
                    </div>
                    <div className="loan-card-sub">{f.members.length} نفر · {ts} سهم · ماهانه هر سهم {fmt(f.monthlyAmount)}</div>
                  </button>
                );
              })}

              {!startInReport && (
                <>
                  <button className="loan-submit" onClick={() => setCreating(true)}>+ صندوق جدید</button>

                  <div className="loan-sched-head" style={{ marginTop: 18 }}><span>ماشین‌حسابِ صندوق</span></div>
                  <div className="fund-help">واریزیِ هر سهم، تعدادِ کلِ سهم‌ها و تعدادِ پرداخت در ماه را بدهید تا بقیه را حساب کنم.</div>
                  <div className="loan-grid">
                    <div>
                      <label className="field-label">واریزی هر سهم</label>
                      <input className="tool-text-input" type="text" inputMode="numeric" dir="ltr" placeholder="1,000,000" value={calcShareAmt} onChange={(e) => setCalcShareAmt(withSep(e.target.value))} />
                    </div>
                    <div>
                      <label className="field-label">کلِ سهم‌ها</label>
                      <input className="tool-text-input" type="number" inputMode="numeric" dir="ltr" placeholder="12" value={calcShares} onChange={(e) => setCalcShares(e.target.value.replace(/[^0-9]/g, ''))} />
                    </div>
                  </div>
                  <label className="field-label">پرداخت در ماه (نفر)</label>
                  <input className="tool-text-input" type="number" inputMode="numeric" dir="ltr" placeholder="6" value={calcPayouts} onChange={(e) => setCalcPayouts(e.target.value.replace(/[^0-9]/g, ''))} />
                  {(() => {
                    const amt = digits(calcShareAmt);
                    const sh = parseInt(calcShares, 10) || 0;
                    const pay = parseInt(calcPayouts, 10) || 0;
                    if (!amt || sh < 2 || pay < 1) return <div className="tool-note">مقادیر را کامل وارد کنید</div>;
                    const collection = amt * sh;
                    const perWinner = floorUnit(collection / pay, FUND_ROUND);
                    const months = Math.ceil(sh / pay);
                    return (
                      <div className="tool-result">
                        <div className="tool-result-row"><span>جمع‌آوریِ ماهانه</span><strong>{fmt(collection)} تومان</strong></div>
                        <div className="tool-result-row big"><span>مبلغِ هر پرداخت</span><strong>{fmt(perWinner)} تومان</strong></div>
                        <div className="tool-result-row closing"><span>مدتِ دوره</span><strong>{months} ماه</strong></div>
                      </div>
                    );
                  })()}
                </>
              )}
            </>
          )}
        </div>
      </div>
    </div>
    {renderGuide()}
    </>
  );
}
