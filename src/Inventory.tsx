// Inventory module for simorgh-ledger.
// Goal vs Mahak/Rahkaran: a simple, mobile/cloud, integrated warehouse:
// items + stock in/out, live stock & value, printable report, and AUTOMATIC accounting:
// every purchase/sale auto-posts a balanced journal entry (and is removed if the txn is deleted).
import { useState } from 'react';
import { getToday, getMonthNames } from './calendar';
import type { AccType } from './Accounting';

const fmt = (n: number): string => Math.round(n || 0).toLocaleString('en-US');
const digits = (s: string): number => parseInt((s || '').replace(/[^0-9]/g, ''), 10) || 0;
const withSep = (s: string): string => { const d = digits(s); return d ? d.toLocaleString('en-US') : ''; };

export interface InvItem { id: string; name: string; code?: string; unit?: string; buy?: number; sell?: number; }
export interface InvTxn { id: string; itemId: string; kind: 'in' | 'out'; qty: number; price: number; y: number; m: number; d: number; }
export interface InventoryState { items: InvItem[]; txns: InvTxn[]; }

export function emptyInventory(): InventoryState { return { items: [], txns: [] }; }

// Accounting spec line type (matches App.postJournal/upsertJournal/removeJournal signatures).
type Spec = { type: AccType; name?: string; debit?: number; credit?: number }[];
interface Props {
  state: InventoryState;
  onChange: (s: InventoryState) => void;
  onClose: () => void;
  confirm: (msg: string, onYes: () => void) => void;
  // Auto-accounting hooks (optional): post/update a journal entry, or remove it on delete.
  onPostJournal?: (ref: string, date: { y: number; m: number; d: number }, desc: string, spec: Spec) => void;
  onRemoveJournal?: (ref: string) => void;
}
type Tab = 'items' | 'move' | 'report';

