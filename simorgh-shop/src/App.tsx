// صندوقِ فروشگاهیِ سیمرغ (simorgh-shop) — لایت POS برای مغازه‌ها.
// فروش با بارکد (اسکنرِ سخت‌افزاری/دوربین/اسکنرِ بی‌سیمِ گوشی) → سبدِ خرید → فاکتورِ چاپی،
// مدیریتِ کالا و چاپِ بارکد، و گزارشِ ساده‌ی فروش/سود/موجودی. کاملاً آفلاین روی سیستمِ خودِ مغازه.
import { useEffect, useRef, useState } from 'react';
import { code39Bars, cleanBarcode, genBarcode } from './barcode';
import CameraScanner from './Scanner';
import { genChannel, pollScans, sendScan, relayBase } from './relay';
import { loadProducts, saveProducts, loadSales, saveSales, findByBarcode, money, digits, withSep, type Product, type Sale, type SaleItem } from './db';

const APP_VERSION = '1.0.0';

function Barcode({ value, height = 46 }: { value: string; height?: number }) {
  const { bars, width } = code39Bars(value);
  if (!value) return null;
  return (
    <svg className="barcode" viewBox={`0 0 ${width} ${height}`} width="100%" height={height} preserveAspectRatio="none" aria-label={value}>
      <rect x={0} y={0} width={width} height={height} fill="#fff" />
      {bars.map((b, i) => <rect key={i} x={b.x} y={0} width={b.w} height={height} fill="#000" />)}
    </svg>
  );
}

// Phone-as-scanner sender: join the laptop's channel and push each scanned barcode.
function PhoneScanner({ onExit }: { onExit: () => void }) {
  const [channel, setChannel] = useState('');
  const [active, setActive] = useState(false);
  const [sent, setSent] = useState(0); const [last, setLast] = useState('');
  const onScan = async (code: string) => { const ok = await sendScan(channel, code); if (ok) { setSent((n) => n + 1); setLast(code); } };
  return (
    <div className="phone-wrap">
      <div className="topbar"><button className="lnk" onClick={onExit}>‹ بازگشت</button><b>📱 گوشی به‌عنوانِ اسکنر</b><span /></div>
      {!active ? (
        <div className="pad">
          <p className="hint">روی صندوقِ مغازه دکمه‌ی «📡 اسکنرِ همراه» را بزنید و کدِ ۶رقمی را اینجا وارد کنید. گوشی و صندوق باید روی یک شبکه باشند.</p>
          <input className="inp big" inputMode="numeric" dir="ltr" placeholder="کدِ ۶رقمی" value={channel} onChange={(e) => setChannel(e.target.value.replace(/[^0-9]/g, '').slice(0, 6))} />
          <button className="btn primary" disabled={channel.length !== 6} onClick={() => setActive(true)}>شروعِ اسکن</button>
        </div>
      ) : (
        <>
          <div className="pad"><div className="stat">ارسال‌شده: <b>{sent}</b>{last && <> · آخرین: <b dir="ltr">{last}</b></>}</div></div>
          <CameraScanner continuous onClose={() => setActive(false)} onResult={onScan} />
        </>
      )}
    </div>
  );
}

type Tab = 'pos' | 'products' | 'report';

export default function App() {
  const [products, setProducts] = useState<Product[]>(() => loadProducts());
  const [sales, setSales] = useState<Sale[]>(() => loadSales());
  useEffect(() => saveProducts(products), [products]);
  useEffect(() => saveSales(sales), [sales]);

  // phone-scanner route (the phone opens the same app and switches to sender mode)
  const [phoneMode, setPhoneMode] = useState<boolean>(() => new URLSearchParams(location.search).has('scan'));
  if (phoneMode) return <PhoneScanner onExit={() => { setPhoneMode(false); history.replaceState(null, '', location.pathname); }} />;

  return <Shop products={products} setProducts={setProducts} sales={sales} setSales={setSales} onPhone={() => setPhoneMode(true)} />;
}

