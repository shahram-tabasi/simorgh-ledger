// حسابداریِ دوطرفه (Double-entry) برای simorgh-ledger
// دفترِ روزنامه (اسناد) + تراز آزمایشی + دفترِ معین + صورتِ سود و زیان + چاپ/PDF
import { useState } from 'react';
import { getToday, getMonthNames } from './calendar';
import { downloadCsv } from './csv';

const fmt = (n: number): string => Math.round(n || 0).toLocaleString('en-US');
const digits = (s: string): number => parseInt((s || '').replace(/[^0-9]/g, ''), 10) || 0;
const withSep = (s: string): string => { const d = digits(s); return d ? d.toLocaleString('en-US') : ''; };

export type AccType = 'asset' | 'liability' | 'equity' | 'income' | 'expense';
export interface Account { id: string; code: string; name: string; type: AccType; }
export interface EntryLine { accountId: string; debit: number; credit: number; }
// ref: شناسه‌ی منبعِ سند برای جلوگیری از ثبتِ تکراری وقتی از ماژول‌های دیگر (حقوق، صندوق، وام) خودکار ساخته می‌شود
export interface JournalEntry { id: string; y: number; m: number; d: number; desc: string; lines: EntryLine[]; ref?: string; }
export interface AccountingState { accounts: Account[]; entries: JournalEntry[]; }

const TYPE_LABEL: { [k in AccType]: string } = { asset: 'دارایی', liability: 'بدهی', equity: 'سرمایه', income: 'درآمد', expense: 'هزینه' };
// جهتِ طبیعیِ مانده: دارایی و هزینه بدهکار؛ بقیه بستانکار
const isDebitNormal = (t: AccType) => t === 'asset' || t === 'expense';

export const DEFAULT_ACCOUNTS: Account[] = [
  { id: 'a-cash', code: '1000', name: 'صندوق (نقد)', type: 'asset' },
  { id: 'a-bank', code: '1010', name: 'بانک', type: 'asset' },
  { id: 'a-recv', code: '1100', name: 'حساب‌های دریافتنی', type: 'asset' },
  { id: 'a-pay', code: '2000', name: 'حساب‌های پرداختنی', type: 'liability' },
  { id: 'a-cap', code: '3000', name: 'سرمایه', type: 'equity' },
  { id: 'a-inc', code: '4000', name: 'درآمد', type: 'income' },
  { id: 'a-exp', code: '5000', name: 'هزینه‌ها', type: 'expense' },
];

export function emptyAccounting(): AccountingState { return { accounts: DEFAULT_ACCOUNTS.map((a) => ({ ...a })), entries: [] }; }

interface Props {
  state: AccountingState;
  onChange: (s: AccountingState) => void;
  onClose: () => void;
  confirm: (msg: string, onYes: () => void) => void;
}

type Tab = 'journal' | 'reports' | 'accounts';

