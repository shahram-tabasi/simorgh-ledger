// حسابداریِ دوطرفه (Double-entry) برای simorgh-ledger
// دفترِ روزنامه (اسناد) + تراز آزمایشی + دفترِ معین + صورتِ سود و زیان + چاپ/PDF
import { useState } from 'react';
import { getToday, getMonthNames } from './calendar';
import { downloadCsv } from './csv';

const fmt = (n: number): string => Math.round(n || 0).toLocaleString('en-US');
const digits = (s: string): number => parseInt((s || '').replace(/[^0-9]/g, ''), 10) || 0;
const withSep = (s: string): string => { const d = digits(s); return d ? d.toLocaleString('en-US') : ''; };

export type AccType = 'asset' | 'liability' | 'equity' | 'income' | 'expense';
// Hierarchical chart of accounts (کدینگِ استاندارد): گروه → کل → معین → تفصیلی.
// Only the leaf levels (معین/تفصیلی) accept journal lines; group/total are headers for grouping & reports.
export type AccLevel = 'group' | 'total' | 'sub' | 'detail';
export interface Account { id: string; code: string; name: string; type: AccType; level?: AccLevel; parent?: string; }
export interface EntryLine { accountId: string; debit: number; credit: number; }
// ref: شناسه‌ی منبعِ سند برای جلوگیری از ثبتِ تکراری وقتی از ماژول‌های دیگر (حقوق، صندوق، وام) خودکار ساخته می‌شود
export interface JournalEntry { id: string; y: number; m: number; d: number; desc: string; lines: EntryLine[]; ref?: string; }
export interface AccountingState { accounts: Account[]; entries: JournalEntry[]; vatRate?: number; }

const TYPE_LABEL: { [k in AccType]: string } = { asset: 'دارایی', liability: 'بدهی', equity: 'سرمایه', income: 'درآمد', expense: 'هزینه' };
export const LEVEL_LABEL: { [k in AccLevel]: string } = { group: 'گروه', total: 'کل', sub: 'معین', detail: 'تفصیلی' };
// جهتِ طبیعیِ مانده: دارایی و هزینه بدهکار؛ بقیه بستانکار
const isDebitNormal = (t: AccType) => t === 'asset' || t === 'expense';
export const DEFAULT_VAT_RATE = 10; // مالیات بر ارزش افزوده (٪) — نرخِ جاریِ ایران