function Shop({ products, setProducts, sales, setSales, onPhone }: {
  products: Product[]; setProducts: (p: Product[]) => void;
  sales: Sale[]; setSales: (s: Sale[]) => void; onPhone: () => void;
}) {
  const [tab, setTab] = useState<Tab>('pos');
  const [cart, setCart] = useState<{ id: string; qty: number }[]>([]);
  const [scan, setScan] = useState('');
  const [showCam, setShowCam] = useState(false);
  const [toast, setToast] = useState('');
  const [receipt, setReceipt] = useState<Sale | null>(null);
  // wireless receive
  const [relayCh, setRelayCh] = useState<string | null>(null);
  const cursor = useRef(0);
  const addRef = useRef<(code: string) => void>(() => {});

  const note = (t: string) => { setToast(t); setTimeout(() => setToast(''), 1800); };
  const prodById = (id: string) => products.find((p) => p.id === id);

  const addToCart = (code: string) => {
    const p = findByBarcode(products, code);
    if (!p) { note(`بارکدِ «${code}» در کالاها نیست`); return; }
    setCart((c) => { const i = c.findIndex((x) => x.id === p.id); if (i >= 0) { const n = c.slice(); n[i] = { ...n[i], qty: n[i].qty + 1 }; return n; } return [...c, { id: p.id, qty: 1 }]; });
    note(`${p.name} افزوده شد`);
  };
  addRef.current = addToCart;

  // poll the wireless channel
  useEffect(() => {
    if (!relayCh) return; cursor.current = 0;
    const t = setInterval(async () => { const r = await pollScans(relayCh, cursor.current); cursor.current = r.last; r.scans.forEach((s) => addRef.current(s.code)); }, 1500);
    return () => clearInterval(t);
  }, [relayCh]);

  const cartRows = cart.map((c) => ({ ...c, p: prodById(c.id)! })).filter((x) => x.p);
  const total = cartRows.reduce((s, x) => s + x.p.price * x.qty, 0);
  const setQty = (id: string, qty: number) => setCart((c) => qty <= 0 ? c.filter((x) => x.id !== id) : c.map((x) => x.id === id ? { ...x, qty } : x));

  const checkout = () => {
    if (cartRows.length === 0) return;
    for (const x of cartRows) if (x.qty > x.p.stock) { note(`موجودیِ «${x.p.name}» کافی نیست (${x.p.stock})`); return; }
    const items: SaleItem[] = cartRows.map((x) => ({ barcode: x.p.barcode, name: x.p.name, price: x.p.price, cost: x.p.cost, qty: x.qty }));
    const profit = items.reduce((s, it) => s + (it.price - it.cost) * it.qty, 0);
    const sale: Sale = { id: `s-${Date.now()}`, ts: Date.now(), items, total, profit };
    setSales([sale, ...sales]);
    setProducts(products.map((p) => { const c = cart.find((x) => x.id === p.id); return c ? { ...p, stock: p.stock - c.qty } : p; }));
    setCart([]); setReceipt(sale);
  };

  return (
    <div className="app">
      <header className="hd">
        <div className="brand">🛒 صندوقِ سیمرغ</div>
        <nav className="tabs">
          <button className={tab === 'pos' ? 'on' : ''} onClick={() => setTab('pos')}>فروش</button>
          <button className={tab === 'products' ? 'on' : ''} onClick={() => setTab('products')}>کالاها</button>
          <button className={tab === 'report' ? 'on' : ''} onClick={() => setTab('report')}>گزارش</button>
        </nav>
      </header>
      {toast && <div className="toast">{toast}</div>}

      {tab === 'pos' && (
        <main className="pos">
          <div className="pos-scan">
            <input className="inp" autoFocus dir="ltr" placeholder="بارکد را اسکن یا تایپ کنید…" value={scan}
              onChange={(e) => setScan(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && scan.trim()) { addToCart(scan.trim()); setScan(''); } }} />
            <button className="btn" onClick={() => setShowCam(true)}>📷</button>
            <button className={`btn ${relayCh ? 'primary' : ''}`} onClick={() => setRelayCh(relayCh ? null : genChannel())}>📡 اسکنرِ همراه</button>
          </div>
          {relayCh && <div className="relaybox">کدِ اتصالِ گوشی: <b dir="ltr">{relayCh}</b> — در گوشی <b dir="ltr">{relayBase()}/?scan</b> را باز کنید و این کد را وارد کنید.</div>}

          <div className="cart">
            {cartRows.length === 0 ? <div className="empty">سبد خالی است — کالا را اسکن کنید.</div> : cartRows.map((x) => (
              <div key={x.id} className="crow">
                <div className="cinfo"><b>{x.p.name}</b><span>{money(x.p.price)} تومان</span></div>
                <div className="qty">
                  <button onClick={() => setQty(x.id, x.qty - 1)}>−</button>
                  <span>{x.qty}</span>
                  <button onClick={() => setQty(x.id, x.qty + 1)}>+</button>
                </div>
                <div className="cline">{money(x.p.price * x.qty)}</div>
                <button className="del" onClick={() => setQty(x.id, 0)}>✕</button>
              </div>
            ))}
          </div>
          <div className="checkout">
            <div className="grand">جمعِ کل: <b>{money(total)}</b> تومان</div>
            <button className="btn pay" disabled={!cartRows.length} onClick={checkout}>💵 ثبت و چاپِ فاکتور</button>
          </div>
        </main>
      )}

      {tab === 'products' && <Products products={products} setProducts={setProducts} note={note} onPhone={onPhone} />}
      {tab === 'report' && <Report products={products} sales={sales} />}

      {showCam && <CameraScanner onClose={() => setShowCam(false)} onResult={(code) => { setShowCam(false); addToCart(cleanBarcode(code)); }} />}
      {receipt && <Receipt sale={receipt} onClose={() => setReceipt(null)} />}
      <footer className="ft">سیمرغ · نسخه {APP_VERSION} · <button className="lnk" onClick={onPhone}>📱 این گوشی اسکنر شود</button></footer>
    </div>
  );
}

