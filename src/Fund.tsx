// صندوقِ سهم‌محورِ قرض‌الحسنه (گردشی) — چند پرداخت در ماه، سهم‌های متفاوت، و گزارشِ حرفه‌ای
import { useEffect, useState } from 'react';
import { getToday } from './calendar';

const fmt = (n: number): string => Math.round(n || 0).toLocaleString('en-US');
const digits = (s: string): number => parseInt(s.replace(/[^0-9]/g, ''), 10) || 0;
const withSep = (s: string): string => { const d = digits(s); return d ? d.toLocaleString('en-US') : ''; };

// گِرد کردنِ پرداخت‌ها برای حذفِ «خرده». با کلماتِ ساده: بدون / کم / متوسط / زیاد.
export type RoundLevel = 'off' | 'low' | 'mid' | 'high';
export const ROUND_LEVELS: { key: RoundLevel; label: string }[] = [
  { key: 'off', label: 'بدون' }, { key: 'low', label: 'کم' }, { key: 'mid', label: 'متوسط' }, { key: 'high', label: 'زیاد' },
];
const floorUnit = (n: number, unit: number): number => (unit > 1 ? Math.floor((n || 0) / unit) * unit : Math.floor(n || 0));

export interface FundMember { name: string; phone?: string; shares: number; }
export interface FundRound { paid: { [m: string]: boolean }; winners: string[]; pay?: number; }
export interface Fund { id: string; name: string; monthlyAmount: number; payoutsPerMonth: number; members: FundMember[]; rounds: FundRound[]; carry?: number; roundLevel?: RoundLevel; }

// مبلغِ دقیقِ هر پرداخت (بدونِ گِرد)
const exactPayOf = (f: Fund): number => { const c = f.monthlyAmount * totalSharesOf(f); return f.payoutsPerMonth > 0 ? c / f.payoutsPerMonth : 0; };
// واحدِ گِرد برای هر «شدت»: نسبت به بزرگیِ مبلغ انتخاب می‌شود تا عددِ رُند و قابل‌فهم در بیاید
const unitForLevel = (exact: number, level: RoundLevel): number => {
  if (level === 'off' || exact <= 0) return 0;
  const mag = Math.pow(10, Math.floor(Math.log10(exact))); // مثلاً ۱٬۰۰۰٬۰۰۰ برای مبلغِ میلیونی
  if (level === 'low') return Math.max(1000, mag / 100);    // کم  (مثلاً ۱۰٬۰۰۰)
  if (level === 'high') return Math.max(1000, mag / 5);     // زیاد (مثلاً ۲۰۰٬۰۰۰)
  return Math.max(1000, mag / 10);                          // متوسط (مثلاً ۱۰۰٬۰۰۰)
};
// مبلغِ پایه‌ی هر پرداخت: رُند به پایین طبقِ شدت؛ همه برنده‌ها همین مبلغِ یکسان را می‌گیرند
const basePayOf = (f: Fund): number => {
  const exact = exactPayOf(f);
  const unit = unitForLevel(exact, f.roundLevel || 'off');
  return unit > 0 ? floorUnit(exact, unit) : exact;
};

// شبیه‌سازیِ کلِ دوره از وضعیتِ فعلی: همه مبلغِ یکسان می‌گیرند؛ پولِ خرده باعث می‌شود چند نفرِ اضافه (فراتر از سهمشان) برنده شوند؛ فقط خرده‌ی ناچیز نزدِ صاحبِ صندوق می‌ماند
function simulateFund(f: Fund): { schedule: { month: number; winners: number; extra: number }[]; pay: number; ownerKeeps: number } {
  const S = totalSharesOf(f);
  const coll = f.monthlyAmount * S;
  const pay = basePayOf(f);
  const M = f.members.length;
  const schedule: { month: number; winners: number; extra: number }[] = [];
  if (pay <= 0 || S <= 0) return { schedule, pay, ownerKeeps: f.carry || 0 };
  // سهم‌های قرعه‌نخورده‌ی فعلی
  let unwon = f.members.reduce((c, m) => c + Math.max(0, m.shares - Math.min(wonCount(f, m.name), m.shares)), 0);
  let carry = f.carry || 0;
  let month = f.rounds.filter((r) => r.winners.length > 0).length;
  let guard = 0;
  while (guard++ < 3000) {
    const collecting = unwon > 0;                          // تا وقتی سهمِ نخورده هست، همه می‌پردازند
    const avail = carry + (collecting ? coll : 0);
    if (unwon === 0 && avail < pay) break;                 // پولی برای نفرِ اضافه نمانده
    let n = Math.floor(avail / pay);
    if (n < 1) n = 1;
    n = Math.min(n, unwon + M);                            // سقفِ نفراتِ اضافه در هر نوبت
    const base = Math.min(n, unwon);                       // از سهم‌های نخورده
    unwon -= base;
    carry = Math.max(0, avail - n * pay);
    month += 1;
    schedule.push({ month, winners: n, extra: n - base }); // نفراتِ اضافه = فراتر از سهم
    if (unwon === 0 && carry < pay) break;
  }
  return { schedule, pay, ownerKeeps: carry };
}
// سازگاری: فقط برنامه‌ی نوبت‌ها
function forecastRounds(f: Fund): { month: number; winners: number; extra: number }[] { return simulateFund(f).schedule; }

