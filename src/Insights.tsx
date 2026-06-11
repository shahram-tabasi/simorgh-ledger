// Management insights dashboard — KPIs + pure-SVG charts (no chart lib, offline). Reads the already
// parsed accounting + inventory state and derives monthly revenue/expense, profit, cash, receivables/
// payables, inventory value and top/low items. All money in تومان.
import { useState } from 'react';
import { getMonthNames } from './calendar';
import type { AccountingState, AccType } from './Accounting';
import type { InventoryState } from './Inventory';

const fmt = (n: number): string => Math.round(n || 0).toLocaleString('en-US');
const isDebitNormal = (t: AccType) => t === 'asset' || t === 'expense';
// compact billions/millions label for chart axis
const compact = (n: number): string => {
  const a = Math.abs(n);
  if (a >= 1e9) return (n / 1e9).toFixed(1) + 'B';
  if (a >= 1e6) return (n / 1e6).toFixed(1) + 'M';
  if (a >= 1e3) return Math.round(n / 1e3) + 'K';
  return String(Math.round(n));
};

// Grouped two-series vertical bar chart.
function BarChart({ rows, aColor = '#2e9d5b', bColor = '#d2453b', aName, bName }: {
  rows: { label: string; a: number; b: number }[]; aColor?: string; bColor?: string; aName: string; bName: string;
}) {
  const max = Math.max(1, ...rows.map((r) => Math.max(r.a, r.b)));
  const W = Math.max(280, rows.length * 56), H = 160, pad = 22, bw = 14;
  return (
    <div className="ins-chart-wrap">
      <div className="ins-legend"><span><i style={{ background: aColor }} />{aName}</span><span><i style={{ background: bColor }} />{bName}</span></div>
      <svg className="ins-chart" viewBox={`0 0 ${W} ${H}`} width="100%" preserveAspectRatio="xMidYMid meet">
        <line x1={pad} y1={H - pad} x2={W - 4} y2={H - pad} stroke="#d3deee" />
        {rows.map((r, i) => {
          const x = pad + 8 + i * 56;
          const ha = Math.round((H - pad * 2) * (r.a / max)), hb = Math.round((H - pad * 2) * (r.b / max));
          return (
            <g key={i}>
              <rect x={x} y={H - pad - ha} width={bw} height={ha} rx={2} fill={aColor} />
              <rect x={x + bw + 3} y={H - pad - hb} width={bw} height={hb} rx={2} fill={bColor} />
              <text x={x + bw} y={H - pad + 12} fontSize="9" textAnchor="middle" fill="#6b7894">{r.label}</text>
            </g>
          );
        })}
        <text x={pad - 2} y={pad} fontSize="9" textAnchor="end" fill="#8893a8">{compact(max)}</text>
      </svg>
    </div>
  );
}

