// صندوق خانوادگیِ قرض‌الحسنه (گردشی) — بدون سود، با قرعه‌کشیِ ماهانه
import { useState } from 'react';

const fmt = (n: number): string => (n || 0).toLocaleString('en-US');
const digits = (s: string): number => parseInt(s.replace(/[^0-9]/g, ''), 10) || 0;
const withSep = (s: string): string => { const d = digits(s); return d ? d.toLocaleString('en-US') : ''; };

export interface FundRound { paid: { [m: string]: boolean }; winner: string | null; }
export interface Fund { id: string; name: string; monthlyAmount: number; members: string[]; phones?: { [m: string]: string }; rounds: FundRound[]; }

interface Props {
  funds: Fund[];
  onChange: (f: Fund[]) => void;
  onClose: () => void;
  confirm: (msg: string, onYes: () => void) => void;
  onAddDeposits: (fundName: string, amount: number, count: number) => void;
  onShare: (text: string) => void;
}

// شماره را برای واتساپ به فرمت بین‌المللی (۹۸...) تبدیل می‌کند
const waNumber = (raw: string): string => {
  let d = (raw || '').replace(/[^0-9]/g, '');
  if (d.startsWith('0098')) d = d.slice(2);
  if (d.startsWith('98')) return d;
  if (d.startsWith('0')) return '98' + d.slice(1);
  return d;
};

