// Inventory module for simorgh-ledger.
// Goal vs Mahak/Rahkaran: a simple, mobile/cloud, integrated warehouse:
// items + stock in/out, live stock & value, printable report, and AUTOMATIC accounting:
// every purchase/sale auto-posts a balanced journal entry (and is removed if the txn is deleted).
import { useState, useEffect, useRef } from 'react';
import { BrowserMultiFormatReader, type IScannerControls } from '@zxing/browser';
import { getToday, getMonthNames } from './calendar';
import { downloadCsv } from './csv';
import { code39Bars, cleanBarcode, genBarcode } from './barcode';
import type { AccType } from './Accounting';

const fmt = (n: number): string => Math.round(n || 0).toLocaleString('en-US');
const digits = (s: string): number => parseInt((s || '').replace(/[^0-9]/g, ''), 10) || 0;
const withSep = (s: string): string => { const d = digits(s); return d ? d.toLocaleString('en-US') : ''; };

// barcode = scannable code; location = shelf/row/slot; partnerCode = کد همکار; stdCode = کد استانداردِ شرکت.
export interface InvItem { id: string; name: string; code?: string; unit?: string; buy?: number; sell?: number; barcode?: string; location?: string; partnerCode?: string; stdCode?: string; }
export interface InvTxn { id: string; itemId: string; kind: 'in' | 'out'; qty: number; price: number; y: number; m: number; d: number; }
export interface InventoryState { items: InvItem[]; txns: InvTxn[]; }

export function emptyInventory(): InventoryState { return { items: [], txns: [] }; }

// Inline SVG barcode (Code39) — renders the filled bars; used on-screen and for printable labels.
function Barcode({ value, height = 48 }: { value: string; height?: number }) {
  const { bars, width } = code39Bars(value);
  if (!value) return null;
  return (
    <svg className="inv-barcode" viewBox={`0 0 ${width} ${height}`} width="100%" height={height} preserveAspectRatio="none" role="img" aria-label={value}>
      <rect x={0} y={0} width={width} height={height} fill="#fff" />
      {bars.map((b, i) => <rect key={i} x={b.x} y={0} width={b.w} height={height} fill="#000" />)}
    </svg>
  );
}