export default function Insights({ accounting, inventory, onClose }: {
  accounting: AccountingState; inventory: InventoryState; onClose: () => void;
}) {
  const monthNames = getMonthNames('jalali');
  const accs = accounting.accounts || [];
  const entries = accounting.entries || [];
  const typeOf = (id: string) => accs.find((a) => a.id === id)?.type;
  const nameOf = (id: string) => accs.find((a) => a.id === id)?.name || '';

  // monthly revenue / expense
  const byMonth: { [ym: string]: { y: number; m: number; rev: number; exp: number } } = {};
  entries.forEach((e) => {
    const key = `${e.y}-${e.m}`;
    const slot = byMonth[key] || (byMonth[key] = { y: e.y, m: e.m, rev: 0, exp: 0 });
    e.lines.forEach((l) => {
      const t = typeOf(l.accountId);
      if (t === 'income') slot.rev += l.credit - l.debit;
      else if (t === 'expense') slot.exp += l.debit - l.credit;
    });
  });
  const months = Object.values(byMonth).sort((a, b) => (a.y * 100 + a.m) - (b.y * 100 + b.m)).slice(-8);
  const chartRows = months.map((m) => ({ label: `${monthNames[m.m].slice(0, 4)} ${String(m.y).slice(-2)}`, a: Math.max(0, m.rev), b: Math.max(0, m.exp) }));

  // account balances
  const balOf = (pred: (name: string, t: AccType) => boolean) => {
    let bal = 0;
    accs.forEach((a) => {
      if (!pred(a.name, a.type)) return;
      let d = 0, c = 0; entries.forEach((e) => e.lines.forEach((l) => { if (l.accountId === a.id) { d += l.debit; c += l.credit; } }));
      bal += isDebitNormal(a.type) ? d - c : c - d;
    });
    return bal;
  };
  const totalRev = months.reduce((s, m) => s + m.rev, 0);
  const totalExp = months.reduce((s, m) => s + m.exp, 0);
  const profit = totalRev - totalExp;
  const cash = balOf((n, t) => t === 'asset' && (n.includes('صندوق') || n.includes('بانک') || n.includes('تنخواه')));
  const recv = balOf((n) => n.includes('دریافتنی'));
  const pay = balOf((n) => n.includes('پرداختنی'));

  // inventory
  const items = inventory.items || [];
  const txns = inventory.txns || [];
  const stockOf = (id: string) => txns.reduce((s, t) => s + (t.itemId === id ? (t.kind === 'in' ? t.qty : -t.qty) : 0), 0);
  const valued = items.map((i) => ({ i, qty: stockOf(i.id), val: stockOf(i.id) * (i.buy || 0) }));
  const stockValue = valued.reduce((s, x) => s + x.val, 0);
  const topItems = valued.slice().sort((a, b) => b.val - a.val).slice(0, 6);
  const low = items.filter((i) => (i.minStock || 0) > 0 && stockOf(i.id) <= (i.minStock || 0));

  const [tab, setTab] = useState<'fin' | 'inv'>('fin');
  return (
    <div className="modal" onClick={onClose}>
      <div className="modal-box tool-panel" onClick={(e) => e.stopPropagation()}>
        <div className="tool-panel-head">
          <button className="close-modal" onClick={onClose}>‹</button>
          <h3>📈 داشبوردِ تحلیلی</h3>
          <button className="close-modal" onClick={onClose}>✕</button>
        </div>
        <div className="tool-panel-body">
          <div className="mini-toggle fund-tabs">
            <button type="button" className={`mini-toggle-btn ${tab === 'fin' ? 'active' : ''}`} onClick={() => setTab('fin')}>مالی</button>
            <button type="button" className={`mini-toggle-btn ${tab === 'inv' ? 'active' : ''}`} onClick={() => setTab('inv')}>انبار</button>
          </div>

          {tab === 'fin' && (
            <>
              <div className="ins-kpis">
                <div className="ins-kpi"><span>درآمد</span><b>{fmt(totalRev)}</b></div>
                <div className="ins-kpi"><span>هزینه</span><b>{fmt(totalExp)}</b></div>
                <div className={`ins-kpi ${profit >= 0 ? 'good' : 'bad'}`}><span>{profit >= 0 ? 'سود' : 'زیان'}</span><b>{fmt(Math.abs(profit))}</b></div>
                <div className="ins-kpi"><span>نقد + بانک</span><b>{fmt(cash)}</b></div>
                <div className="ins-kpi"><span>طلبِ ما</span><b>{fmt(recv)}</b></div>
                <div className="ins-kpi"><span>بدهیِ ما</span><b>{fmt(pay)}</b></div>
              </div>
              <div className="ins-card-title">درآمد و هزینه‌ی ماهانه</div>
              {chartRows.length ? <BarChart rows={chartRows} aName="درآمد" bName="هزینه" /> : <div className="tool-note">هنوز سندی برای نمودار نیست.</div>}
            </>
          )}

          {tab === 'inv' && (
            <>
              <div className="ins-kpis">
                <div className="ins-kpi"><span>تعدادِ کالا</span><b>{items.length}</b></div>
                <div className="ins-kpi"><span>ارزشِ موجودی</span><b>{fmt(stockValue)}</b></div>
                <div className={`ins-kpi ${low.length ? 'bad' : ''}`}><span>کم‌موجود</span><b>{low.length}</b></div>
              </div>
              <div className="ins-card-title">ارزشمندترین کالاها</div>
              {topItems.length === 0 ? <div className="tool-note">کالایی ثبت نشده.</div> : (() => {
                const max = Math.max(1, ...topItems.map((x) => x.val));
                return (
                  <div className="ins-bars">
                    {topItems.map((x) => (
                      <div key={x.i.id} className="ins-bar-row">
                        <span className="ins-bar-name">{x.i.name}</span>
                        <div className="ins-bar-track"><div className="ins-bar-fill" style={{ width: `${Math.max(4, (x.val / max) * 100)}%` }} /></div>
                        <span className="ins-bar-val">{fmt(x.val)}</span>
                      </div>
                    ))}
                  </div>
                );
              })()}
              {low.length > 0 && <div className="inv-alert" style={{ marginTop: 10 }}>⚠️ رو به اتمام: {low.slice(0, 8).map((i) => `${i.name} (${stockOf(i.id)})`).join('، ')}</div>}
            </>
          )}
          <div className="tool-note">ارقامِ مالی از اسنادِ حسابداری و ارزشِ انبار از موجودیِ کالاها محاسبه می‌شوند. (شرکتِ فعال)</div>
        </div>
      </div>
    </div>
  );
}