export default function FundPanel({ funds, onChange, onClose, confirm, onAddDeposits, onShare }: Props) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [view, setView] = useState<'round' | 'report'>('round');
  const [newName, setNewName] = useState('');
  const [newAmount, setNewAmount] = useState('');
  const [members, setMembers] = useState<string[]>([]);
  const [phones, setPhones] = useState<{ [m: string]: string }>({});
  const [memberInput, setMemberInput] = useState('');
  const [phoneInput, setPhoneInput] = useState('');
  const [drawResult, setDrawResult] = useState<string | null>(null);
  const [notifyFor, setNotifyFor] = useState<string | null>(null);
  // ماشین‌حساب صندوق
  const [calcPayout, setCalcPayout] = useState('');
  const [calcPeople, setCalcPeople] = useState('');

  const fund = funds.find((f) => f.id === selectedId) || null;

  const addMember = () => {
    const n = memberInput.trim();
    if (n && !members.includes(n)) {
      setMembers([...members, n]);
      if (phoneInput.trim()) setPhones({ ...phones, [n]: phoneInput.trim() });
      setMemberInput(''); setPhoneInput('');
    }
  };

  const createFund = () => {
    const amt = digits(newAmount);
    if (!newName.trim() || !amt || members.length < 2) return;
    const f: Fund = {
      id: `fund-${Date.now()}`,
      name: newName.trim(),
      monthlyAmount: amt,
      members: [...members],
      phones: { ...phones },
      rounds: [{ paid: {}, winner: null }],
    };
    onChange([...funds, f]);
    setCreating(false); setNewName(''); setNewAmount(''); setMembers([]); setPhones({}); setMemberInput(''); setPhoneInput('');
    setSelectedId(f.id);
  };

  // پیامِ آماده‌ی یادآوریِ پرداخت برای یک عضو
  const payMessage = (f: Fund, member: string) =>
    `سلام ${member} عزیز،\nوقتِ واریزیِ صندوق «${f.name}» رسیده است.\nمبلغ: ${fmt(f.monthlyAmount)} تومان\nلطفاً در اولین فرصت واریز کنید. 🙏`;

  const update = (id: string, fn: (f: Fund) => Fund) => onChange(funds.map((f) => (f.id === id ? fn(f) : f)));

  const togglePaid = (member: string) => {
    if (!fund) return;
    update(fund.id, (f) => {
      const rounds = f.rounds.slice();
      const cur = { ...rounds[rounds.length - 1] };
      cur.paid = { ...cur.paid, [member]: !cur.paid[member] };
      rounds[rounds.length - 1] = cur;
      return { ...f, rounds };
    });
  };

  const draw = () => {
    if (!fund) return;
    const winners = fund.rounds.map((r) => r.winner).filter(Boolean) as string[];
    const remaining = fund.members.filter((m) => !winners.includes(m));
    if (!remaining.length) return;
    const picked = remaining[Math.floor(Math.random() * remaining.length)];
    setDrawResult(picked);
    update(fund.id, (f) => {
      const rounds = f.rounds.slice();
      rounds[rounds.length - 1] = { ...rounds[rounds.length - 1], winner: picked };
      const stillRemaining = f.members.filter((m) => ![...winners, picked].includes(m));
      if (stillRemaining.length) rounds.push({ paid: {}, winner: null });
      return { ...f, rounds };
    });
  };

  const deleteFund = (id: string) => confirm('این صندوق حذف شود؟', () => {
    onChange(funds.filter((f) => f.id !== id));
    setSelectedId(null);
  });

  // ---- نمای جزئیاتِ یک صندوق ----
  if (fund) {
    const winners = fund.rounds.map((r) => r.winner).filter(Boolean) as string[];
    const remaining = fund.members.filter((m) => !winners.includes(m));
    const cur = fund.rounds[fund.rounds.length - 1];
    const inProgress = cur.winner === null;
    const allPaid = inProgress && fund.members.every((m) => cur.paid[m]);
    const payout = fund.monthlyAmount * fund.members.length;
    const roundNo = winners.length + (inProgress ? 1 : 0);
    const totalRounds = fund.members.length; // هر نفر یک‌بار دریافت می‌کند

    return (
      <div className="modal" onClick={onClose}>
        <div className="modal-box tool-panel" onClick={(e) => e.stopPropagation()}>
          <div className="tool-panel-head">
            <button className="close-modal" onClick={() => { setSelectedId(null); setDrawResult(null); setView('round'); }}>‹</button>
            <h3>{fund.name}</h3>
            <button className="close-modal" onClick={onClose}>✕</button>
          </div>
          <div className="tool-panel-body">
            <div className="mini-toggle">
              <button type="button" className={`mini-toggle-btn ${view === 'round' ? 'active' : ''}`} onClick={() => setView('round')}>دوره‌ی جاری</button>
              <button type="button" className={`mini-toggle-btn ${view === 'report' ? 'active' : ''}`} onClick={() => setView('report')}>گزارش صندوق</button>
            </div>

            <div className="tool-result">
              <div className="tool-result-row"><span>واریزی ماهانه‌ی هر نفر</span><strong>{fmt(fund.monthlyAmount)} تومان</strong></div>
              <div className="tool-result-row"><span>تعداد اعضا</span><strong>{fund.members.length} نفر</strong></div>
              <div className="tool-result-row closing"><span>مبلغِ هر قرعه (به برنده)</span><strong>{fmt(payout)} تومان</strong></div>
            </div>

            {view === 'round' ? (
              <>
                {drawResult && (
                  <div className="fund-draw">🎉 برنده‌ی این دوره: <strong>{drawResult}</strong></div>
                )}

                {remaining.length === 0 ? (
                  <div className="loan-success">✅ همه‌ی اعضا برنده شدند؛ دوره‌ی صندوق کامل شد</div>
                ) : (
                  <>
                    <div className="loan-sched-head">
                      <span>دوره‌ی {roundNo} — واریزی‌ها</span>
                      <span className="loan-sched-hint">{remaining.length} نفر هنوز برنده نشده</span>
                    </div>
                    <div className="fund-members">
                      {fund.members.map((m) => {
                        const won = winners.includes(m);
                        return (
                          <div key={m} className={`fund-member ${cur.paid[m] ? 'paid' : ''} ${won ? 'won' : ''}`}>
                            <button className="fm-main" onClick={() => togglePaid(m)}>
                              <span className="fm-check">{cur.paid[m] ? '✓' : '○'}</span>
                              <span className="fm-name">{m} {won && <span className="fm-trophy">🏆 برنده</span>}</span>
                              <span className="fm-amt">{fmt(fund.monthlyAmount)}</span>
                            </button>
                            <button className="fm-notify" title="یادآوریِ پرداخت" onClick={() => setNotifyFor(m)}>📤</button>
                          </div>
                        );
                      })}
                    </div>
                    <button className="loan-submit" disabled={!allPaid} onClick={draw}>
                      {allPaid ? 'قرعه‌کشی این دوره' : 'تا همه واریز نکنند قرعه‌کشی فعال نیست'}
                    </button>
                  </>
                )}

                {winners.length > 0 && (
                  <>
                    <div className="loan-sched-head"><span>درآمدها (برندگان)</span></div>
                    <div className="tool-result">
                      {fund.rounds.filter((r) => r.winner).map((r, i) => (
                        <div key={i} className="tool-result-row"><span>دوره {i + 1} — {r.winner}</span><strong className="fund-income">+{fmt(payout)}</strong></div>
                      ))}
                    </div>
                  </>
                )}
              </>
            ) : (
              <>
                <div className="fund-help">
                  هر ماه هر نفر <strong>{fmt(fund.monthlyAmount)}</strong> واریز می‌کند و جمعاً <strong>{fmt(payout)}</strong> به یک نفر می‌رسد.
                  در پایانِ <strong>{totalRounds} ماه</strong>، همه یک‌بار دریافت کرده‌اند و هر نفر روی‌هم <strong>{fmt(payout)}</strong> داده و گرفته است (بدون سود).
                </div>
                <div className="loan-sched-head"><span>وضعیتِ هر نفر</span><span className="loan-sched-hint">تا پایان دوره</span></div>
                <div className="loan-detail-list">
                  {fund.members.map((m) => {
                    const paidRounds = fund.rounds.filter((r) => r.paid[m]).length;
                    const paidAmt = paidRounds * fund.monthlyAmount;
                    const obligation = totalRounds * fund.monthlyAmount;
                    const rem = Math.max(0, obligation - paidAmt);
                    const won = winners.includes(m);
                    return (
                      <div key={m} className="loan-detail-row">
                        <div className="ld-info">
                          <span className="ld-amt">{m} {won && '🏆'}</span>
                          <span className="ld-date">پرداختی: {fmt(paidAmt)} · مانده: {fmt(rem)}</span>
                        </div>
                        <span className={`fund-status ${won ? 'got' : 'wait'}`}>{won ? 'دریافت کرده' : 'در انتظار'}</span>
                      </div>
                    );
                  })}
                </div>
                <button className="loan-submit" onClick={() => onAddDeposits(fund.name, fund.monthlyAmount, Math.max(1, totalRounds - winners.length))}>
                  افزودنِ واریزی‌های من به تقویم (یادآور)
                </button>
              </>
            )}

            <button className="fund-delete" onClick={() => deleteFund(fund.id)}>حذف صندوق</button>
          </div>

          {notifyFor && (() => {
            const phone = fund.phones?.[notifyFor] || '';
            const msg = payMessage(fund, notifyFor);
            const enc = encodeURIComponent(msg);
            return (
              <div className="notify-sheet" onClick={() => setNotifyFor(null)}>
                <div className="notify-box" onClick={(e) => e.stopPropagation()}>
                  <div className="notify-title">یادآوریِ پرداخت به {notifyFor}</div>
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
    );
  }

  // ---- نمای ساختِ صندوق جدید ----
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
            <input className="tool-text-input" type="text" placeholder="مثلاً صندوق خانوادگی" value={newName} onChange={(e) => setNewName(e.target.value)} />
            <label className="field-label">واریزی ماهانه‌ی هر نفر (تومان)</label>
            <input className="tool-text-input" type="text" inputMode="numeric" dir="ltr" placeholder="1,000,000" value={newAmount} onChange={(e) => setNewAmount(withSep(e.target.value))} />
            <label className="field-label">افزودن اعضا (شماره اختیاری، برای ارسال یادآوری)</label>
            <input className="tool-text-input" type="text" placeholder="نام عضو" value={memberInput}
              onChange={(e) => setMemberInput(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && addMember()} />
            <div className="fund-add-row" style={{ marginTop: 8 }}>
              <input className="tool-text-input" type="tel" inputMode="tel" dir="ltr" placeholder="شماره موبایل (اختیاری)" value={phoneInput}
                onChange={(e) => setPhoneInput(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && addMember()} />
              <button className="fund-add-btn" onClick={addMember}>+</button>
            </div>
            <div className="fund-chips">
              {members.map((m) => (
                <span key={m} className="fund-chip" onClick={() => { setMembers(members.filter((x) => x !== m)); const p = { ...phones }; delete p[m]; setPhones(p); }}>
                  {m}{phones[m] ? ' ☎' : ''} ✕
                </span>
              ))}
            </div>
            {members.length < 2 && <div className="tool-note">حداقل ۲ عضو اضافه کنید</div>}
            <button className="loan-submit" disabled={!newName.trim() || !digits(newAmount) || members.length < 2} onClick={createFund}>ساختِ صندوق</button>
          </div>
        </div>
      </div>
    );
  }

  // ---- فهرستِ صندوق‌ها ----
  return (
    <div className="modal" onClick={onClose}>
      <div className="modal-box tool-panel" onClick={(e) => e.stopPropagation()}>
        <div className="tool-panel-head">
          <span className="tool-panel-icon">👨‍👩‍👧‍👦</span>
          <h3>صندوق خانوادگی</h3>
          <button className="close-modal" onClick={onClose}>✕</button>
        </div>
        <div className="tool-panel-body">
          <div className="tool-note">صندوقِ قرض‌الحسنه بدون سود؛ هر ماه همه واریز می‌کنند و یک نفر با قرعه‌کشی دریافت می‌کند.</div>
          {funds.length === 0 ? (
            <div className="tool-note" style={{ marginTop: 16 }}>هنوز صندوقی نساخته‌اید</div>
          ) : (
            funds.map((f) => {
              const winners = f.rounds.filter((r) => r.winner).length;
              return (
                <button key={f.id} className="loan-card" onClick={() => setSelectedId(f.id)}>
                  <div className="loan-card-top">
                    <span className="loan-card-name">{f.name}</span>
                    <span className="loan-card-count">{winners}/{f.members.length} دوره</span>
                  </div>
                  <div className="loan-card-sub">{f.members.length} نفر · ماهانه {fmt(f.monthlyAmount)} تومان</div>
                </button>
              );
            })
          )}
          <button className="loan-submit" onClick={() => setCreating(true)}>+ صندوق جدید</button>

          <div className="loan-sched-head" style={{ marginTop: 18 }}><span>ماشین‌حسابِ صندوق</span></div>
          <div className="fund-help">می‌خواهید به هر نفر چقدر برسد و چند نفر باشید؟ بگویید تا واریزیِ ماهانه‌ی هر نفر را حساب کنم.</div>
          <div className="loan-grid">
            <div>
              <label className="field-label">مبلغ به هر نفر (تومان)</label>
              <input className="tool-text-input" type="text" inputMode="numeric" dir="ltr" placeholder="60,000,000" value={calcPayout} onChange={(e) => setCalcPayout(withSep(e.target.value))} />
            </div>
            <div>
              <label className="field-label">تعداد نفرات</label>
              <input className="tool-text-input" type="number" inputMode="numeric" dir="ltr" placeholder="6" value={calcPeople} onChange={(e) => setCalcPeople(e.target.value.replace(/[^0-9]/g, ''))} />
            </div>
          </div>
          {(() => {
            const payout = digits(calcPayout);
            const ppl = parseInt(calcPeople, 10) || 0;
            if (!payout || ppl < 2) return <div className="tool-note">مبلغ و تعداد (حداقل ۲) را وارد کنید</div>;
            const monthly = Math.round(payout / ppl);
            return (
              <div className="tool-result">
                <div className="tool-result-row big"><span>واریزیِ ماهانه‌ی هر نفر</span><strong>{fmt(monthly)} تومان</strong></div>
                <div className="tool-result-row"><span>مدت</span><strong>{ppl} ماه</strong></div>
                <div className="tool-result-row closing"><span>هر نفر در نوبتش می‌گیرد</span><strong>{fmt(monthly * ppl)} تومان</strong></div>
              </div>
            );
          })()}
        </div>
      </div>
    </div>
  );
}