export default function AccountingPanel({ state, onChange, onClose, confirm }: Props) {
  const accounts = state.accounts && state.accounts.length ? state.accounts : DEFAULT_ACCOUNTS;
  const entries = state.entries || [];
  const [tab, setTab] = useState<Tab>('journal');
  const monthNames = getMonthNames('jalali');
  const accById = (id: string) => accounts.find((a) => a.id === id);

  // ---------- فرمِ سندِ جدید ----------
  const today = getToday('jalali');
  const [creating, setCreating] = useState(false);
  const [eY, setEY] = useState(String(today.year));
  const [eM, setEM] = useState(String(today.month + 1)); // نمایش ۱..۱۲
  const [eD, setED] = useState(String(today.day));
  const [eDesc, setEDesc] = useState('');
  const [rows, setRows] = useState<{ accountId: string; debit: string; credit: string }[]>([
    { accountId: accounts[0]?.id || '', debit: '', credit: '' },
    { accountId: accounts[1]?.id || '', debit: '', credit: '' },
  ]);

  const totalDebit = rows.reduce((s, r) => s + digits(r.debit), 0);
  const totalCredit = rows.reduce((s, r) => s + digits(r.credit), 0);
  const balanced = totalDebit > 0 && totalDebit === totalCredit;

  const resetForm = () => {
    setEDesc(''); setEY(String(today.year)); setEM(String(today.month + 1)); setED(String(today.day));
    setRows([{ accountId: accounts[0]?.id || '', debit: '', credit: '' }, { accountId: accounts[1]?.id || '', debit: '', credit: '' }]);
  };
  const saveEntry = () => {
    if (!balanced) return;
    const lines: EntryLine[] = rows
      .filter((r) => r.accountId && (digits(r.debit) || digits(r.credit)))
      .map((r) => ({ accountId: r.accountId, debit: digits(r.debit), credit: digits(r.credit) }));
    if (lines.length < 2) return;
    const m0 = Math.min(11, Math.max(0, (digits(eM) || 1) - 1));
    const entry: JournalEntry = { id: `je-${Date.now()}`, y: digits(eY) || today.year, m: m0, d: Math.min(31, Math.max(1, digits(eD) || 1)), desc: eDesc.trim() || 'سند', lines };
    onChange({ accounts, entries: [...entries, entry] });
    resetForm(); setCreating(false); setTab('journal');
  };
  const deleteEntry = (id: string) => confirm('این سند حذف شود؟', () => onChange({ accounts, entries: entries.filter((e) => e.id !== id) }));

  // ---------- حساب‌ها ----------
  const [aCode, setACode] = useState(''); const [aName, setAName] = useState(''); const [aType, setAType] = useState<AccType>('expense');
  const addAccount = () => {
    if (!aName.trim()) return;
    const acc: Account = { id: `a-${Date.now()}`, code: aCode.trim() || String(1000 + accounts.length), name: aName.trim(), type: aType };
    onChange({ accounts: [...accounts, acc], entries }); setACode(''); setAName('');
  };
  const accUsed = (id: string) => entries.some((e) => e.lines.some((l) => l.accountId === id));
  const deleteAccount = (id: string) => {
    if (accUsed(id)) { confirm('این حساب در اسناد استفاده شده و حذف نمی‌شود.', () => {}); return; }
    confirm('این حساب حذف شود؟', () => onChange({ accounts: accounts.filter((a) => a.id !== id), entries }));
  };

  // ---------- محاسباتِ گزارش ----------
  const sums = accounts.map((a) => {
    let d = 0, c = 0;
    entries.forEach((e) => e.lines.forEach((l) => { if (l.accountId === a.id) { d += l.debit; c += l.credit; } }));
    return { a, debit: d, credit: c, bal: isDebitNormal(a.type) ? d - c : c - d };
  });
  const grandDebit = sums.reduce((s, x) => s + x.debit, 0);
  const grandCredit = sums.reduce((s, x) => s + x.credit, 0);
  const incomeTotal = sums.filter((x) => x.a.type === 'income').reduce((s, x) => s + x.bal, 0);
  const expenseTotal = sums.filter((x) => x.a.type === 'expense').reduce((s, x) => s + x.bal, 0);
  const profit = incomeTotal - expenseTotal;
  // ترازنامه: دارایی‌ها = بدهی‌ها + سرمایه + سودِ انباشته (سود و زیانِ دوره)
  // (مانده‌ی هر گروه با علامتِ طبیعیِ خودش جمع می‌شود)
  const assetsTotal = sums.filter((x) => x.a.type === 'asset').reduce((s, x) => s + x.bal, 0);
  const liabilitiesTotal = sums.filter((x) => x.a.type === 'liability').reduce((s, x) => s + x.bal, 0);
  const equityTotal = sums.filter((x) => x.a.type === 'equity').reduce((s, x) => s + x.bal, 0);
  const equityPlusProfit = equityTotal + profit;          // سرمایه + سودِ دوره
  const balanceSheetOk = Math.round(assetsTotal) === Math.round(liabilitiesTotal + equityPlusProfit);

  const [ledgerAcc, setLedgerAcc] = useState<string>(accounts[0]?.id || '');
  const ledgerRows = (() => {
    const acc = accById(ledgerAcc); if (!acc) return [];
    const rowsOut: { e: JournalEntry; debit: number; credit: number; running: number }[] = [];
    let run = 0;
    entries.slice().sort((a, b) => (a.y * 10000 + a.m * 100 + a.d) - (b.y * 10000 + b.m * 100 + b.d))
      .forEach((e) => e.lines.forEach((l) => {
        if (l.accountId === ledgerAcc) { run += isDebitNormal(acc.type) ? (l.debit - l.credit) : (l.credit - l.debit); rowsOut.push({ e, debit: l.debit, credit: l.credit, running: run }); }
      }));
    return rowsOut;
  })();

  const sortedEntries = entries.slice().sort((a, b) => (b.y * 10000 + b.m * 100 + b.d) - (a.y * 10000 + a.m * 100 + a.d));
  const dateStr = (e: { y: number; m: number; d: number }) => `${e.d} ${monthNames[e.m]} ${e.y}`;
  const printReport = () => window.print();

  return (
    <div className="modal" onClick={onClose}>
      <div className="modal-box tool-panel" onClick={(e) => e.stopPropagation()}>
        <div className="tool-panel-head">
          <button className="close-modal" onClick={onClose}>‹</button>
          <h3>📒 حسابداری</h3>
          <button className="close-modal" onClick={onClose}>✕</button>
        </div>
        <div className="tool-panel-body">
          <div className="mini-toggle fund-tabs">
            <button type="button" className={`mini-toggle-btn ${tab === 'journal' ? 'active' : ''}`} onClick={() => setTab('journal')}>اسناد</button>
            <button type="button" className={`mini-toggle-btn ${tab === 'reports' ? 'active' : ''}`} onClick={() => setTab('reports')}>دفتر و تراز</button>
            <button type="button" className={`mini-toggle-btn ${tab === 'accounts' ? 'active' : ''}`} onClick={() => setTab('accounts')}>حساب‌ها</button>
          </div>

          {/* ---------------- اسناد ---------------- */}
          {tab === 'journal' && !creating && (
            <>
              <button className="loan-submit" onClick={() => { resetForm(); setCreating(true); }}>+ سندِ جدید</button>
              {sortedEntries.length === 0 ? (
                <div className="tool-note">هنوز سندی ثبت نشده. با «سندِ جدید» اولین سند را بزنید.</div>
              ) : (
                <div className="loan-detail-list">
                  {sortedEntries.map((e) => {
                    const sum = e.lines.reduce((s, l) => s + l.debit, 0);
                    return (
                      <div key={e.id} className="loan-detail-row acc-entry">
                        <div className="ld-info">
                          <span className="ld-amt">{e.desc} <span className="fm-shares">{fmt(sum)}</span></span>
                          <span className="ld-date">{dateStr(e)} · {e.lines.map((l) => { const a = accById(l.accountId); return `${a ? a.name : '—'} ${l.debit ? 'بد ' + fmt(l.debit) : 'بس ' + fmt(l.credit)}`; }).join(' / ')}</span>
                        </div>
                        <button className="fm-notify" title="حذف" onClick={() => deleteEntry(e.id)}>🗑</button>
                      </div>
                    );
                  })}
                </div>
              )}
            </>
          )}

          {/* ---------------- فرمِ سندِ جدید ---------------- */}
          {tab === 'journal' && creating && (
            <>
              <label className="field-label">شرحِ سند</label>
              <input className="tool-text-input" type="text" placeholder="مثلاً دریافتِ وجه از مشتری" value={eDesc} onChange={(e) => setEDesc(e.target.value)} />
              <label className="field-label">تاریخ (روز / ماه / سال)</label>
              <div className="acc-date">
                <input className="tool-text-input" type="number" inputMode="numeric" dir="ltr" value={eD} onChange={(e) => setED(e.target.value.replace(/[^0-9]/g, ''))} />
                <input className="tool-text-input" type="number" inputMode="numeric" dir="ltr" value={eM} onChange={(e) => setEM(e.target.value.replace(/[^0-9]/g, ''))} />
                <input className="tool-text-input" type="number" inputMode="numeric" dir="ltr" value={eY} onChange={(e) => setEY(e.target.value.replace(/[^0-9]/g, ''))} />
              </div>

              <div className="loan-sched-head"><span>ردیف‌ها</span><span className="loan-sched-hint">بدهکار = بستانکار</span></div>
              <div className="acc-lines">
                <div className="acc-line acc-line-head">
                  <span>حساب</span><span>بدهکار</span><span>بستانکار</span><span></span>
                </div>
                {rows.map((r, i) => (
                  <div className="acc-line" key={i}>
                    <select value={r.accountId} onChange={(e) => { const c = rows.slice(); c[i] = { ...c[i], accountId: e.target.value }; setRows(c); }}>
                      {accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
                    </select>
                    <input type="text" inputMode="numeric" dir="ltr" value={r.debit} onChange={(e) => { const c = rows.slice(); c[i] = { ...c[i], debit: withSep(e.target.value), credit: '' }; setRows(c); }} />
                    <input type="text" inputMode="numeric" dir="ltr" value={r.credit} onChange={(e) => { const c = rows.slice(); c[i] = { ...c[i], credit: withSep(e.target.value), debit: '' }; setRows(c); }} />
                    <button className="acc-line-del" onClick={() => setRows(rows.length > 2 ? rows.filter((_, k) => k !== i) : rows)}>✕</button>
                  </div>
                ))}
              </div>
              <button className="acc-addline" onClick={() => setRows([...rows, { accountId: accounts[0]?.id || '', debit: '', credit: '' }])}>+ ردیف</button>

              <div className="tool-result">
                <div className="tool-result-row"><span>جمعِ بدهکار</span><strong>{fmt(totalDebit)}</strong></div>
                <div className="tool-result-row"><span>جمعِ بستانکار</span><strong>{fmt(totalCredit)}</strong></div>
                <div className={`tool-result-row closing ${balanced ? '' : 'debt'}`}><span>اختلاف</span><strong>{fmt(totalDebit - totalCredit)}</strong></div>
              </div>
              {!balanced && <div className="tool-note">سند وقتی ذخیره می‌شود که جمعِ بدهکار و بستانکار برابر و بزرگ‌تر از صفر باشد.</div>}
              <div className="acc-form-actions">
                <button className="loan-submit" disabled={!balanced} onClick={saveEntry}>ثبتِ سند</button>
                <button className="acc-cancel" onClick={() => { setCreating(false); resetForm(); }}>انصراف</button>
              </div>
            </>
          )}

          {/* ---------------- دفتر و تراز ---------------- */}
          {tab === 'reports' && (
            <>
              <div className="acc-print">
                <div className="acc-print-title">تراز آزمایشی</div>
                <table className="acc-table">
                  <thead><tr><th>حساب</th><th>بدهکار</th><th>بستانکار</th><th>مانده</th></tr></thead>
                  <tbody>
                    {sums.map((x) => (
                      <tr key={x.a.id}><td>{x.a.code} · {x.a.name}</td><td>{fmt(x.debit)}</td><td>{fmt(x.credit)}</td><td>{fmt(Math.abs(x.bal))} {x.bal === 0 ? '' : isDebitNormal(x.a.type) === x.bal > 0 ? 'بد' : 'بس'}</td></tr>
                    ))}
                    <tr className="acc-total"><td>جمع</td><td>{fmt(grandDebit)}</td><td>{fmt(grandCredit)}</td><td>{grandDebit === grandCredit ? 'متوازن ✓' : 'ناتراز!'}</td></tr>
                  </tbody>
                </table>

                <div className="acc-print-title">صورتِ سود و زیان</div>
                <table className="acc-table">
                  <tbody>
                    <tr><td>جمعِ درآمد</td><td>{fmt(incomeTotal)}</td></tr>
                    <tr><td>جمعِ هزینه</td><td>{fmt(expenseTotal)}</td></tr>
                    <tr className="acc-total"><td>{profit >= 0 ? 'سودِ خالص' : 'زیانِ خالص'}</td><td>{fmt(Math.abs(profit))}</td></tr>
                  </tbody>
                </table>

                <div className="acc-print-title">ترازنامه</div>
                <table className="acc-table">
                  <tbody>
                    <tr><td>جمعِ دارایی‌ها</td><td>{fmt(assetsTotal)}</td></tr>
                    <tr><td>جمعِ بدهی‌ها</td><td>{fmt(liabilitiesTotal)}</td></tr>
                    <tr><td>سرمایه + سودِ دوره</td><td>{fmt(equityPlusProfit)}</td></tr>
                    <tr className="acc-total"><td>بدهی + سرمایه + سود</td><td>{fmt(liabilitiesTotal + equityPlusProfit)} {balanceSheetOk ? '✓' : '(ناتراز)'}</td></tr>
                  </tbody>
                </table>

                <div className="acc-print-title">دفترِ معین</div>
                <select className="tool-text-input acc-ledger-pick acc-noprint" value={ledgerAcc} onChange={(e) => setLedgerAcc(e.target.value)}>
                  {accounts.map((a) => <option key={a.id} value={a.id}>{a.code} · {a.name}</option>)}
                </select>
                <div className="acc-ledger-name">دفترِ معینِ: {accById(ledgerAcc)?.name}</div>
                <table className="acc-table">
                  <thead><tr><th>تاریخ</th><th>شرح</th><th>بدهکار</th><th>بستانکار</th><th>مانده</th></tr></thead>
                  <tbody>
                    {ledgerRows.length === 0 ? (
                      <tr><td colSpan={5} style={{ textAlign: 'center', opacity: .6 }}>گردشی ندارد</td></tr>
                    ) : ledgerRows.map((r, i) => (
                      <tr key={i}><td>{dateStr(r.e)}</td><td>{r.e.desc}</td><td>{r.debit ? fmt(r.debit) : ''}</td><td>{r.credit ? fmt(r.credit) : ''}</td><td>{fmt(r.running)}</td></tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <button className="loan-submit acc-noprint" onClick={printReport}>🖨️ چاپ / ذخیره‌ی PDF</button>
              <button className="acc-addline acc-noprint" onClick={() => downloadCsv('trial-balance.csv', [['حساب', 'بدهکار', 'بستانکار', 'مانده'], ...sums.map((x) => [`${x.a.code} ${x.a.name}`, x.debit, x.credit, x.bal]), ['جمع', grandDebit, grandCredit, '']])}>📤 خروجیِ اکسل (CSV)</button>
            </>
          )}

          {/* ---------------- حساب‌ها ---------------- */}
          {tab === 'accounts' && (
            <>
              <div className="loan-sched-head"><span>افزودنِ حساب</span></div>
              <div className="acc-addacc">
                <input className="tool-text-input" type="text" inputMode="numeric" dir="ltr" placeholder="کد" value={aCode} onChange={(e) => setACode(e.target.value.replace(/[^0-9]/g, ''))} />
                <input className="tool-text-input" type="text" placeholder="نامِ حساب" value={aName} onChange={(e) => setAName(e.target.value)} />
              </div>
              <div className="acc-type-pick">
                {(Object.keys(TYPE_LABEL) as AccType[]).map((t) => (
                  <button key={t} type="button" className={`fund-level-btn ${aType === t ? 'active' : ''}`} onClick={() => setAType(t)}>{TYPE_LABEL[t]}</button>
                ))}
              </div>
              <button className="loan-submit" disabled={!aName.trim()} onClick={addAccount}>افزودنِ حساب</button>

              <div className="loan-sched-head"><span>فهرستِ حساب‌ها</span><span className="loan-sched-hint">{accounts.length} حساب</span></div>
              <div className="loan-detail-list">
                {accounts.map((a) => (
                  <div key={a.id} className="loan-detail-row">
                    <div className="ld-info">
                      <span className="ld-amt">{a.code} · {a.name}</span>
                      <span className="ld-date">{TYPE_LABEL[a.type]}{accUsed(a.id) ? ' · در حالِ استفاده' : ''}</span>
                    </div>
                    {!accUsed(a.id) && <button className="fm-notify" title="حذف" onClick={() => deleteAccount(a.id)}>🗑</button>}
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