// Standard Iranian-style chart: groups (گروه) → general (کل) → subsidiary (معین, postable).
// Module integrations (payroll/inventory/fund/loan) resolve their accounts by name and will reuse these.
export const DEFAULT_ACCOUNTS: Account[] = [
  // 1 — دارایی‌ها
  { id: 'g1', code: '1', name: 'دارایی‌ها', type: 'asset', level: 'group' },
  { id: 't11', code: '11', name: 'دارایی‌های جاری', type: 'asset', level: 'total', parent: 'g1' },
  { id: 'a-cash', code: '1101', name: 'صندوق (نقد)', type: 'asset', level: 'sub', parent: 't11' },
  { id: 'a-bank', code: '1102', name: 'بانک', type: 'asset', level: 'sub', parent: 't11' },
  { id: 'a-petty', code: '1103', name: 'تنخواه‌گردان', type: 'asset', level: 'sub', parent: 't11' },
  { id: 'a-recv', code: '1104', name: 'حساب‌های دریافتنی', type: 'asset', level: 'sub', parent: 't11' },
  { id: 'a-inv', code: '1105', name: 'موجودیِ کالا', type: 'asset', level: 'sub', parent: 't11' },
  { id: 'a-vat-in', code: '1106', name: 'مالیات بر ارزش افزوده (خرید)', type: 'asset', level: 'sub', parent: 't11' },
  { id: 't12', code: '12', name: 'دارایی‌های غیرجاری', type: 'asset', level: 'total', parent: 'g1' },
  { id: 'a-fixed', code: '1201', name: 'اموال، ماشین‌آلات و تجهیزات', type: 'asset', level: 'sub', parent: 't12' },
  // 2 — بدهی‌ها
  { id: 'g2', code: '2', name: 'بدهی‌ها', type: 'liability', level: 'group' },
  { id: 't21', code: '21', name: 'بدهی‌های جاری', type: 'liability', level: 'total', parent: 'g2' },
  { id: 'a-pay', code: '2101', name: 'حساب‌های پرداختنی', type: 'liability', level: 'sub', parent: 't21' },
  { id: 'a-salpay', code: '2102', name: 'حقوقِ پرداختنی', type: 'liability', level: 'sub', parent: 't21' },
  { id: 'a-vat-out', code: '2103', name: 'مالیات بر ارزش افزوده (فروش)', type: 'liability', level: 'sub', parent: 't21' },
  // 3 — حقوقِ صاحبانِ سرمایه
  { id: 'g3', code: '3', name: 'حقوقِ صاحبانِ سرمایه', type: 'equity', level: 'group' },
  { id: 'a-cap', code: '3101', name: 'سرمایه', type: 'equity', level: 'sub', parent: 'g3' },
  { id: 'a-retained', code: '3102', name: 'سود و زیانِ انباشته', type: 'equity', level: 'sub', parent: 'g3' },
  // 4 — درآمدها
  { id: 'g4', code: '4', name: 'درآمدها', type: 'income', level: 'group' },
  { id: 'a-inc', code: '4101', name: 'فروش', type: 'income', level: 'sub', parent: 'g4' },
  { id: 'a-svc', code: '4102', name: 'درآمدِ خدمات', type: 'income', level: 'sub', parent: 'g4' },
  // 5 — بهای تمام‌شده و هزینه‌ها
  { id: 'g5', code: '5', name: 'بهای تمام‌شده و هزینه‌ها', type: 'expense', level: 'group' },
  { id: 'a-cogs', code: '5101', name: 'بهای تمام‌شده‌ی کالای فروش‌رفته', type: 'expense', level: 'sub', parent: 'g5' },
  { id: 'a-salary', code: '5102', name: 'هزینه‌ی حقوق', type: 'expense', level: 'sub', parent: 'g5' },
  { id: 'a-exp', code: '5103', name: 'هزینه‌های عمومی و اداری', type: 'expense', level: 'sub', parent: 'g5' },
  { id: 'a-rent', code: '5104', name: 'هزینه‌ی اجاره', type: 'expense', level: 'sub', parent: 'g5' },
];

export function emptyAccounting(): AccountingState { return { accounts: DEFAULT_ACCOUNTS.map((a) => ({ ...a })), entries: [], vatRate: DEFAULT_VAT_RATE }; }

interface Props {
  state: AccountingState;
  onChange: (s: AccountingState) => void;
  onClose: () => void;
  confirm: (msg: string, onYes: () => void) => void;
}

type Tab = 'quick' | 'journal' | 'reports' | 'accounts';

