// صندوقِ سهم‌محورِ قرض‌الحسنه (گردشی) — چند پرداخت در ماه، سهم‌های متفاوت، و گزارشِ حرفه‌ای
import { useEffect, useState } from 'react';
import CoachTour, { type CoachStep } from './Coach';

const fmt = (n: number): string => Math.round(n || 0).toLocaleString('en-US');
const digits = (s: string): number => parseInt(s.replace(/[^0-9]/g, ''), 10) || 0;
const withSep = (s: string): string => { const d = digits(s); return d ? d.toLocaleString('en-US') : ''; };

export interface FundMember { name: string; phone?: string; shares: number; }
export interface FundRound { paid: { [m: string]: boolean }; winners: string[]; }
export interface Fund { id: string; name: string; monthlyAmount: number; payoutsPerMonth: number; members: FundMember[]; rounds: FundRound[]; }

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
  const [fundTour, setFundTour] = useState(false);

  // فرم ساخت
  const [newName, setNewName] = useState('');
  const [newAmount, setNewAmount] = useState('');
  const [newPayouts, setNewPayouts] = useState('1');
  const [members, setMembers] = useState<FundMember[]>([]);
  const [mName, setMName] = useState('');
  const [mPhone, setMPhone] = useState('');
  const [mShares, setMShares] = useState('1');

  // ماشین‌حسابِ صندوق
  const [calcShareAmt, setCalcShareAmt] = useState('');
  const [calcShares, setCalcShares] = useState('');
  const [calcPayouts, setCalcPayouts] = useState('');

  useEffect(() => {
    if (startInReport && funds.length === 1) { setSelectedId(funds[0].id); setView('report'); }
  }, [startInReport]);

  // آموزشِ تصویریِ صندوق در اولین باز شدنِ یک صندوق
  useEffect(() => {
    if (selectedId && view === 'round' && !localStorage.getItem('fundTourSeen')) {
      const t = setTimeout(() => setFundTour(true), 500);
      return () => clearTimeout(t);
    }
  }, [selectedId]);

  const FUND_TOUR: CoachStep[] = [
    { selector: '.fund-tabs', title: 'دو نما', text: 'بین «ماهِ جاری» (ثبت واریزی و قرعه‌کشی) و «گزارشِ کامل» (معوقات و وضعیت هر نفر) جابه‌جا شوید.' },
    { selector: '.fund-member', title: 'ثبت واریزی', text: 'هر ماه با زدن روی نامِ هر عضو، واریزی‌اش را تیک بزنید. مبلغ نسبت به تعداد سهمِ او محاسبه می‌شود.' },
    { selector: '.fm-notify', title: 'یادآوری به عضو', text: 'با این دکمه، پیامِ آماده‌ی یادآوریِ پرداخت را با واتساپ، پیامک یا اشتراک‌گذاری برای عضو بفرستید.' },
    { selector: '.fund-draw-btn', title: 'قرعه‌کشی ماه', text: 'وقتی همه واریز کردند، این دکمه فعال می‌شود و برندگانِ این ماه را نسبت به سهم‌ها انتخاب می‌کند.' },
  ];

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
    const f: Fund = { id: `fund-${Date.now()}`, name: newName.trim(), monthlyAmount: amt, payoutsPerMonth: payouts, members: [...members], rounds: [{ paid: {}, winners: [] }] };
    onChange([...funds, f]);
    setCreating(false); setNewName(''); setNewAmount(''); setNewPayouts('1'); setMembers([]); setMName(''); setMPhone(''); setMShares('1');
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
    const pool: string[] = [];
    fund.members.forEach((m) => { const rem = m.shares - wonCount(fund, m.name); for (let i = 0; i < rem; i++) pool.push(m.name); });
    if (!pool.length) return;
    for (let i = pool.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [pool[i], pool[j]] = [pool[j], pool[i]]; }
    const n = Math.min(fund.payoutsPerMonth, pool.length);
    const winners = pool.slice(0, n);
    const counts: { [k: string]: number } = {};
    winners.forEach((w) => { counts[w] = (counts[w] || 0) + 1; });
    setDrawMsg(Object.entries(counts).map(([k, c]) => (c > 1 ? `${k} (${c}×)` : k)).join('، '));
    update(fund.id, (f) => {
      const rounds = f.rounds.slice();
      rounds[rounds.length - 1] = { ...rounds[rounds.length - 1], winners };
      const drawnTotal = rounds.reduce((c, r) => c + r.winners.length, 0);
      if (drawnTotal < totalSharesOf(f)) rounds.push({ paid: {}, winners: [] });
      return { ...f, rounds };
    });
  };

  const deleteFund = (id: string) => confirm('این صندوق حذف شود؟', () => { onChange(funds.filter((f) => f.id !== id)); setSelectedId(null); });

  const payMessage = (f: Fund, m: FundMember) =>
    `سلام ${m.name} عزیز،\nوقتِ واریزیِ صندوق «${f.name}» رسیده است.\nسهم: ${m.shares} · مبلغ: ${fmt(f.monthlyAmount * m.shares)} تومان\nلطفاً در اولین فرصت واریز کنید. 🙏`;

  // ---------- جزئیاتِ صندوق ----------
  if (fund) {
    const totalShares = totalSharesOf(fund);
    const collection = fund.monthlyAmount * totalShares;
    const payout = collection / fund.payoutsPerMonth;
    const totalMonths = Math.ceil(totalShares / fund.payoutsPerMonth);
    const drawnTotal = fund.rounds.reduce((c, r) => c + r.winners.length, 0);
    const cur = fund.rounds[fund.rounds.length - 1];
    const inProgress = cur.winners.length === 0;
    const allPaid = inProgress && fund.members.every((m) => cur.paid[m.name]);
    const monthNo = fund.rounds.length;
    const finished = drawnTotal >= totalShares;
    const unpaidThis = fund.members.filter((m) => !cur.paid[m.name]).length;
    // معوقاتِ ماه‌های قبل
    const arrearsMembers = fund.members.map((m) => ({ m, unpaid: fund.rounds.filter((r) => !r.paid[m.name]).length })).filter((x) => x.unpaid > 0);

    return (
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
              <div className="tool-result-row closing"><span>مبلغِ هر پرداخت (به برنده)</span><strong>{fmt(payout)} تومان</strong></div>
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
                    <button className="loan-submit fund-draw-btn" disabled={!allPaid} onClick={draw}>
                      {allPaid ? `قرعه‌کشیِ ماه (${Math.min(fund.payoutsPerMonth, totalShares - drawnTotal)} برنده)` : 'تا همه واریز نکنند قرعه‌کشی فعال نیست'}
                    </button>
                  </>
                )}
              </>
            ) : (
              <>
                <div className="fund-help">
                  هر ماه <strong>{fmt(collection)}</strong> جمع و بین <strong>{fund.payoutsPerMonth}</strong> برنده تقسیم می‌شود (هرکدام {fmt(payout)}).
                  دوره <strong>{totalMonths} ماه</strong> است و هر سهم یک‌بار دریافت می‌کند. بدون سود.
                </div>

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
                    const received = wonCount(fund, m.name) * payout;
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

          {fundTour && <CoachTour steps={FUND_TOUR} onClose={() => { setFundTour(false); localStorage.setItem('fundTourSeen', '1'); }} />}
        </div>
      </div>
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
            <button className="loan-submit" disabled={!newName.trim() || !digits(newAmount) || members.length < 2} onClick={createFund}>ساختِ صندوق</button>
          </div>
        </div>
      </div>
    );
  }

  // ---------- فهرستِ صندوق‌ها ----------
  return (
    <div className="modal" onClick={onClose}>
      <div className="modal-box tool-panel" onClick={(e) => e.stopPropagation()}>
        <div className="tool-panel-head">
          <span className="tool-panel-icon">👨‍👩‍👧‍👦</span>
          <h3>صندوق خانوادگی</h3>
          <button className="close-modal" onClick={onClose}>✕</button>
        </div>
        <div className="tool-panel-body">
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
                    const perWinner = Math.round(collection / pay);
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
  );
}