// Camera-based barcode scanner (turns the phone into a scanner). Uses ZXing, which decodes 1D/2D barcodes
// from the camera in pure JS — so it works in the Android app WebView too, not only browsers with
// BarcodeDetector. The mobile app requests CAMERA permission natively (see MainActivity).
function CameraScanner({ onResult, onClose }: { onResult: (code: string) => void; onClose: () => void }) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const cbRef = useRef(onResult); cbRef.current = onResult;
  const [err, setErr] = useState('');
  useEffect(() => {
    const reader = new BrowserMultiFormatReader();
    let controls: IScannerControls | null = null; let done = false;
    (async () => {
      try {
        controls = await reader.decodeFromVideoDevice(undefined, videoRef.current!, (result, _e, ctrls) => {
          if (result && !done) { done = true; ctrls.stop(); cbRef.current(result.getText().trim()); }
        });
      } catch {
        setErr('دسترسی به دوربین ممکن نشد. اجازه‌ی دوربین را بدهید، یا از اسکنرِ سخت‌افزاری/واردکردنِ دستی استفاده کنید.');
      }
    })();
    return () => { done = true; try { controls?.stop(); } catch { /* ignore */ } };
  }, []);
  return (
    <div className="modal" onClick={onClose}>
      <div className="modal-box inv-cam" onClick={(e) => e.stopPropagation()}>
        <div className="tool-panel-head"><span /><h3>اسکنِ بارکد با دوربین</h3><button className="close-modal" onClick={onClose}>✕</button></div>
        {err ? <div className="tool-note" style={{ padding: 16 }}>{err}</div> : <video ref={videoRef} className="inv-cam-video" playsInline muted />}
        <div className="tool-note" style={{ padding: '8px 12px' }}>بارکد را مقابلِ دوربین بگیرید؛ پس از تشخیص خودکار بسته می‌شود.</div>
      </div>
    </div>
  );
}

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

  const itemByBarcode = (bc: string) => { const c = cleanBarcode(bc); return items.find((i) => cleanBarcode(i.barcode || '') === c || cleanBarcode(i.code || '') === c || cleanBarcode(i.stdCode || '') === c); };

  // ---------- items ----------
  const [iName, setIName] = useState(''); const [iCode, setICode] = useState(''); const [iUnit, setIUnit] = useState('عدد');
  const [iBuy, setIBuy] = useState(''); const [iSell, setISell] = useState('');
  const [iBarcode, setIBarcode] = useState(''); const [iLoc, setILoc] = useState(''); const [iPartner, setIPartner] = useState(''); const [iStd, setIStd] = useState('');
  const [labelItem, setLabelItem] = useState<InvItem | null>(null);  // item whose barcode label is being printed
  const addItem = () => {
    if (!iName.trim()) return;
    // Auto-print barcode: generate one if the user didn't supply it.
    const barcode = cleanBarcode(iBarcode) || genBarcode();
    const it: InvItem = { id: `it-${Date.now()}`, name: iName.trim(), code: iCode.trim() || undefined, unit: iUnit.trim() || 'عدد', buy: digits(iBuy) || undefined, sell: digits(iSell) || undefined, barcode, location: iLoc.trim() || undefined, partnerCode: iPartner.trim() || undefined, stdCode: iStd.trim() || undefined };
    onChange({ items: [...items, it], txns });
    setIName(''); setICode(''); setIBuy(''); setISell(''); setIBarcode(''); setILoc(''); setIPartner(''); setIStd('');
    setLabelItem(it);   // show its printable barcode label immediately
  };
  const delItem = (id: string) => {
    if (txns.some((t) => t.itemId === id)) { confirm('این کالا گردش دارد و حذف نمی‌شود.', () => {}); return; }
    confirm('این کالا حذف شود؟', () => onChange({ items: items.filter((i) => i.id !== id), txns }));
  };

  // ---------- stock movement (in/out) ----------
  const [mItem, setMItem] = useState<string>(items[0]?.id || '');
  const [mKind, setMKind] = useState<'in' | 'out'>('in');
  const [mQty, setMQty] = useState(''); const [mPrice, setMPrice] = useState('');
  // ---------- barcode scanning (hardware wedge + phone camera) ----------
  const [scan, setScan] = useState('');
  const [showCam, setShowCam] = useState<null | 'move' | 'item'>(null);
  const [scanMsg, setScanMsg] = useState('');           // استعلام: last scan result (name/stock/price)
  // Handle a scanned/typed barcode in the movement tab: select the matching item and show its info.
  const onScanMove = (code: string) => {
    const it = itemByBarcode(code); setScan('');
    if (!it) { setScanMsg(`بارکدِ «${code}» در انبار نیست. در تبِ «کالاها» ثبتش کنید.`); return; }
    setMItem(it.id);
    setScanMsg(`${it.name} · موجودی: ${stockOf(it.id)} ${it.unit || ''} · فروش: ${fmt(it.sell || 0)} · جایگاه: ${it.location || '—'}`);
  };

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
              {/* بارکدخوان: اسکنرِ سخت‌افزاری مثلِ صفحه‌کلید تایپ می‌کند و Enter می‌زند؛ یا با دوربینِ گوشی */}
              <label className="field-label">اسکنِ بارکد (استعلام/انتخاب)</label>
              <div className="att-addgrid">
                <input className="tool-text-input" type="text" dir="ltr" autoFocus placeholder="بارکد را بخوانید یا تایپ کنید…" value={scan} onChange={(e) => setScan(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && scan.trim()) onScanMove(scan.trim()); }} />
                <button className="acc-addline" onClick={() => setShowCam('move')}>📷 دوربین</button>
              </div>
              {scanMsg && <div className="inv-scanmsg">{scanMsg}</div>}
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
              <button className="acc-addline acc-noprint" onClick={() => downloadCsv('inventory.csv', [['کالا', 'واحد', 'موجودی', 'قیمتِ خرید', 'ارزش'], ...items.map((i) => [i.name, i.unit || '', stockOf(i.id), i.buy || 0, stockOf(i.id) * (i.buy || 0)]), ['جمع', '', '', '', totalValue]])}>📤 خروجیِ اکسل (CSV)</button>
            </>
          )}

          {/* ---------------- items ---------------- */}
          {tab === 'items' && (
            <>
              <div className="loan-sched-head"><span>افزودنِ کالا به انبار</span></div>
              <input className="tool-text-input" type="text" placeholder="نامِ کالا" value={iName} onChange={(e) => setIName(e.target.value)} />
              <label className="field-label">بارکد (خالی بگذارید تا خودکار ساخته و چاپ شود)</label>
              <div className="att-addgrid">
                <input className="tool-text-input" type="text" dir="ltr" placeholder="بارکدِ کالا" value={iBarcode} onChange={(e) => setIBarcode(e.target.value)} />
                <button className="acc-addline" onClick={() => setShowCam('item')}>📷 اسکن</button>
              </div>
              <div className="att-addgrid">
                <input className="tool-text-input" type="text" placeholder="جایگاه (قفسه/ردیف)" value={iLoc} onChange={(e) => setILoc(e.target.value)} />
                <input className="tool-text-input" type="text" placeholder="واحد (عدد)" value={iUnit} onChange={(e) => setIUnit(e.target.value)} />
              </div>
              <div className="att-addgrid">
                <input className="tool-text-input" type="text" placeholder="کدِ همکار" value={iPartner} onChange={(e) => setIPartner(e.target.value)} />
                <input className="tool-text-input" type="text" placeholder="کدِ استانداردِ شرکت" value={iStd} onChange={(e) => setIStd(e.target.value)} />
              </div>
              <div className="att-addgrid">
                <input className="tool-text-input" type="text" inputMode="numeric" dir="ltr" placeholder="قیمتِ خرید" value={iBuy} onChange={(e) => setIBuy(withSep(e.target.value))} />
                <input className="tool-text-input" type="text" inputMode="numeric" dir="ltr" placeholder="قیمتِ فروش" value={iSell} onChange={(e) => setISell(withSep(e.target.value))} />
              </div>
              <button className="loan-submit" disabled={!iName.trim()} onClick={addItem}>افزودن و ساختِ بارکد</button>

              {/* printable barcode label of the just-added (or chosen) item */}
              {labelItem && (
                <div className="inv-label-wrap">
                  <div className="inv-label acc-print">
                    <div className="inv-label-name">{labelItem.name}</div>
                    {labelItem.location && <div className="inv-label-sub">جایگاه: {labelItem.location}</div>}
                    <Barcode value={labelItem.barcode || ''} />
                    <div className="inv-label-code">{labelItem.barcode}</div>
                  </div>
                  <button className="loan-submit acc-noprint" onClick={() => window.print()}>🖨️ چاپِ بارکد / لیبل</button>
                </div>
              )}

              <div className="loan-sched-head"><span>فهرستِ کالاها</span><span className="loan-sched-hint">{items.length} کالا</span></div>
              <div className="loan-detail-list">
                {items.map((i) => (
                  <div key={i.id} className="loan-detail-row">
                    <div className="ld-info">
                      <span className="ld-amt">{i.name} <span className="fm-shares">موجودی: {stockOf(i.id)} {i.unit}</span></span>
                      <span className="ld-date">بارکد: {i.barcode || '—'}{i.location ? ` · جایگاه: ${i.location}` : ''}{i.stdCode ? ` · کد: ${i.stdCode}` : ''}</span>
                    </div>
                    <button className="att-inlinebtn" title="چاپِ بارکد" onClick={() => setLabelItem(i)}>🏷</button>
                    <button className="fm-notify" title="حذف" onClick={() => delItem(i.id)}>🗑</button>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      </div>
      {showCam && (
        <CameraScanner
          onClose={() => setShowCam(null)}
          onResult={(code) => {
            const c = cleanBarcode(code);
            if (showCam === 'item') setIBarcode(c); else onScanMove(c);
            setShowCam(null);
          }}
        />
      )}
    </div>
  );
}