function Products({ products, setProducts, note, onPhone }: { products: Product[]; setProducts: (p: Product[]) => void; note: (t: string) => void; onPhone: () => void }) {
  const [name, setName] = useState(''); const [bc, setBc] = useState(''); const [price, setPrice] = useState(''); const [cost, setCost] = useState(''); const [stock, setStock] = useState('');
  const [label, setLabel] = useState<Product | null>(null);
  const add = () => {
    if (!name.trim()) return;
    const barcode = cleanBarcode(bc) || genBarcode();
    if (products.some((p) => cleanBarcode(p.barcode) === barcode)) { note('این بارکد قبلاً ثبت شده'); return; }
    const p: Product = { id: `p-${Date.now()}`, name: name.trim(), barcode, price: digits(price), cost: digits(cost), stock: digits(stock) };
    setProducts([...products, p]); setName(''); setBc(''); setPrice(''); setCost(''); setStock(''); setLabel(p);
  };
  const upd = (id: string, patch: Partial<Product>) => setProducts(products.map((p) => p.id === id ? { ...p, ...patch } : p));
  const del = (id: string) => setProducts(products.filter((p) => p.id !== id));
  return (
    <main className="panel">
      <div className="card">
        <h3>افزودنِ کالا</h3>
        <input className="inp" placeholder="نامِ کالا" value={name} onChange={(e) => setName(e.target.value)} />
        <div className="grid2">
          <input className="inp" dir="ltr" placeholder="بارکد (خالی = خودکار)" value={bc} onChange={(e) => setBc(e.target.value)} />
          <input className="inp" dir="ltr" inputMode="numeric" placeholder="موجودی" value={stock} onChange={(e) => setStock(e.target.value.replace(/[^0-9]/g, ''))} />
        </div>
        <div className="grid2">
          <input className="inp" dir="ltr" inputMode="numeric" placeholder="قیمتِ فروش" value={price} onChange={(e) => setPrice(withSep(e.target.value))} />
          <input className="inp" dir="ltr" inputMode="numeric" placeholder="قیمتِ خرید" value={cost} onChange={(e) => setCost(withSep(e.target.value))} />
        </div>
        <button className="btn primary" disabled={!name.trim()} onClick={add}>افزودن و ساختِ بارکد</button>
        <button className="lnk" onClick={onPhone} style={{ marginTop: 8 }}>📱 تبدیلِ این گوشی به اسکنر</button>
      </div>

      {label && (
        <div className="card label-card">
          <div className="label print-area">
            <div className="lname">{label.name}</div>
            <Barcode value={label.barcode} />
            <div className="lcode">{label.barcode}</div>
            <div className="lprice">{money(label.price)} تومان</div>
          </div>
          <button className="btn" onClick={() => window.print()}>🖨️ چاپِ بارکد</button>
        </div>
      )}

      <div className="card">
        <h3>کالاها ({products.length})</h3>
        {products.map((p) => (
          <div key={p.id} className="prow">
            <div className="pinfo"><b>{p.name}</b><span dir="ltr">{p.barcode} · {money(p.price)} ت</span></div>
            <input className="inp tiny" dir="ltr" inputMode="numeric" value={String(p.stock)} onChange={(e) => upd(p.id, { stock: digits(e.target.value) })} title="موجودی" />
            <button className="del" onClick={() => setLabel(p)} title="بارکد">🏷</button>
            <button className="del" onClick={() => del(p.id)}>🗑</button>
          </div>
        ))}
      </div>
    </main>
  );
}