export default function AccountingPanel({ state, onChange, onClose, confirm }: Props) {
  const accounts = state.accounts && state.accounts.length ? state.accounts : DEFAULT_ACCOUNTS;
  const entries = state.entries || [];
  const vatRate = state.vatRate ?? DEFAULT_VAT_RATE;
  const [tab, setTab] = useState<Tab>('journal');
  const monthNames = getMonthNames('jalali');
  const accById = (id: string) => accounts.find((a) => a.id === id);
  // A leaf account (no children) accepts journal lines; group/total headers do not.
  const hasChildren = (id: string) => accounts.some((a) => a.parent === id);
  const isPostable = (a: Account) => !hasChildren(a.id);
  const postable = accounts.filter(isPostable);
  // Depth of an account in the tree, for indentation.
  const depthOf = (a: Account): number => { let d = 0, p = a.parent; const seen = new Set<string>(); while (p && !seen.has(p)) { seen.add(p); d++; p = accounts.find((x) => x.id === p)?.parent; } return d; };
  // Accounts ordered as a tree (parents before children), sorted by code.
  const treeOrder = (() => {
    const out: Account[] = [];
    const byParent: { [k: string]: Account[] } = {};
    accounts.forEach((a) => { const k = a.parent || '__root'; (byParent[k] = byParent[k] || []).push(a); });
    Object.values(byParent).forEach((arr) => arr.sort((x, y) => x.code.localeCompare(y.code, 'en', { numeric: true })));
    const walk = (key: string) => { (byParent[key] || []).forEach((a) => { out.push(a); walk(a.id); }); };
    walk('__root');
    return out;
  })();
  // Resolve a postable account by (type, name); create it as a معین under its group if missing.
  const resolveLocal = (list: Account[], name: string, type: AccType): { acc: Account; list: Account[] } => {
    const found = list.find((a) => a.type === type && a.name === name && !list.some((c) => c.parent === a.id));
    if (found) return { acc: found, list };
    const group = list.find((a) => a.type === type && a.level === 'group');
    const code = String((group ? digits(group.code) * 1000 : 9000) + list.filter((a) => a.type === type).length + 1);
    const acc: Account = { id: `a-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`, code, name, type, level: 'sub', parent: group?.id };
    return { acc, list: [...list, acc] };
  };
  // Post a balanced quick entry (used by the guided non-accountant operations).
  const postQuick = (date: { y: number; m: number; d: number }, desc: string, spec: { name: string; type: AccType; debit?: number; credit?: number }[]) => {
    let list = accounts.slice();
    const lines: EntryLine[] = spec.filter((s) => (s.debit || 0) > 0 || (s.credit || 0) > 0).map((s) => {
      const r = resolveLocal(list, s.name, s.type); list = r.list;
      return { accountId: r.acc.id, debit: Math.round(s.debit || 0), credit: Math.round(s.credit || 0) };
    });
    const td = lines.reduce((t, l) => t + l.debit, 0); const tc = lines.reduce((t, l) => t + l.credit, 0);
    if (lines.length < 2 || Math.round(td) !== Math.round(tc) || td <= 0) { confirm('مبالغ نامعتبر است؛ سند ساخته نشد.', () => {}); return false; }
    const entry: JournalEntry = { id: `je-${Date.now()}`, ...date, desc, lines };
    onChange({ ...state, accounts: list, entries: [...entries, entry] });
    return true;
  };

  // ---------- فرمِ سندِ جدید ----------
  const today = getToday('jalali');
  const [creating, setCreating] = useState(false);
  const [eY, setEY] = useState(String(today.year));
  const [eM, setEM] = useState(String(today.month + 1)); // نمایش ۱..۱۲
  const [eD, setED] = useState(String(today.day));
  const [eDesc, setEDesc] = useState('');
  const [rows, setRows] = useState<{ accountId: string; debit: string; credit: string }[]>([
    { accountId: postable[0]?.id || '', debit: '', credit: '' },
    { accountId: postable[1]?.id || '', debit: '', credit: '' },
  ]);

  const totalDebit = rows.reduce((s, r) => s + digits(r.debit), 0);
  const totalCredit = rows.reduce((s, r) => s + digits(r.credit), 0);
  const balanced = totalDebit > 0 && totalDebit === totalCredit;

  const resetForm = () => {
    setEDesc(''); setEY(String(today.year)); setEM(String(today.month + 1)); setED(String(today.day));
    setRows([{ accountId: postable[0]?.id || '', debit: '', credit: '' }, { accountId: postable[1]?.id || '', debit: '', credit: '' }]);
  };
  const saveEntry = () => {
    if (!balanced) return;
    const lines: EntryLine[] = rows
      .filter((r) => r.accountId && (digits(r.debit) || digits(r.credit)))
      .map((r) => ({ accountId: r.accountId, debit: digits(r.debit), credit: digits(r.credit) }));
    if (lines.length < 2) return;
    const m0 = Math.min(11, Math.max(0, (digits(eM) || 1) - 1));
    const entry: JournalEntry = { id: `je-${Date.now()}`, y: digits(eY) || today.year, m: m0, d: Math.min(31, Math.max(1, digits(eD) || 1)), desc: eDesc.trim() || 'سند', lines };
    onChange({ ...state, entries: [...entries, entry] });
    resetForm(); setCreating(false); setTab('journal');
  };
  const deleteEntry = (id: string) => confirm('این سند حذف شود؟', () => onChange({ ...state, entries: entries.filter((e) => e.id !== id) }));

  // ---------- حساب‌ها ----------
  const [aCode, setACode] = useState(''); const [aName, setAName] = useState(''); const [aType, setAType] = useState<AccType>('expense');
  const [aParent, setAParent] = useState<string>('');   // optional parent (کل/گروه) for the new معین
  const addAccount = () => {
    if (!aName.trim()) return;
    const parent = accounts.find((a) => a.id === aParent);
    const type = parent ? parent.type : aType;            // child inherits its parent's type
    const acc: Account = { id: `a-${Date.now()}`, code: aCode.trim() || String(1000 + accounts.length), name: aName.trim(), type, level: 'sub', parent: parent?.id };
    onChange({ ...state, accounts: [...accounts, acc] }); setACode(''); setAName('');
  };
  const accUsed = (id: string) => entries.some((e) => e.lines.some((l) => l.accountId === id)) || hasChildren(id);
  const deleteAccount = (id: string) => {
    if (accUsed(id)) { confirm('این حساب در اسناد/زیرمجموعه استفاده شده و حذف نمی‌شود.', () => {}); return; }
    confirm('این حساب حذف شود؟', () => onChange({ ...state, accounts: accounts.filter((a) => a.id !== id) }));
  };
  const setVat = (v: number) => onChange({ ...state, vatRate: Math.max(0, Math.min(100, v)) });

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

  const [ledgerAcc, setLedgerAcc] = useState<string>(postable[0]?.id || '');
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
            <button type="button" className={`mini-toggle-btn ${tab === 'quick' ? 'active' : ''}`} onClick={() => setTab('quick')}>ثبتِ سریع</button>
            <button type="button" className={`mini-toggle-btn ${tab === 'journal' ? 'active' : ''}`} onClick={() => setTab('journal')}>اسناد</button>
            <button type="button" className={`mini-toggle-btn ${tab === 'reports' ? 'active' : ''}`} onClick={() => setTab('reports')}>دفتر و تراز</button>
            <button type="button" className={`mini-toggle-btn ${tab === 'accounts' ? 'active' : ''}`} onClick={() => setTab('accounts')}>حساب‌ها</button>
          </div>

          {/* ---------------- ثبتِ سریع (راهنمای غیرحسابدار) ---------------- */}
          {tab === 'quick' && <QuickEntry today={today} vatRate={vatRate} postQuick={postQuick} onDone={() => setTab('journal')} />}

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
                      {postable.map((a) => <option key={a.id} value={a.id}>{a.code} · {a.name}</option>)}
                    </select>
                    <input type="text" inputMode="numeric" dir="ltr" value={r.debit} onChange={(e) => { const c = rows.slice(); c[i] = { ...c[i], debit: withSep(e.target.value), credit: '' }; setRows(c); }} />
                    <input type="text" inputMode="numeric" dir="ltr" value={r.credit} onChange={(e) => { const c = rows.slice(); c[i] = { ...c[i], credit: withSep(e.target.value), debit: '' }; setRows(c); }} />
                    <button className="acc-line-del" onClick={() => setRows(rows.length > 2 ? rows.filter((_, k) => k !== i) : rows)}>✕</button>
                  </div>
                ))}
              </div>
              <button className="acc-addline" onClick={() => setRows([...rows, { accountId: postable[0]?.id || '', debit: '', credit: '' }])}>+ ردیف</button>

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
                    {sums.filter((x) => isPostable(x.a) && (x.debit || x.credit)).map((x) => (
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
                  {postable.map((a) => <option key={a.id} value={a.id}>{a.code} · {a.name}</option>)}
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

          {/* ---------------- حساب‌ها (کدینگِ سلسله‌مراتبی) ---------------- */}
          {tab === 'accounts' && (
            <>
              <label className="field-label">نرخِ مالیات بر ارزش افزوده (٪)</label>
              <input className="tool-text-input" type="text" inputMode="numeric" dir="ltr" value={String(vatRate)} onChange={(e) => setVat(digits(e.target.value))} />

              <div className="loan-sched-head"><span>افزودنِ حسابِ معین</span></div>
              <label className="field-label">زیرمجموعه‌ی (گروه/کل)</label>
              <select className="tool-text-input" value={aParent} onChange={(e) => setAParent(e.target.value)}>
                <option value="">— مستقل (انتخابِ نوع در پایین) —</option>
                {accounts.filter((a) => a.level === 'group' || a.level === 'total').map((a) => <option key={a.id} value={a.id}>{a.code} · {a.name} ({LEVEL_LABEL[a.level!]})</option>)}
              </select>
              <div className="acc-addacc">
                <input className="tool-text-input" type="text" inputMode="numeric" dir="ltr" placeholder="کد" value={aCode} onChange={(e) => setACode(e.target.value.replace(/[^0-9]/g, ''))} />
                <input className="tool-text-input" type="text" placeholder="نامِ حساب" value={aName} onChange={(e) => setAName(e.target.value)} />
              </div>
              {!aParent && (
                <div className="acc-type-pick">
                  {(Object.keys(TYPE_LABEL) as AccType[]).map((t) => (
                    <button key={t} type="button" className={`fund-level-btn ${aType === t ? 'active' : ''}`} onClick={() => setAType(t)}>{TYPE_LABEL[t]}</button>
                  ))}
                </div>
              )}
              <button className="loan-submit" disabled={!aName.trim()} onClick={addAccount}>افزودنِ حساب</button>

              <div className="loan-sched-head"><span>کدینگِ حساب‌ها</span><span className="loan-sched-hint">{accounts.length} حساب</span></div>
              <div className="loan-detail-list">
                {treeOrder.map((a) => {
                  const lvl = a.level || 'sub';
                  return (
                    <div key={a.id} className={`loan-detail-row acc-node lvl-${lvl}`} style={{ paddingInlineStart: 8 + depthOf(a) * 16 }}>
                      <div className="ld-info">
                        <span className="ld-amt">{a.code} · {a.name} {lvl !== 'sub' && lvl !== 'detail' ? <span className="acc-lvl-tag">{LEVEL_LABEL[lvl]}</span> : null}</span>
                        <span className="ld-date">{TYPE_LABEL[a.type]}{isPostable(a) ? '' : ' · سرفصل'}{accUsed(a.id) && isPostable(a) ? ' · در حالِ استفاده' : ''}</span>
                      </div>
                      {!accUsed(a.id) && <button className="fm-notify" title="حذف" onClick={() => deleteAccount(a.id)}>🗑</button>}
                    </div>
                  );
                })}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// ---------------- Guided quick-entry for non-accountants (ثبتِ سریع) ----------------
// The user picks a plain-language operation (receive / pay / sale / purchase / transfer / capital);
// we build the correct balanced double-entry (with VAT where relevant) and show a live preview so
// they learn what is posted. No accounting knowledge required.
type QuickOp = 'receive' | 'pay' | 'sale' | 'purchase' | 'transfer' | 'capital';
const QUICK_OPS: { id: QuickOp; label: string; icon: string }[] = [
  { id: 'sale', label: 'فروش', icon: '🧾' },
  { id: 'purchase', label: 'خرید', icon: '🛒' },
  { id: 'receive', label: 'دریافتِ وجه', icon: '💰' },
  { id: 'pay', label: 'پرداختِ وجه', icon: '💸' },
  { id: 'transfer', label: 'انتقالِ نقد/بانک', icon: '🏦' },
  { id: 'capital', label: 'آورده‌ی سرمایه', icon: '📈' },
];
function QuickEntry({ today, vatRate, postQuick, onDone }: {
  today: { year: number; month: number; day: number };
  vatRate: number;
  postQuick: (date: { y: number; m: number; d: number }, desc: string, spec: { name: string; type: AccType; debit?: number; credit?: number }[]) => boolean;
  onDone: () => void;
}) {
  const [op, setOp] = useState<QuickOp>('sale');
  const [amount, setAmount] = useState('');
  const [channel, setChannel] = useState<'cash' | 'bank'>('cash');   // صندوق یا بانک
  const [onCredit, setOnCredit] = useState(false);                   // نسیه؟
  const [withVat, setWithVat] = useState(true);                      // شاملِ مالیات بر ارزش افزوده؟
  const [asInventory, setAsInventory] = useState(false);            // خرید به‌عنوانِ موجودیِ کالا یا هزینه
  const [desc, setDesc] = useState('');
  const [eY, setEY] = useState(String(today.year)); const [eM, setEM] = useState(String(today.month + 1)); const [eD, setED] = useState(String(today.day));

  const amt = digits(amount);
  const vat = withVat ? Math.round(amt * vatRate / 100) : 0;
  const channelName = channel === 'cash' ? 'صندوق (نقد)' : 'بانک';
  // Build the journal lines for the chosen operation.
  const spec: { name: string; type: AccType; debit?: number; credit?: number }[] = (() => {
    if (amt <= 0) return [];
    switch (op) {
      case 'sale':
        return [
          { name: onCredit ? 'حساب‌های دریافتنی' : channelName, type: 'asset', debit: amt + vat },
          { name: 'فروش', type: 'income', credit: amt },
          ...(vat ? [{ name: 'مالیات بر ارزش افزوده (فروش)', type: 'liability' as AccType, credit: vat }] : []),
        ];
      case 'purchase':
        return [
          { name: asInventory ? 'موجودیِ کالا' : 'هزینه‌های عمومی و اداری', type: asInventory ? 'asset' : 'expense', debit: amt },
          ...(vat ? [{ name: 'مالیات بر ارزش افزوده (خرید)', type: 'asset' as AccType, debit: vat }] : []),
          { name: onCredit ? 'حساب‌های پرداختنی' : channelName, type: onCredit ? 'liability' : 'asset', credit: amt + vat },
        ];
      case 'receive':
        return [
          { name: channelName, type: 'asset', debit: amt },
          { name: onCredit ? 'حساب‌های دریافتنی' : 'درآمدِ خدمات', type: onCredit ? 'asset' : 'income', credit: amt },
        ];
      case 'pay':
        return [
          { name: onCredit ? 'حساب‌های پرداختنی' : 'هزینه‌های عمومی و اداری', type: onCredit ? 'liability' : 'expense', debit: amt },
          { name: channelName, type: 'asset', credit: amt },
        ];
      case 'transfer':
        return channel === 'bank'
          ? [{ name: 'بانک', type: 'asset', debit: amt }, { name: 'صندوق (نقد)', type: 'asset', credit: amt }]
          : [{ name: 'صندوق (نقد)', type: 'asset', debit: amt }, { name: 'بانک', type: 'asset', credit: amt }];
      case 'capital':
        return [{ name: channelName, type: 'asset', debit: amt }, { name: 'سرمایه', type: 'equity', credit: amt }];
    }
  })();
  const submit = () => {
    const m0 = Math.min(11, Math.max(0, (digits(eM) || 1) - 1));
    const ok = postQuick({ y: digits(eY) || today.year, m: m0, d: Math.min(31, Math.max(1, digits(eD) || 1)) }, desc.trim() || QUICK_OPS.find((q) => q.id === op)!.label, spec);
    if (ok) { setAmount(''); setDesc(''); onDone(); }
  };
  const showChannel = op !== 'transfer' ? true : true;       // channel meaningful for all; for transfer it is the direction
  const showCredit = op === 'sale' || op === 'purchase' || op === 'receive' || op === 'pay';
  const showVat = op === 'sale' || op === 'purchase';

  return (
    <>
      <div className="fund-help">عملیات را به زبانِ ساده انتخاب کنید؛ سندِ حسابداریِ درست (با مالیات بر ارزش افزوده) خودکار ساخته می‌شود. نیازی به دانشِ حسابداری نیست.</div>
      <div className="acc-quick-ops">
        {QUICK_OPS.map((q) => (
          <button key={q.id} type="button" className={`acc-quick-op ${op === q.id ? 'active' : ''}`} onClick={() => setOp(q.id)}><span className="aqo-ic">{q.icon}</span>{q.label}</button>
        ))}
      </div>

      <label className="field-label">مبلغ (تومان){showVat ? ' — بدونِ مالیات' : ''}</label>
      <input className="tool-text-input" type="text" inputMode="numeric" dir="ltr" placeholder="مثلاً 1,000,000" value={amount} onChange={(e) => setAmount(withSep(e.target.value))} />

      {showChannel && (
        <div className="acc-quick-seg">
          <button type="button" className={`mini-toggle-btn ${channel === 'cash' ? 'active' : ''}`} onClick={() => setChannel('cash')}>{op === 'transfer' ? 'از بانک به صندوق' : 'صندوق (نقد)'}</button>
          <button type="button" className={`mini-toggle-btn ${channel === 'bank' ? 'active' : ''}`} onClick={() => setChannel('bank')}>{op === 'transfer' ? 'از صندوق به بانک' : 'بانک'}</button>
        </div>
      )}
      {showCredit && (
        <label className="fund-switch"><input type="checkbox" checked={onCredit} onChange={(e) => setOnCredit(e.target.checked)} /><span>{op === 'sale' || op === 'receive' ? 'نسیه (طلب از طرفِ حساب)' : 'نسیه (بدهی به طرفِ حساب)'}</span></label>
      )}
      {op === 'purchase' && (
        <label className="fund-switch"><input type="checkbox" checked={asInventory} onChange={(e) => setAsInventory(e.target.checked)} /><span>ثبت به‌عنوانِ «موجودیِ کالا» (نه هزینه)</span></label>
      )}
      {showVat && (
        <label className="fund-switch"><input type="checkbox" checked={withVat} onChange={(e) => setWithVat(e.target.checked)} /><span>شاملِ مالیات بر ارزش افزوده ({vatRate}٪){vat ? ` = ${fmt(vat)}` : ''}</span></label>
      )}

      <label className="field-label">شرح (اختیاری)</label>
      <input className="tool-text-input" type="text" placeholder="مثلاً فروشِ فاکتورِ ۱۲۳" value={desc} onChange={(e) => setDesc(e.target.value)} />
      <label className="field-label">تاریخ (روز / ماه / سال)</label>
      <div className="acc-date">
        <input className="tool-text-input" type="number" inputMode="numeric" dir="ltr" value={eD} onChange={(e) => setED(e.target.value.replace(/[^0-9]/g, ''))} />
        <input className="tool-text-input" type="number" inputMode="numeric" dir="ltr" value={eM} onChange={(e) => setEM(e.target.value.replace(/[^0-9]/g, ''))} />
        <input className="tool-text-input" type="number" inputMode="numeric" dir="ltr" value={eY} onChange={(e) => setEY(e.target.value.replace(/[^0-9]/g, ''))} />
      </div>

      {/* live preview of the double-entry that will be posted */}
      {spec.length > 0 && (
        <div className="acc-preview">
          <div className="acc-preview-title">پیش‌نمایشِ سند</div>
          {spec.map((s, i) => (
            <div key={i} className="acc-preview-row">
              <span>{s.name}</span>
              <span className={s.debit ? 'aqp-d' : 'aqp-c'}>{s.debit ? `بدهکار ${fmt(s.debit)}` : `بستانکار ${fmt(s.credit || 0)}`}</span>
            </div>
          ))}
        </div>
      )}
      <button className="loan-submit" disabled={amt <= 0} onClick={submit}>ثبتِ سند</button>
    </>
  );
}
