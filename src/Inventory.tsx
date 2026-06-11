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
// minStock = reorder point (نقطه سفارش): when total stock drops to/below it, the item is flagged low.
export interface InvItem { id: string; name: string; code?: string; unit?: string; buy?: number; sell?: number; barcode?: string; location?: string; partnerCode?: string; stdCode?: string; groupId?: string; minStock?: number; }
// Hierarchical product group (گروه کالا), e.g. الکتریکال › اندازه‌گیری. `parent` empty = top level.
export interface ItemGroup { id: string; name: string; parent?: string; }
// A company/shop may have several warehouses (انبار), each split into sections (بخش).
export interface Warehouse { id: string; name: string; }
export interface Section { id: string; name: string; warehouseId: string; }
// Each movement records which warehouse (and optional section) it happened in, so stock is per-warehouse.
// A transfer between warehouses is stored as a linked out+in pair (transferId) and is NOT a sale/purchase.
export interface InvTxn { id: string; itemId: string; kind: 'in' | 'out'; qty: number; price: number; y: number; m: number; d: number; warehouseId?: string; sectionId?: string; transferId?: string; }
export interface InventoryState { items: InvItem[]; txns: InvTxn[]; groups?: ItemGroup[]; warehouses?: Warehouse[]; sections?: Section[]; }

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
  // Stock for an item; pass a warehouse id to restrict to that warehouse (undefined = all warehouses).
  // Legacy transactions without a warehouseId are treated as the unspecified ('') warehouse.
  const stockOf = (id: string, wh?: string) => txns.reduce((s, t) => {
    if (t.itemId !== id) return s;
    if (wh !== undefined && (t.warehouseId || '') !== (wh || '')) return s;
    return s + (t.kind === 'in' ? t.qty : -t.qty);
  }, 0);

  // ---------- warehouses (انبار) & sections (بخش) ----------
  const warehouses = state.warehouses || [];
  const sections = state.sections || [];
  const whName = (id?: string) => warehouses.find((w) => w.id === id)?.name || (id ? id : 'انبارِ پیش‌فرض');
  const sectionsOf = (whId: string) => sections.filter((s) => s.warehouseId === whId);
  const [wName, setWName] = useState(''); const [secName, setSecName] = useState(''); const [secWh, setSecWh] = useState('');
  const addWarehouse = () => { if (!wName.trim()) return; onChange({ ...state, warehouses: [...warehouses, { id: `wh-${Date.now()}`, name: wName.trim() }] }); setWName(''); };
  const addSection = () => { if (!secName.trim() || !secWh) return; onChange({ ...state, sections: [...sections, { id: `sec-${Date.now()}`, name: secName.trim(), warehouseId: secWh }] }); setSecName(''); };
  const whUsed = (id: string) => txns.some((t) => t.warehouseId === id) || sections.some((s) => s.warehouseId === id);
  const delWarehouse = (id: string) => { if (whUsed(id)) { confirm('این انبار بخش یا گردش دارد و حذف نمی‌شود.', () => {}); return; } confirm('این انبار حذف شود؟', () => onChange({ ...state, warehouses: warehouses.filter((w) => w.id !== id) })); };
  const delSection = (id: string) => { if (txns.some((t) => t.sectionId === id)) { confirm('این بخش گردش دارد و حذف نمی‌شود.', () => {}); return; } confirm('این بخش حذف شود؟', () => onChange({ ...state, sections: sections.filter((s) => s.id !== id) })); };

  const itemByBarcode = (bc: string) => { const c = cleanBarcode(bc); return items.find((i) => cleanBarcode(i.barcode || '') === c || cleanBarcode(i.code || '') === c || cleanBarcode(i.stdCode || '') === c); };
  // Low-stock = total stock at or below the reorder point (only items that set one).
  const isLow = (i: InvItem) => (i.minStock || 0) > 0 && stockOf(i.id) <= (i.minStock || 0);
  const lowItems = () => items.filter(isLow);

  // ---------- product groups (گروه کالا) ----------
  const groups = state.groups || [];
  const groupById = (id?: string) => groups.find((g) => g.id === id);
  // "الکتریکال › اندازه‌گیری" path for a group id.
  const groupPath = (id?: string): string => {
    const parts: string[] = []; const seen = new Set<string>(); let cur = id;
    while (cur && !seen.has(cur)) { seen.add(cur); const g = groupById(cur); if (!g) break; parts.unshift(g.name); cur = g.parent; }
    return parts.join(' › ');
  };
  const groupDepth = (g: ItemGroup): number => { let d = 0, p = g.parent; const seen = new Set<string>(); while (p && !seen.has(p)) { seen.add(p); d++; p = groupById(p)?.parent; } return d; };
  // Groups ordered as a tree (parents before children), sorted by name.
  const groupTree = (() => {
    const out: ItemGroup[] = []; const byParent: { [k: string]: ItemGroup[] } = {};
    groups.forEach((g) => { const k = g.parent || '__root'; (byParent[k] = byParent[k] || []).push(g); });
    Object.values(byParent).forEach((arr) => arr.sort((a, b) => a.name.localeCompare(b.name, 'fa')));
    const walk = (key: string) => { (byParent[key] || []).forEach((g) => { out.push(g); walk(g.id); }); };
    walk('__root'); return out;
  })();
  const groupHasChildren = (id: string) => groups.some((g) => g.parent === id);
  const [gName, setGName] = useState(''); const [gParent, setGParent] = useState('');
  const addGroup = () => { if (!gName.trim()) return; onChange({ ...state, groups: [...groups, { id: `g-${Date.now()}`, name: gName.trim(), parent: gParent || undefined }] }); setGName(''); };
  const delGroup = (id: string) => {
    if (groupHasChildren(id) || items.some((i) => i.groupId === id)) { confirm('این گروه زیرمجموعه یا کالا دارد و حذف نمی‌شود.', () => {}); return; }
    confirm('این گروهِ کالا حذف شود؟', () => onChange({ ...state, groups: groups.filter((g) => g.id !== id) }));
  };
  // report filters: by group (includes descendants) and by warehouse; matrix = items × warehouses grid
  const [filterGroup, setFilterGroup] = useState('');
  const [filterWh, setFilterWh] = useState('');
  const [matrix, setMatrix] = useState(false);
  const isDescendant = (gid: string | undefined, ancestor: string): boolean => { let cur = gid; const seen = new Set<string>(); while (cur && !seen.has(cur)) { if (cur === ancestor) return true; seen.add(cur); cur = groupById(cur)?.parent; } return false; };
  const inFilter = (it: InvItem) => !filterGroup || isDescendant(it.groupId, filterGroup);

  // ---------- items ----------
  const [iName, setIName] = useState(''); const [iCode, setICode] = useState(''); const [iUnit, setIUnit] = useState('عدد');
  const [iBuy, setIBuy] = useState(''); const [iSell, setISell] = useState('');
  const [iBarcode, setIBarcode] = useState(''); const [iLoc, setILoc] = useState(''); const [iPartner, setIPartner] = useState(''); const [iStd, setIStd] = useState(''); const [iGroup, setIGroup] = useState(''); const [iMin, setIMin] = useState('');
  const [labelItem, setLabelItem] = useState<InvItem | null>(null);  // item whose barcode label is being printed
  const addItem = () => {
    if (!iName.trim()) return;
    // Auto-print barcode: generate one if the user didn't supply it.
    const barcode = cleanBarcode(iBarcode) || genBarcode();
    const it: InvItem = { id: `it-${Date.now()}`, name: iName.trim(), code: iCode.trim() || undefined, unit: iUnit.trim() || 'عدد', buy: digits(iBuy) || undefined, sell: digits(iSell) || undefined, barcode, location: iLoc.trim() || undefined, partnerCode: iPartner.trim() || undefined, stdCode: iStd.trim() || undefined, groupId: iGroup || undefined, minStock: digits(iMin) || undefined };
    onChange({ ...state, items: [...items, it], txns });
    setIName(''); setICode(''); setIBuy(''); setISell(''); setIBarcode(''); setILoc(''); setIPartner(''); setIStd(''); setIMin('');
    setLabelItem(it);   // show its printable barcode label immediately
  };
  const delItem = (id: string) => {
    if (txns.some((t) => t.itemId === id)) { confirm('این کالا گردش دارد و حذف نمی‌شود.', () => {}); return; }
    confirm('این کالا حذف شود؟', () => onChange({ ...state, items: items.filter((i) => i.id !== id), txns }));
  };

  // ---------- stock movement (in/out) ----------
  const [mItem, setMItem] = useState<string>(items[0]?.id || '');
  const [mKind, setMKind] = useState<'in' | 'out' | 'transfer'>('in');
  const [mQty, setMQty] = useState(''); const [mPrice, setMPrice] = useState('');
  const [mWh, setMWh] = useState<string>(warehouses[0]?.id || '');   // انبارِ گردش (یا مبدا برای انتقال)
  const [mSec, setMSec] = useState<string>('');                       // بخشِ گردش (اختیاری)
  const [mWhDest, setMWhDest] = useState<string>('');                 // انبارِ مقصد (برای انتقال)
  // ---------- barcode scanning (hardware wedge + phone camera) ----------
  const [scan, setScan] = useState('');
  const [showCam, setShowCam] = useState<null | 'move' | 'item'>(null);
  const [scanMsg, setScanMsg] = useState('');           // استعلام: last scan result (name/stock/price)
  // Handle a scanned/typed barcode in the movement tab: select the matching item and show its info.
  const onScanMove = (code: string) => {
    const it = itemByBarcode(code); setScan('');
    if (!it) { setScanMsg(`بارکدِ «${code}» در انبار نیست. در تبِ «کالاها» ثبتش کنید.`); return; }
    setMItem(it.id);
    const whTxt = warehouses.length ? ` · در ${whName(mWh)}: ${stockOf(it.id, mWh)}` : '';
    setScanMsg(`${it.name} · موجودیِ کل: ${stockOf(it.id)} ${it.unit || ''}${whTxt} · فروش: ${fmt(it.sell || 0)} · جایگاه: ${it.location || '—'}`);
  };

  // Inventory account name — per warehouse, so the books show stock value of each warehouse separately
  // (matches the inventory module). Falls back to a single «موجودیِ کالا» when no warehouse is set.
  const invAcct = (whId?: string) => (warehouses.length && whId) ? `موجودیِ کالا (${whName(whId)})` : 'موجودیِ کالا';
  // Build the accounting spec for a transaction (purchase or sale).
  const journalSpec = (t: InvTxn): Spec => {
    if (t.kind === 'in') {
      // Purchase: Debit Inventory (this warehouse)  /  Credit Cash
      const amount = t.qty * t.price;
      return [{ type: 'asset', name: invAcct(t.warehouseId), debit: amount }, { type: 'asset', name: 'صندوق (نقد)', credit: amount }];
    }
    // Sale (compound, balanced): Debit Cash + Debit COGS  /  Credit Sales + Credit Inventory (this warehouse)
    const it = itemById(t.itemId);
    const revenue = t.qty * t.price;
    const cost = t.qty * (it?.buy || 0);
    return [
      { type: 'asset', name: 'صندوق (نقد)', debit: revenue },
      { type: 'income', name: 'فروش', credit: revenue },
      ...(cost > 0 ? [{ type: 'expense' as AccType, name: 'بهای تمام‌شده‌ی کالای فروش‌رفته', debit: cost }, { type: 'asset' as AccType, name: invAcct(t.warehouseId), credit: cost }] : []),
    ];
  };
  const addTxn = () => {
    if (mKind === 'transfer') { addTransfer(); return; }
    const item = itemById(mItem); if (!item) return;
    const qty = digits(mQty); const price = digits(mPrice) || (mKind === 'in' ? item.buy : item.sell) || 0;
    if (qty <= 0) return;
    // Stock check is per the selected warehouse.
    if (mKind === 'out' && qty > stockOf(mItem, mWh)) { confirm(`موجودیِ کافی نیست (موجودیِ ${whName(mWh)}: ${stockOf(mItem, mWh)}).`, () => {}); return; }
    const t: InvTxn = { id: `tx-${Date.now()}`, itemId: mItem, kind: mKind, qty, price, y: today.year, m: today.month, d: today.day, warehouseId: mWh || undefined, sectionId: mSec || undefined };
    onChange({ ...state, items, txns: [...txns, t] });
    // Auto-post to accounting (kept in sync via ref = inv-<txnId>).
    if (onPostJournal) onPostJournal(`inv-${t.id}`, { y: t.y, m: t.m, d: t.d }, `${mKind === 'in' ? 'خریدِ' : 'فروشِ'} ${item.name} (${qty} ${item.unit || ''})`, journalSpec(t));
    setMQty(''); setMPrice('');
  };
  // Transfer between warehouses: stored as a linked out(source)+in(dest) pair; posts ONE balanced journal
  // moving the value (at cost) from the source warehouse's inventory account to the destination's.
  const addTransfer = () => {
    const item = itemById(mItem); if (!item) return;
    const qty = digits(mQty); if (qty <= 0) return;
    if (!mWhDest || mWhDest === mWh) { confirm('انبارِ مقصد را (متفاوت از مبدا) انتخاب کنید.', () => {}); return; }
    if (qty > stockOf(mItem, mWh)) { confirm(`موجودیِ کافی نیست (موجودیِ ${whName(mWh)}: ${stockOf(mItem, mWh)}).`, () => {}); return; }
    const cost = qty * (item.buy || 0);
    const tid = `trf-${Date.now()}`;
    const out: InvTxn = { id: `tx-${Date.now()}o`, itemId: mItem, kind: 'out', qty, price: item.buy || 0, y: today.year, m: today.month, d: today.day, warehouseId: mWh || undefined, transferId: tid };
    const inn: InvTxn = { id: `tx-${Date.now()}i`, itemId: mItem, kind: 'in', qty, price: item.buy || 0, y: today.year, m: today.month, d: today.day, warehouseId: mWhDest, transferId: tid };
    onChange({ ...state, items, txns: [...txns, out, inn] });
    // One journal: Debit Inventory(dest) / Credit Inventory(source) at cost.
    if (onPostJournal && cost > 0) onPostJournal(`inv-${tid}`, { y: today.year, m: today.month, d: today.day }, `انتقالِ ${item.name} از ${whName(mWh)} به ${whName(mWhDest)} (${qty} ${item.unit || ''})`, [
      { type: 'asset', name: invAcct(mWhDest), debit: cost },
      { type: 'asset', name: invAcct(mWh), credit: cost },
    ]);
    setMQty('');
  };
  const delTxn = (t: InvTxn) => confirm(t.transferId ? 'این انتقال (هر دو طرف) حذف شود؟' : 'این گردش حذف شود؟', () => {
    if (t.transferId) {
      onChange({ ...state, items, txns: txns.filter((x) => x.transferId !== t.transferId) });
      if (onRemoveJournal) onRemoveJournal(`inv-${t.transferId}`);
    } else {
      onChange({ ...state, items, txns: txns.filter((x) => x.id !== t.id) });
      if (onRemoveJournal) onRemoveJournal(`inv-${t.id}`);   // remove its auto-posted journal entry
    }
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
                {warehouses.length >= 2 && <button type="button" className={`mini-toggle-btn ${mKind === 'transfer' ? 'active' : ''}`} onClick={() => setMKind('transfer')}>انتقال</button>}
              </div>
              {/* بارکدخوان: اسکنرِ سخت‌افزاری مثلِ صفحه‌کلید تایپ می‌کند و Enter می‌زند؛ یا با دوربینِ گوشی */}
              <label className="field-label">اسکنِ بارکد (استعلام/انتخاب)</label>
              <div className="att-addgrid">
                <input className="tool-text-input" type="text" dir="ltr" autoFocus placeholder="بارکد را بخوانید یا تایپ کنید…" value={scan} onChange={(e) => setScan(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && scan.trim()) onScanMove(scan.trim()); }} />
                <button className="acc-addline" onClick={() => setShowCam('move')}>📷 دوربین</button>
              </div>
              {scanMsg && <div className="inv-scanmsg">{scanMsg}</div>}
              {warehouses.length > 0 && (
                <div className="att-addgrid">
                  <div><label className="field-label">{mKind === 'transfer' ? 'انبارِ مبدا' : 'انبار'}</label>
                    <select className="tool-text-input" value={mWh} onChange={(e) => { setMWh(e.target.value); setMSec(''); }}>
                      {warehouses.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
                    </select>
                  </div>
                  {mKind === 'transfer' ? (
                    <div><label className="field-label">انبارِ مقصد</label>
                      <select className="tool-text-input" value={mWhDest} onChange={(e) => setMWhDest(e.target.value)}>
                        <option value="">— انتخابِ مقصد —</option>
                        {warehouses.filter((w) => w.id !== mWh).map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
                      </select>
                    </div>
                  ) : (
                    <div><label className="field-label">بخش (اختیاری)</label>
                      <select className="tool-text-input" value={mSec} onChange={(e) => setMSec(e.target.value)}>
                        <option value="">— بدون بخش —</option>
                        {sectionsOf(mWh).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                      </select>
                    </div>
                  )}
                </div>
              )}
              <label className="field-label">کالا</label>
              <select className="tool-text-input" value={mItem} onChange={(e) => setMItem(e.target.value)}>
                {items.map((i) => <option key={i.id} value={i.id}>{i.name} (موجودی: {stockOf(i.id, warehouses.length ? mWh : undefined)})</option>)}
              </select>
              <div className="att-addgrid">
                <input className="tool-text-input" type="text" inputMode="numeric" dir="ltr" placeholder="تعداد" value={mQty} onChange={(e) => setMQty(e.target.value.replace(/[^0-9]/g, ''))} />
                {mKind !== 'transfer' && <input className="tool-text-input" type="text" inputMode="numeric" dir="ltr" placeholder={mKind === 'in' ? 'قیمتِ خرید' : 'قیمتِ فروش'} value={mPrice} onChange={(e) => setMPrice(withSep(e.target.value))} />}
              </div>
              <div className="tool-note">{mKind === 'transfer' ? 'انتقال به بهای تمام‌شده انجام می‌شود و یک سندِ حسابداری بین انبارها می‌زند.' : 'اگر قیمت را خالی بگذارید، قیمتِ پیش‌فرضِ کالا استفاده می‌شود. هر ثبت، خودکار سندِ حسابداری می‌زند.'}</div>
              <button className="loan-submit" onClick={addTxn}>{mKind === 'transfer' ? 'ثبتِ انتقال' : `ثبتِ ${mKind === 'in' ? 'ورود' : 'خروج'}`}</button>

              <div className="loan-sched-head"><span>آخرین گردش‌ها</span></div>
              <div className="loan-detail-list">
                {sortedTxns.slice(0, 20).map((t) => { const it = itemById(t.itemId); return (
                  <div key={t.id} className="loan-detail-row">
                    <div className="ld-info">
                      <span className="ld-amt">{it?.name || '—'} <span className="fm-shares">{t.kind === 'in' ? '+' : '−'}{t.qty}</span></span>
                      <span className="ld-date">{dstr(t)} · {t.transferId ? `انتقال (${t.kind === 'in' ? 'به' : 'از'} ${whName(t.warehouseId)})` : `${t.kind === 'in' ? 'خرید' : 'فروش'} · ${fmt(t.qty * t.price)} تومان${t.warehouseId ? ` · ${whName(t.warehouseId)}` : ''}${t.sectionId ? ` (${sections.find((s) => s.id === t.sectionId)?.name || ''})` : ''}`}</span>
                    </div>
                    <button className="fm-notify" title="حذف" onClick={() => delTxn(t)}>🗑</button>
                  </div>
                ); })}
              </div>
            </>
          ))}

          {/* ---------------- stock report ---------------- */}
          {tab === 'report' && (() => {
            const wh = filterWh || undefined;                     // undefined = all warehouses
            const qOf = (id: string) => stockOf(id, wh);
            const shown = items.filter(inFilter);
            const shownValue = shown.reduce((s, i) => s + qOf(i.id) * (i.buy || 0), 0);
            const whLabel = filterWh ? ` — ${whName(filterWh)}` : '';
            const low = lowItems();
            return (
            <>
              {low.length > 0 && (
                <div className="inv-alert acc-noprint">
                  ⚠️ {low.length} کالا به نقطهٔ سفارش رسیده: {low.slice(0, 6).map((i) => `${i.name} (${stockOf(i.id)}/${i.minStock})`).join('، ')}{low.length > 6 ? ' …' : ''}
                </div>
              )}
              {(groups.length > 0 || warehouses.length > 0) && (
                <div className="att-addgrid acc-noprint">
                  {warehouses.length > 0 && (
                    <div><label className="field-label">انبار</label>
                      <select className="tool-text-input" value={filterWh} onChange={(e) => setFilterWh(e.target.value)}>
                        <option value="">همه‌ی انبارها</option>
                        {warehouses.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
                      </select>
                    </div>
                  )}
                  {groups.length > 0 && (
                    <div><label className="field-label">گروهِ کالا</label>
                      <select className="tool-text-input" value={filterGroup} onChange={(e) => setFilterGroup(e.target.value)}>
                        <option value="">همه‌ی گروه‌ها</option>
                        {groupTree.map((g) => <option key={g.id} value={g.id}>{groupPath(g.id)}</option>)}
                      </select>
                    </div>
                  )}
                </div>
              )}
              {warehouses.length >= 2 && (
                <div className="mini-toggle acc-noprint">
                  <button type="button" className={`mini-toggle-btn ${!matrix ? 'active' : ''}`} onClick={() => setMatrix(false)}>فهرستی</button>
                  <button type="button" className={`mini-toggle-btn ${matrix ? 'active' : ''}`} onClick={() => setMatrix(true)}>ماتریسِ انبارها</button>
                </div>
              )}
              {matrix && warehouses.length >= 2 ? (
                <>
                  <div className="acc-print">
                    <div className="acc-print-title">موجودی به تفکیکِ انبار{filterGroup ? ` — ${groupPath(filterGroup)}` : ''}</div>
                    <div className="inv-matrix-wrap">
                      <table className="acc-table inv-matrix">
                        <thead><tr><th>کالا</th>{warehouses.map((w) => <th key={w.id}>{w.name}</th>)}<th>جمع</th><th>ارزش</th></tr></thead>
                        <tbody>
                          {shown.length === 0 ? (
                            <tr><td colSpan={warehouses.length + 3} style={{ textAlign: 'center', opacity: .6 }}>کالایی نیست</td></tr>
                          ) : shown.map((i) => { const tot = stockOf(i.id); return (
                            <tr key={i.id}><td>{i.name}</td>{warehouses.map((w) => <td key={w.id}>{stockOf(i.id, w.id) || ''}</td>)}<td><b>{tot}</b></td><td>{fmt(tot * (i.buy || 0))}</td></tr>
                          ); })}
                          <tr className="acc-total"><td>ارزشِ هر انبار</td>{warehouses.map((w) => <td key={w.id}>{fmt(shown.reduce((s, i) => s + stockOf(i.id, w.id) * (i.buy || 0), 0))}</td>)}<td></td><td>{fmt(shown.reduce((s, i) => s + stockOf(i.id) * (i.buy || 0), 0))}</td></tr>
                        </tbody>
                      </table>
                    </div>
                  </div>
                  <button className="loan-submit acc-noprint" onClick={() => window.print()}>🖨️ چاپ / ذخیره‌ی PDF</button>
                  <button className="acc-addline acc-noprint" onClick={() => downloadCsv('inventory-matrix.csv', [['کالا', ...warehouses.map((w) => w.name), 'جمع', 'ارزش'], ...shown.map((i) => [i.name, ...warehouses.map((w) => stockOf(i.id, w.id)), stockOf(i.id), stockOf(i.id) * (i.buy || 0)]), ['ارزشِ هر انبار', ...warehouses.map((w) => shown.reduce((s, i) => s + stockOf(i.id, w.id) * (i.buy || 0), 0)), '', shown.reduce((s, i) => s + stockOf(i.id) * (i.buy || 0), 0)]])}>📤 خروجیِ اکسل (CSV)</button>
                </>
              ) : (
              <>
              <div className="acc-print">
                <div className="acc-print-title">موجودیِ انبار{whLabel}{filterGroup ? ` — ${groupPath(filterGroup)}` : ''}</div>
                <table className="acc-table">
                  <thead><tr><th>کالا</th><th>گروه</th><th>موجودی</th><th>قیمتِ خرید</th><th>ارزش</th></tr></thead>
                  <tbody>
                    {shown.length === 0 ? (
                      <tr><td colSpan={5} style={{ textAlign: 'center', opacity: .6 }}>کالایی نیست</td></tr>
                    ) : shown.map((i) => { const q = qOf(i.id); return (
                      <tr key={i.id} className={isLow(i) ? 'inv-low-row' : ''}><td>{i.name}{i.unit ? ` (${i.unit})` : ''}{isLow(i) ? ' ⚠️' : ''}</td><td>{groupPath(i.groupId) || '—'}</td><td>{q}</td><td>{fmt(i.buy || 0)}</td><td>{fmt(q * (i.buy || 0))}</td></tr>
                    ); })}
                    <tr className="acc-total"><td>ارزشِ کل</td><td colSpan={3}></td><td>{fmt(shownValue)}</td></tr>
                  </tbody>
                </table>
              </div>
              <button className="loan-submit acc-noprint" onClick={() => window.print()}>🖨️ چاپ / ذخیره‌ی PDF</button>
              <button className="acc-addline acc-noprint" onClick={() => downloadCsv('inventory.csv', [['کالا', 'گروه', 'انبار', 'واحد', 'موجودی', 'قیمتِ خرید', 'ارزش'], ...shown.map((i) => [i.name, groupPath(i.groupId), filterWh ? whName(filterWh) : 'همه', i.unit || '', qOf(i.id), i.buy || 0, qOf(i.id) * (i.buy || 0)]), ['جمع', '', '', '', '', '', shownValue]])}>📤 خروجیِ اکسل (CSV)</button>
              </>
              )}
            </>
            );
          })()}

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
              <label className="field-label">گروهِ کالا</label>
              <select className="tool-text-input" value={iGroup} onChange={(e) => setIGroup(e.target.value)}>
                <option value="">— بدون گروه —</option>
                {groupTree.map((g) => <option key={g.id} value={g.id}>{' '.repeat(groupDepth(g) * 3)}{groupPath(g.id)}</option>)}
              </select>
              <div className="att-addgrid">
                <input className="tool-text-input" type="text" placeholder="کدِ همکار" value={iPartner} onChange={(e) => setIPartner(e.target.value)} />
                <input className="tool-text-input" type="text" placeholder="کدِ استانداردِ شرکت" value={iStd} onChange={(e) => setIStd(e.target.value)} />
              </div>
              <div className="att-addgrid">
                <input className="tool-text-input" type="text" inputMode="numeric" dir="ltr" placeholder="قیمتِ خرید" value={iBuy} onChange={(e) => setIBuy(withSep(e.target.value))} />
                <input className="tool-text-input" type="text" inputMode="numeric" dir="ltr" placeholder="قیمتِ فروش" value={iSell} onChange={(e) => setISell(withSep(e.target.value))} />
              </div>
              <label className="field-label">حداقلِ موجودی / نقطهٔ سفارش (هشدار)</label>
              <input className="tool-text-input" type="text" inputMode="numeric" dir="ltr" placeholder="مثلاً 10 — خالی = بدون هشدار" value={iMin} onChange={(e) => setIMin(e.target.value.replace(/[^0-9]/g, ''))} />
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
                      <span className="ld-amt">{i.name} <span className="fm-shares">موجودی: {stockOf(i.id)} {i.unit}</span>{isLow(i) ? <span className="inv-low-tag">کم‌موجود</span> : null}</span>
                      <span className="ld-date">{i.groupId ? `${groupPath(i.groupId)} · ` : ''}بارکد: {i.barcode || '—'}{i.location ? ` · جایگاه: ${i.location}` : ''}{i.minStock ? ` · حداقل: ${i.minStock}` : ''}</span>
                    </div>
                    <button className="att-inlinebtn" title="چاپِ بارکد" onClick={() => setLabelItem(i)}>🏷</button>
                    <button className="fm-notify" title="حذف" onClick={() => delItem(i.id)}>🗑</button>
                  </div>
                ))}
              </div>

              {/* warehouses (انبار) & sections (بخش) management */}
              <div className="loan-sched-head"><span>انبارها و بخش‌ها</span><span className="loan-sched-hint">{warehouses.length} انبار</span></div>
              <div className="tool-note">یک شرکت/مغازه می‌تواند چند انبار داشته باشد و هر انبار چند بخش. هنگامِ ورود/خروجِ کالا، انبار (و بخش) انتخاب می‌شود و موجودی برای هر انبار جدا نگه‌داری می‌شود.</div>
              <div className="att-addgrid">
                <input className="tool-text-input" type="text" placeholder="نامِ انبار (مثلاً انبارِ مرکزی)" value={wName} onChange={(e) => setWName(e.target.value)} />
                <button className="loan-submit" disabled={!wName.trim()} onClick={addWarehouse}>افزودنِ انبار</button>
              </div>
              {warehouses.length > 0 && (
                <div className="att-addgrid">
                  <input className="tool-text-input" type="text" placeholder="نامِ بخش (مثلاً قفسه‌ی A)" value={secName} onChange={(e) => setSecName(e.target.value)} />
                  <select className="tool-text-input" value={secWh} onChange={(e) => setSecWh(e.target.value)}>
                    <option value="">— انبارِ بخش —</option>
                    {warehouses.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
                  </select>
                  <button className="loan-submit" disabled={!secName.trim() || !secWh} onClick={addSection}>افزودنِ بخش</button>
                </div>
              )}
              <div className="loan-detail-list">
                {warehouses.map((w) => (
                  <div key={w.id}>
                    <div className="loan-detail-row">
                      <div className="ld-info"><span className="ld-amt">🏬 {w.name}</span><span className="ld-date">{sectionsOf(w.id).length} بخش</span></div>
                      {!whUsed(w.id) && <button className="fm-notify" title="حذف" onClick={() => delWarehouse(w.id)}>🗑</button>}
                    </div>
                    {sectionsOf(w.id).map((s) => (
                      <div key={s.id} className="loan-detail-row" style={{ paddingInlineStart: 24 }}>
                        <div className="ld-info"><span className="ld-amt">— {s.name}</span></div>
                        <button className="fm-notify" title="حذف" onClick={() => delSection(s.id)}>🗑</button>
                      </div>
                    ))}
                  </div>
                ))}
              </div>

              {/* product-group tree management (گروه‌های کالا) */}
              <div className="loan-sched-head"><span>گروه‌های کالا</span><span className="loan-sched-hint">{groups.length}</span></div>
              <div className="tool-note">گروه‌بندیِ سلسله‌مراتبی؛ مثلاً «الکتریکال» و زیرِ آن «اندازه‌گیری / حفاظت / مصرفی / اداری». برای زیرگروه، گروهِ والد را انتخاب کنید.</div>
              <input className="tool-text-input" type="text" placeholder="نامِ گروه (مثلاً الکتریکال)" value={gName} onChange={(e) => setGName(e.target.value)} />
              <div className="att-addgrid">
                <select className="tool-text-input" value={gParent} onChange={(e) => setGParent(e.target.value)}>
                  <option value="">— گروهِ اصلی (بدون والد) —</option>
                  {groupTree.map((g) => <option key={g.id} value={g.id}>{groupPath(g.id)}</option>)}
                </select>
                <button className="loan-submit" disabled={!gName.trim()} onClick={addGroup}>افزودنِ گروه</button>
              </div>
              <div className="loan-detail-list">
                {groupTree.map((g) => (
                  <div key={g.id} className="loan-detail-row" style={{ paddingInlineStart: 8 + groupDepth(g) * 16 }}>
                    <div className="ld-info">
                      <span className="ld-amt">{g.name}{!g.parent ? <span className="acc-lvl-tag">اصلی</span> : null}</span>
                      <span className="ld-date">{items.filter((i) => i.groupId === g.id).length} کالا</span>
                    </div>
                    {!groupHasChildren(g.id) && !items.some((i) => i.groupId === g.id) && <button className="fm-notify" title="حذف" onClick={() => delGroup(g.id)}>🗑</button>}
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