function Report({ products, sales }: { products: Product[]; sales: Sale[] }) {
  const startOfDay = new Date(); startOfDay.setHours(0, 0, 0, 0);
  const today = sales.filter((s) => s.ts >= startOfDay.getTime());
  const todayRev = today.reduce((s, x) => s + x.total, 0);
  const todayProfit = today.reduce((s, x) => s + x.profit, 0);
  const stockValue = products.reduce((s, p) => s + p.stock * p.cost, 0);
  const low = products.filter((p) => p.stock <= 3);
  return (
    <main className="panel">
      <div className="card stats">
        <div className="kpi"><span>فروشِ امروز</span><b>{money(todayRev)}</b></div>
        <div className="kpi"><span>سودِ امروز</span><b>{money(todayProfit)}</b></div>
        <div className="kpi"><span>تعدادِ فاکتور</span><b>{today.length}</b></div>
        <div className="kpi"><span>ارزشِ موجودی</span><b>{money(stockValue)}</b></div>
      </div>
      {low.length > 0 && <div className="card warn">⚠️ کم‌موجود: {low.map((p) => `${p.name} (${p.stock})`).join('، ')}</div>}
      <div className="card">
        <h3>فروش‌های اخیر</h3>
        {sales.slice(0, 30).map((s) => (
          <div key={s.id} className="prow">
            <div className="pinfo"><b>{money(s.total)} تومان</b><span>{new Date(s.ts).toLocaleString('fa-IR')} · {s.items.length} قلم</span></div>
          </div>
        ))}
        {sales.length === 0 && <div className="empty">هنوز فروشی ثبت نشده.</div>}
      </div>
    </main>
  );
}

function Receipt({ sale, onClose }: { sale: Sale; onClose: () => void }) {
  return (
    <div className="overlay" onClick={onClose}>
      <div className="rcpt" onClick={(e) => e.stopPropagation()}>
        <div className="print-area">
          <div className="rhd">صندوقِ سیمرغ — فاکتورِ فروش</div>
          <div className="rmeta">{new Date(sale.ts).toLocaleString('fa-IR')}</div>
          <table className="rtab"><thead><tr><th>کالا</th><th>تعداد</th><th>مبلغ</th></tr></thead>
            <tbody>{sale.items.map((it, i) => <tr key={i}><td>{it.name}</td><td>{it.qty}</td><td>{money(it.price * it.qty)}</td></tr>)}</tbody>
          </table>
          <div className="rtotal">جمعِ کل: {money(sale.total)} تومان</div>
          <div className="rthanks">با تشکر از خریدِ شما 🌟</div>
        </div>
        <div className="ractions">
          <button className="btn primary" onClick={() => window.print()}>🖨️ چاپ</button>
          <button className="btn" onClick={onClose}>بستن</button>
        </div>
      </div>
    </div>
  );
}