export default function InventoryPanel({ state, onChange, onClose, confirm, onPostJournal, onRemoveJournal }: Props) {
  const items = state.items || [];
  const txns = state.txns || [];
  const monthNames = getMonthNames('jalali');
  const today = getToday('jalali');
  const [tab, setTab] = useState<Tab>(items.length ? 'move' : 'items');

  const itemById = (id: string) => items.find((i) => i.id === id);
  const stockOf = (id: string) => txns.reduce((s, t) => s + (t.itemId === id ? (t.kind === 'in' ? t.qty : -t.qty) : 0), 0);

  // ---------- items ----------
  const [iName, setIName] = useState(''); const [iCode, setICode] = useState(''); const [iUnit, setIUnit] = useState('عدد');
  const [iBuy, setIBuy] = useState(''); const [iSell, setISell] = useState('');
  const addItem = () => {
    if (!iName.trim()) return;
    const it: InvItem = { id: `it-${Date.now()}`, name: iName.trim(), code: iCode.trim() || undefined, unit: iUnit.trim() || 'عدد', buy: digits(iBuy) || undefined, sell: digits(iSell) || undefined };
    onChange({ items: [...items, it], txns });
    setIName(''); setICode(''); setIBuy(''); setISell('');
  };
  const delItem = (id: string) => {
    if (txns.some((t) => t.itemId === id)) { confirm('این کالا گردش دارد و حذف نمی‌شود.', () => {}); return; }
    confirm('این کالا حذف شود؟', () => onChange({ items: items.filter((i) => i.id !== id), txns }));
  };

  // ---------- stock movement (in/out) ----------
  const [mItem, setMItem] = useState<string>(items[0]?.id || '');
  const [mKind, setMKind] = useState<'in' | 'out'>('in');
  const [mQty, setMQty] = useState(''); const [mPrice, setMPrice] = useState('');

  // Build the accounting spec for a transaction (purchase or sale).
  const journalSpec = (t: InvTxn): Spec => {
    if (t.kind === 'in') {
      // Purchase: Debit Inventory (asset)  /  Credit Cash (asset)
      const amount = t.qty * t.price;
      return [{ type: 'asset', name: 'موجودیِ کالا', debit: amount }, { type: 'asset', name: 'صندوق (نقد)', credit: amount }];
    }
    // Sale (compound, balanced): Debit Cash + Debit COGS  /  Credit Sales + Credit Inventory
    const it = itemById(t.itemId);
    const revenue = t.qty * t.price;
    const cost = t.qty * (it?.buy || 0);
    return [
      { type: 'asset', name: 'صندوق (نقد)', debit: revenue },
      { type: 'income', name: 'فروش', credit: revenue },
      ...(cost > 0 ? [{ type: 'expense' as AccType, name: 'بهای تمام‌شده‌ی کالای فروش‌رفته', debit: cost }, { type: 'asset' as AccType, name: 'موجودیِ کالا', credit: cost }] : []),
    ];
  };
  const addTxn = () => {
    const item = itemById(mItem); if (!item) return;
    const qty = digits(mQty); const price = digits(mPrice) || (mKind === 'in' ? item.buy : item.sell) || 0;
    if (qty <= 0) return;
    if (mKind === 'out' && qty > stockOf(mItem)) { confirm(`موجودیِ کافی نیست (موجودی: ${stockOf(mItem)}).`, () => {}); return; }
    const t: InvTxn = { id: `tx-${Date.now()}`, itemId: mItem, kind: mKind, qty, price, y: today.year, m: today.month, d: today.day };
    onChange({ items, txns: [...txns, t] });
    // Auto-post to accounting (kept in sync via ref = inv-<txnId>).
    if (onPostJournal) onPostJournal(`inv-${t.id}`, { y: t.y, m: t.m, d: t.d }, `${mKind === 'in' ? 'خریدِ' : 'فروشِ'} ${item.name} (${qty} ${item.unit || ''})`, journalSpec(t));
    setMQty(''); setMPrice('');
  };
  const delTxn = (t: InvTxn) => confirm('این گردش حذف شود؟', () => {
    onChange({ items, txns: txns.filter((x) => x.id !== t.id) });
    if (onRemoveJournal) onRemoveJournal(`inv-${t.id}`);   // remove its auto-posted journal entry
  });

  const totalValue = items.reduce((s, i) => s + stockOf(i.id) * (i.buy || 0), 0);
  const sortedTxns = txns.slice().sort((a, b) => (b.y * 10000 + b.m * 100 + b.d) - (a.y * 10000 + a.m * 100 + a.d) || b.id.localeCompare(a.id));
  const dstr = (t: InvTxn) => `${t.d} ${monthNames[t.m]} ${t.y}`;

  return (
    <div className="modal" onClick={onClose}>
      <div className="modal-box tool-panel" onClick={(e) => e.stopPropagation()}>
        <div className="tool-panel-head">
          <button className="close-modal" onClick={onClose}>‹</button>
          <h3>📦 انبار</h3>
          <button className="close-modal" onClick={onClose}>✕</button>
        </div>
        <div className="tool-panel-body">
          <div className="mini-toggle fund-tabs">
            <button type="button" className={`mini-toggle-btn ${tab === 'move' ? 'active' : ''}`} onClick={() => setTab('move')}>ورود/خروج</button>
            <button type="button" className={`mini-toggle-btn ${tab === 'report' ? 'active' : ''}`} onClick={() => setTab('report')}>موجودی</button>
            <button type="button" className={`mini-toggle-btn ${tab === 'items' ? 'active' : ''}`} onClick={() => setTab('items')}>کالاها</button>
          </div>

          {/* ---------------- stock movement ---------------- */}
          {tab === 'move' && (items.length === 0 ? (
            <div className="tool-note">اول از تبِ «کالاها» چند کالا تعریف کنید.</div>
          ) : (
            <>
              <div className="mini-toggle">
                <button type="button" className={`mini-toggle-btn ${mKind === 'in' ? 'active' : ''}`} onClick={() => setMKind('in')}>ورود (خرید)</button>
                <button type="button" className={`mini-toggle-btn ${mKind === 'out' ? 'active' : ''}`} onClick={() => setMKind('out')}>خروج (فروش)</button>
              </div>
              <label className="field-label">کالا</label>
              <select className="tool-text-input" value={mItem} onChange={(e) => setMItem(e.target.value)}>
                {items.map((i) => <option key={i.id} value={i.id}>{i.name} (موجودی: {stockOf(i.id)})</option>)}
              </select>
              <div className="att-addgrid">
                <input className="tool-text-input" type="text" inputMode="numeric" dir="ltr" placeholder="تعداد" value={mQty} onChange={(e) => setMQty(e.target.value.replace(/[^0-9]/g, ''))} />
                <input className="tool-text-input" type="text" inputMode="numeric" dir="ltr" placeholder={mKind === 'in' ? 'قیمتِ خرید' : 'قیمتِ فروش'} value={mPrice} onChange={(e) => setMPrice(withSep(e.target.value))} />
              </div>
              <div className="tool-note">اگر قیمت را خالی بگذارید، قیمتِ پیش‌فرضِ کالا استفاده می‌شود. هر ثبت، خودکار سندِ حسابداری می‌زند.</div>
              <button className="loan-submit" onClick={addTxn}>ثبتِ {mKind === 'in' ? 'ورود' : 'خروج'}</button>

              <div className="loan-sched-head"><span>آخرین گردش‌ها</span></div>
              <div className="loan-detail-list">
                {sortedTxns.slice(0, 20).map((t) => { const it = itemById(t.itemId); return (
                  <div key={t.id} className="loan-detail-row">
                    <div className="ld-info">
                      <span className="ld-amt">{it?.name || '—'} <span className="fm-shares">{t.kind === 'in' ? '+' : '−'}{t.qty}</span></span>
                      <span className="ld-date">{dstr(t)} · {t.kind === 'in' ? 'خرید' : 'فروش'} · {fmt(t.qty * t.price)} تومان</span>
                    </div>
                    <button className="fm-notify" title="حذف" onClick={() => delTxn(t)}>🗑</button>
                  </div>
                ); })}
              </div>
            </>
          ))}

          {/* ---------------- stock report ---------------- */}
          {tab === 'report' && (
            <>
              <div className="acc-print">
                <div className="acc-print-title">موجودیِ انبار</div>
                <table className="acc-table">
                  <thead><tr><th>کالا</th><th>موجودی</th><th>قیمتِ خرید</th><th>ارزش</th></tr></thead>
                  <tbody>
                    {items.length === 0 ? (
                      <tr><td colSpan={4} style={{ textAlign: 'center', opacity: .6 }}>کالایی ثبت نشده</td></tr>
                    ) : items.map((i) => { const q = stockOf(i.id); return (
                      <tr key={i.id}><td>{i.name}{i.unit ? ` (${i.unit})` : ''}</td><td>{q}</td><td>{fmt(i.buy || 0)}</td><td>{fmt(q * (i.buy || 0))}</td></tr>
                    ); })}
                    <tr className="acc-total"><td>ارزشِ کلِ انبار</td><td colSpan={2}></td><td>{fmt(totalValue)}</td></tr>
                  </tbody>
                </table>
              </div>
              <button className="loan-submit acc-noprint" onClick={() => window.print()}>🖨️ چاپ / ذخیره‌ی PDF</button>
            </>
          )}

          {/* ---------------- items ---------------- */}
          {tab === 'items' && (
            <>
              <div className="loan-sched-head"><span>افزودنِ کالا</span></div>
              <input className="tool-text-input" type="text" placeholder="نامِ کالا" value={iName} onChange={(e) => setIName(e.target.value)} />
              <div className="att-addgrid">
                <input className="tool-text-input" type="text" inputMode="numeric" dir="ltr" placeholder="کد" value={iCode} onChange={(e) => setICode(e.target.value.replace(/[^0-9]/g, ''))} />
                <input className="tool-text-input" type="text" placeholder="واحد (عدد)" value={iUnit} onChange={(e) => setIUnit(e.target.value)} />
              </div>
              <div className="att-addgrid">
                <input className="tool-text-input" type="text" inputMode="numeric" dir="ltr" placeholder="قیمتِ خرید" value={iBuy} onChange={(e) => setIBuy(withSep(e.target.value))} />
                <input className="tool-text-input" type="text" inputMode="numeric" dir="ltr" placeholder="قیمتِ فروش" value={iSell} onChange={(e) => setISell(withSep(e.target.value))} />
              </div>
              <button className="loan-submit" disabled={!iName.trim()} onClick={addItem}>افزودنِ کالا</button>

              <div className="loan-sched-head"><span>فهرستِ کالاها</span><span className="loan-sched-hint">{items.length} کالا</span></div>
              <div className="loan-detail-list">
                {items.map((i) => (
                  <div key={i.id} className="loan-detail-row">
                    <div className="ld-info">
                      <span className="ld-amt">{i.name} <span className="fm-shares">موجودی: {stockOf(i.id)} {i.unit}</span></span>
                      <span className="ld-date">{i.buy ? `خرید ${fmt(i.buy)}` : ''}{i.sell ? ` · فروش ${fmt(i.sell)}` : ''}</span>
                    </div>
                    <button className="fm-notify" title="حذف" onClick={() => delItem(i.id)}>🗑</button>
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