interface Props {
  funds: Fund[];
  onChange: (f: Fund[]) => void;
  onClose: () => void;
  confirm: (msg: string, onYes: () => void) => void;
  onShare: (text: string) => void;
  onAddDeposits: (fundName: string, amount: number, count: number) => void;
  startInReport?: boolean;
  // Accounting hook: posts the fund's cash position as a pass-through journal entry (optional).
  onPostJournal?: (ref: string, date: { y: number; m: number; d: number }, desc: string, spec: { type: 'asset' | 'liability' | 'equity' | 'income' | 'expense'; name?: string; debit?: number; credit?: number }[]) => void;
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

export default function FundPanel({ funds, onChange, onClose, confirm, onShare, onAddDeposits, startInReport, onPostJournal }: Props) {
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
  // گِرد کردنِ پرداخت‌ها (پیش‌فرض: بدون — صندوق‌های معمولی)
  const [newRoundLevel, setNewRoundLevel] = useState<RoundLevel>('off');

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
    { icon: '🔢', title: 'گِرد کردنِ پرداخت‌ها (ساده)', text: 'صندوق‌های معمولی نیازی به گِرد کردن ندارند؛ همان «بدون» را بگذارید. صندوق‌های بزرگ و پرنفر که مبلغ‌هاشان «خرده» دارد و دوره‌شان طولانی است، می‌توانند گِرد کردن را روی «کم / متوسط / زیاد» بگذارند تا همه مبلغِ رُند و یکسان بگیرند و کارِ پرداخت ساده شود.' },
    { icon: '👥', title: 'نفراتِ اضافه (نه پولِ اضافه)', text: 'وقتی خرده‌ها را حذف می‌کنید، پولِ جمع‌شده از خرده‌ها باعث می‌شود چند نفر زودتر برنده شوند (مثلاً یکی وسطِ دوره و یکی آخرِ دوره). یعنی نفراتِ گیرنده بیشتر می‌شوند، نه پولِ کسی. خرده‌ی باقی‌مانده هم نزدِ صاحبِ صندوق می‌ماند.' },
    { icon: '🔮', title: 'پیش‌بینی و پیغام', text: 'همان موقعِ ساختِ صندوق و بعد در «گزارشِ کامل»، برنامه از پیش می‌گوید با این شدت چند نفرِ اضافه و در کدام نوبت‌ها برنده می‌شوند و چقدر خرده نزدِ شما می‌ماند. با «کپیِ پیغام» می‌توانید این خلاصه را بفرستید.' },
    { icon: '📊', title: 'گزارش و معوقات', text: 'در تبِ «گزارشِ کامل» می‌بینید هر نفر چقدر داده، چقدر گرفته، چه نوبت‌هایی پرشلوغ می‌شوند و چند نفر بدهیِ معوق دارند.' },
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
    const f: Fund = { id: `fund-${Date.now()}`, name: newName.trim(), monthlyAmount: amt, payoutsPerMonth: payouts, members: [...members], rounds: [{ paid: {}, winners: [] }], carry: 0, roundLevel: newRoundLevel };
    onChange([...funds, f]);
    setCreating(false); setNewName(''); setNewAmount(''); setNewPayouts('1'); setMembers([]); setMName(''); setMPhone(''); setMShares('1');
    setNewRoundLevel('off');
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
    const pay = basePayOf(fund);                     // مبلغِ یکسانِ هر برنده (رُند)
    if (pay <= 0) return;
    // سهم‌های قرعه‌نخورده
    const pool: string[] = [];
    fund.members.forEach((m) => { const rem = m.shares - Math.min(wonCount(fund, m.name), m.shares); for (let i = 0; i < rem; i++) pool.push(m.name); });
    if (pool.length <= 0) return;
    const carry = fund.carry || 0;                   // پولِ خرده‌ی جمع‌شده
    const avail = carry + coll;
    // تعدادِ برنده‌ها: هرچند نفر که پولش هست (همه مبلغِ برابر)؛ اگر بیش از سهمِ نخورده شد، نفراتِ اضافه برنده می‌شوند
    let n = Math.min(Math.floor(avail / pay), pool.length + fund.members.length);
    if (n < 1) n = 1;
    for (let i = pool.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [pool[i], pool[j]] = [pool[j], pool[i]]; }
    const winners = pool.slice(0, Math.min(n, pool.length));
    if (n > pool.length) {                           // نفراتِ اضافه از محلِ خرده (فراتر از سهم)
      const extraPool = fund.members.map((m) => m.name);
      for (let i = extraPool.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [extraPool[i], extraPool[j]] = [extraPool[j], extraPool[i]]; }
      for (let i = 0; i < n - pool.length; i++) winners.push(extraPool[i % extraPool.length]);
    }
    const newCarry = Math.max(0, avail - winners.length * pay);   // فقط خرده‌ی ناچیز نزدِ صاحبِ صندوق می‌ماند
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
    const level = fund.roundLevel || 'off';
    const exactPayout = collection / fund.payoutsPerMonth;       // مبلغِ دقیق (بدونِ گِرد)
    const payout = basePayOf(fund);                             // مبلغِ یکسانِ هر برنده (رُند)
    const skim = Math.max(0, exactPayout - payout);             // خرده‌ی هر پرداخت
    const carry = fund.carry || 0;                              // پولِ خرده‌ی جمع‌شده
    const totalMonths = Math.ceil(totalShares / fund.payoutsPerMonth);
    const drawnTotal = fund.rounds.reduce((c, r) => c + r.winners.length, 0);
    const cur = fund.rounds[fund.rounds.length - 1];
    const inProgress = cur.winners.length === 0;
    const allPaid = inProgress && fund.members.every((m) => cur.paid[m.name]);
    const monthNo = fund.rounds.length;
    const finished = drawnTotal >= totalShares;
    const unpaidThis = fund.members.filter((m) => !cur.paid[m.name]).length;
    // برنده‌های پیش‌بینی‌شده‌ی این ماه (هرچند نفر که پولش هست؛ مازاد = نفرِ اضافه)
    const unwonNow = fund.members.reduce((c, m) => c + Math.max(0, m.shares - Math.min(wonCount(fund, m.name), m.shares)), 0);
    const projectedWinners = payout > 0 ? Math.min(Math.floor((carry + collection) / payout), unwonNow + fund.members.length) : 0;
    const extraWinners = Math.max(0, projectedWinners - Math.min(unwonNow, projectedWinners));
    // معوقاتِ ماه‌های قبل
    const arrearsMembers = fund.members.map((m) => ({ m, unpaid: fund.rounds.filter((r) => !r.paid[m.name]).length })).filter((x) => x.unpaid > 0);
    // نوبت‌هایی که نفرِ اضافه (فراتر از سهم) داشتند
    const extraMonths = fund.rounds.map((r, i) => { const baseLeft = Math.min(r.winners.length, fund.payoutsPerMonth); return { i, extra: r.winners.length - baseLeft, count: r.winners.length }; }).filter((x) => x.extra > 0);
    // شبیه‌سازیِ کلِ دوره: نوبت‌های پرشلوغ + خرده‌ی نزدِ صاحبِ صندوق
    const sim = simulateFund(fund);
    const forecastExtra = sim.schedule.filter((x) => x.extra > 0);
    const extraTotal = forecastExtra.reduce((s, x) => s + x.extra, 0);
    const placement = forecastExtra.map((x) => `نوبتِ ${x.month}`).join(' و ');
    const doneMonths = fund.rounds.filter((r) => r.winners.length > 0).length;
    const planMonths = doneMonths + sim.schedule.length;        // طولِ کلِ دوره با این شدت
    const setLevel = (lvl: RoundLevel) => update(fund.id, (f) => ({ ...f, roundLevel: lvl }));
    const planMsg = level === 'off'
      ? `گِرد کردن خاموش است؛ هر نفر مبلغِ دقیق می‌گیرد (ممکن است «خرده» داشته باشد).`
      : extraTotal > 0
      ? `هر نفر ${fmt(payout)} تومان (رُند و برابر) می‌گیرد. از محلِ حذفِ خرده، ${extraTotal} نفرِ اضافه برنده می‌شوند (${placement}). دوره ${planMonths} ماه و خرده‌ی نزدِ صاحبِ صندوق فقط ${fmt(sim.ownerKeeps)} تومان است.`
      : `هر نفر ${fmt(payout)} تومان (رُند و برابر) می‌گیرد و دوره ${planMonths} ماه می‌شود. این شدت «نفرِ اضافه» نمی‌سازد (برای نفرِ اضافه شدت را بیشتر کنید). خرده‌ی نزدِ شما: ${fmt(sim.ownerKeeps)} تومان.`;

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
              <div className="tool-result-row"><span>مبلغِ هر پرداخت {level === 'off' ? '(دقیق)' : '(رُند و برابر)'}</span><strong>{fmt(payout)} تومان</strong></div>
              <div className="tool-result-row closing"><span>خرده‌ی نزدِ صاحبِ صندوق</span><strong>{fmt(carry)} تومان</strong></div>
            </div>

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
                      <div className="fund-draw">💰 از محلِ حذفِ خرده، این ماه <strong>{extraWinners} نفرِ اضافه</strong> برنده می‌شوند.</div>
                    )}
                    <button className="loan-submit fund-draw-btn" disabled={!allPaid} onClick={draw}>
                      {allPaid ? `قرعه‌کشیِ ماه (${projectedWinners} برنده${extraWinners > 0 ? ` · +${extraWinners} نفرِ اضافه` : ''})` : 'تا همه واریز نکنند قرعه‌کشی فعال نیست'}
                    </button>
                  </>
                )}
              </>
            ) : (
              <>
                <div className="fund-help">
                  هر ماه <strong>{fmt(collection)}</strong> جمع و بین <strong>{fund.payoutsPerMonth}</strong> نفر تقسیم می‌شود (هرکدام {fmt(payout)} تومان).
                  دوره <strong>{totalMonths} ماه</strong> است و هر سهم یک‌بار دریافت می‌کند. بدون سود.
                </div>

                <div className="loan-sched-head"><span>گِرد کردنِ پرداخت‌ها</span><span className="loan-sched-hint">برای صندوق‌های بزرگ</span></div>
                <div className="fund-levels">
                  {ROUND_LEVELS.map((l) => (
                    <button key={l.key} type="button" className={`fund-level-btn ${level === l.key ? 'active' : ''}`} onClick={() => setLevel(l.key)}>{l.label}</button>
                  ))}
                </div>
                <div className="fund-tuner-msg">{planMsg}</div>
                {level !== 'off' && (
                  <div className="fund-tuner-actions">
                    <button type="button" className="fund-tuner-copy" onClick={() => onShare(planMsg)}>کپیِ پیغام</button>
                  </div>
                )}

                <div className="loan-sched-head"><span>پیش‌بینیِ نوبت‌های پرشلوغ</span><span className="loan-sched-hint">{forecastExtra.length ? `${forecastExtra.length} نوبت` : 'ندارد'}</span></div>
                {forecastExtra.length === 0 ? (
                  <div className="tool-note">{level === 'off' ? 'گِرد کردن خاموش است؛ نوبتِ پرشلوغ نداریم.' : 'با این شدت، نوبتِ اضافه‌ای پیش‌بینی نمی‌شود؛ شدتِ گِرد را بیشتر کنید.'}</div>
                ) : (
                  <div className="tool-result">
                    {forecastExtra.map((x) => (
                      <div key={x.month} className="tool-result-row"><span>ماهِ {x.month} (پیش‌بینی)</span><strong>{x.winners} نفر (+{x.extra} نفرِ اضافه)</strong></div>
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
                    const wins = wonCount(fund, m.name);
                    const remShares = Math.max(0, m.shares - wins);
                    const bonus = Math.max(0, wins - m.shares);                  // بردِ اضافه فراتر از سهم
                    return (
                      <div key={m.name} className="loan-detail-row">
                        <div className="ld-info">
                          <span className="ld-amt">{m.name} <span className="fm-shares">{m.shares} سهم{bonus > 0 ? ` · +${bonus} اضافه` : ''}</span></span>
                          <span className="ld-date">پرداخت: {paidMonths}/{due} ماه · دریافتی: {fmt(received)} · سهمِ مانده: {remShares}</span>
                        </div>
                      </div>
                    );
                  })}
                </div>
                <button className="loan-submit" onClick={() => onAddDeposits(fund.name, fund.monthlyAmount, Math.max(1, totalMonths - fund.rounds.filter((r) => r.winners.length > 0).length))}>
                  افزودنِ یادآورِ واریزی (هر سهم) به تقویم
                </button>
                {onPostJournal && (
                  <button className="acc-addline" onClick={() => {
                    // Pass-through fund accounting: cash held by manager = collected - paid out.
                    const collected = fund.rounds.reduce((s, r) => s + fund.members.reduce((ss, mm) => ss + (r.paid[mm.name] ? fund.monthlyAmount * mm.shares : 0), 0), 0);
                    const paidOut = fund.rounds.reduce((s, r) => s + r.winners.length * (r.pay ?? payout), 0);
                    const net = collected - paidOut; // >0: manager holds members' cash (a liability to them)
                    const t = getToday('jalali');
                    const spec = net >= 0
                      ? [{ type: 'asset' as const, name: 'صندوق (نقد)', debit: net }, { type: 'liability' as const, name: 'سپرده‌ی اعضا', credit: net }]
                      : [{ type: 'liability' as const, name: 'سپرده‌ی اعضا', debit: -net }, { type: 'asset' as const, name: 'صندوق (نقد)', credit: -net }];
                    onPostJournal(`fund-${fund.id}`, { y: t.year, m: t.month, d: t.day }, `صندوقِ ${fund.name}`, spec);
                  }}>🧾 ثبت/به‌روزرسانیِ صندوق در حسابداری</button>
                )}
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
    // پیش‌نمایشِ زنده‌ی گِرد کردن (اگر عضو و مبلغ وارد شده باشد)
    const pvAmt = digits(newAmount);
    const pvReady = pvAmt > 0 && members.length >= 2;
    const pvFund: Fund = { id: '', name: '', monthlyAmount: pvAmt, payoutsPerMonth: Math.max(1, digits(newPayouts) || 1), members, rounds: [{ paid: {}, winners: [] }], carry: 0, roundLevel: newRoundLevel };
    const pv = pvReady ? simulateFund(pvFund) : null;
    const pvExtra = pv ? pv.schedule.filter((x) => x.extra > 0) : [];
    const pvExtraTotal = pvExtra.reduce((s, x) => s + x.extra, 0);
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

            <label className="field-label">گِرد کردنِ پرداخت‌ها (برای صندوق‌های بزرگ)</label>
            <div className="fund-levels">
              {ROUND_LEVELS.map((l) => (
                <button key={l.key} type="button" className={`fund-level-btn ${newRoundLevel === l.key ? 'active' : ''}`} onClick={() => setNewRoundLevel(l.key)}>{l.label}</button>
              ))}
            </div>
            <div className="tool-note">
              {newRoundLevel === 'off'
                ? 'برای صندوق‌های معمولی همین «بدون» خوب است؛ هر نفر مبلغِ دقیق می‌گیرد.'
                : 'خرده‌ی پرداخت‌ها حذف می‌شود تا همه مبلغِ رُند و یکسان بگیرند؛ پولِ خرده باعث می‌شود چند نفر زودتر برنده شوند و خرده‌ی باقی‌مانده نزدِ شما می‌ماند.'}
            </div>
            {pv && newRoundLevel !== 'off' && (
              <div className="fund-tuner-msg">
                هر نفر <strong>{fmt(pv.pay)}</strong> تومان · {pvExtraTotal > 0 ? `${pvExtraTotal} نفرِ اضافه (${pvExtra.map((x) => `نوبتِ ${x.month}`).join(' و ')})` : 'بدونِ نفرِ اضافه'} · خرده‌ی نزدِ شما <strong>{fmt(pv.ownerKeeps)}</strong>
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
                    const perWinner = Math.floor(collection / pay);
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
