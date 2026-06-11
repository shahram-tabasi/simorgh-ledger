// حسابداریِ دوطرفه (Double-entry) برای simorgh-ledger
// دفترِ روزنامه (اسناد) + تراز آزمایشی + دفترِ معین + صورتِ سود و زیان + چاپ/PDF
import { useState } from 'react';
import { getToday, getMonthNames } from './calendar';
import { downloadCsv } from './csv';
import { cleanBarcode } from './barcode';
import CameraScanner from './Scanner';

const fmt = (n: number): string => Math.round(n || 0).toLocaleString('en-US');
const digits = (s: string): number => parseInt((s || '').replace(/[^0-9]/g, ''), 10) || 0;
const withSep = (s: string): string => { const d = digits(s); return d ? d.toLocaleString('en-US') : ''; };

export type AccType = 'asset' | 'liability' | 'equity' | 'income' | 'expense';
// Hierarchical chart of accounts (کدینگِ استاندارد): گروه → کل → معین → تفصیلی.
// Only the leaf levels (معین/تفصیلی) accept journal lines; group/total are headers for grouping & reports.
export type AccLevel = 'group' | 'total' | 'sub' | 'detail';
export interface Account { id: string; code: string; name: string; type: AccType; level?: AccLevel; parent?: string; }
// A journal line may carry the 4th-level dimensions: party (طرف‌حساب/تفصیلی) and cost center (مرکز هزینه).
export interface EntryLine { accountId: string; debit: number; credit: number; party?: string; center?: string; }
// ref: شناسه‌ی منبعِ سند برای جلوگیری از ثبتِ تکراری وقتی از ماژول‌های دیگر (حقوق، صندوق، وام) خودکار ساخته می‌شود
export interface JournalEntry { id: string; y: number; m: number; d: number; desc: string; lines: EntryLine[]; ref?: string; }
// Subsidiary ledger dimensions (تفصیلی): counterparties and cost centers.
export interface Party { id: string; name: string; kind: 'customer' | 'supplier' | 'both'; }
export interface CostCenter { id: string; name: string; }
export const PARTY_KIND_LABEL: { [k in Party['kind']]: string } = { customer: 'مشتری', supplier: 'تأمین‌کننده', both: 'هر دو' };
// Official sales invoice (فاکتورِ فروش): header + line items; on save it posts the sale journal and is reprintable.
// itemId/cost link a line to an inventory item (set when added by barcode scan) → enables COGS + stock-out.
export interface InvoiceItem { name: string; qty: number; price: number; itemId?: string; cost?: number; }
// Minimal inventory item shape passed in for barcode lookup inside the invoice.
export interface InvLookupItem { id: string; name: string; sell?: number; buy?: number; barcode?: string; code?: string; stdCode?: string; }
export interface Invoice { id: string; number: number; kind?: 'sale' | 'purchase'; y: number; m: number; d: number; partyId?: string; buyerName?: string; items: InvoiceItem[]; discount: number; vatRate: number; paid: 'cash' | 'bank' | 'credit'; asInventory?: boolean; }
export interface AccountingState { accounts: Account[]; entries: JournalEntry[]; vatRate?: number; parties?: Party[]; centers?: CostCenter[]; orgName?: string; invoices?: Invoice[]; invoiceSeq?: number; }

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
  // Inventory bridge (optional): scan items into the invoice, then reduce stock on a sale.
  invItems?: InvLookupItem[];
  onSellStock?: (lines: { itemId: string; qty: number }[], date: { y: number; m: number; d: number }) => void;
}

type Tab = 'quick' | 'invoice' | 'journal' | 'reports' | 'parties' | 'accounts';

export default function AccountingPanel({ state, onChange, onClose, confirm, invItems, onSellStock }: Props) {
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
  // Pure builder: resolve accounts and produce a balanced entry without committing (so callers can
  // merge it with other state changes in a single onChange).
  const buildQuick = (date: { y: number; m: number; d: number }, desc: string, spec: { name: string; type: AccType; debit?: number; credit?: number; party?: string; center?: string }[]): { accounts: Account[]; entry: JournalEntry } | null => {
    let list = accounts.slice();
    const lines: EntryLine[] = spec.filter((s) => (s.debit || 0) > 0 || (s.credit || 0) > 0).map((s) => {
      const r = resolveLocal(list, s.name, s.type); list = r.list;
      const line: EntryLine = { accountId: r.acc.id, debit: Math.round(s.debit || 0), credit: Math.round(s.credit || 0) };
      if (s.party) line.party = s.party;
      if (s.center) line.center = s.center;
      return line;
    });
    const td = lines.reduce((t, l) => t + l.debit, 0); const tc = lines.reduce((t, l) => t + l.credit, 0);
    if (lines.length < 2 || Math.round(td) !== Math.round(tc) || td <= 0) return null;
    return { accounts: list, entry: { id: `je-${Date.now()}`, ...date, desc, lines } };
  };
  // Post a balanced quick entry (used by the guided non-accountant operations).
  const postQuick = (date: { y: number; m: number; d: number }, desc: string, spec: { name: string; type: AccType; debit?: number; credit?: number; party?: string; center?: string }[]) => {
    const r = buildQuick(date, desc, spec);
    if (!r) { confirm('مبالغ نامعتبر است؛ سند ساخته نشد.', () => {}); return false; }
    onChange({ ...state, accounts: r.accounts, entries: [...entries, r.entry] });
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
  const orgName = state.orgName || '';
  const setOrgName = (v: string) => onChange({ ...state, orgName: v });
  // Opening entry (سند افتتاحیه): post starting balances; any imbalance plugs to سرمایه so it always balances.
  const postOpening = (yr: number, amounts: { [id: string]: number }) => {
    let list = accounts.slice();
    const lines: EntryLine[] = [];
    let debit = 0, credit = 0;
    Object.entries(amounts).forEach(([id, amt]) => {
      if (!amt || amt <= 0) return; const a = accById(id); if (!a) return;
      if (isDebitNormal(a.type)) { lines.push({ accountId: id, debit: amt, credit: 0 }); debit += amt; }
      else { lines.push({ accountId: id, debit: 0, credit: amt }); credit += amt; }
    });
    if (lines.length === 0) { confirm('هیچ مبلغی وارد نشده است.', () => {}); return false; }
    const plug = debit - credit;
    if (Math.abs(plug) >= 1) {
      const r = resolveLocal(list, 'سرمایه', 'equity'); list = r.list;
      if (plug > 0) lines.push({ accountId: r.acc.id, debit: 0, credit: plug });
      else lines.push({ accountId: r.acc.id, debit: -plug, credit: 0 });
    }
    const entry: JournalEntry = { id: `je-${Date.now()}`, y: yr, m: 0, d: 1, desc: `سندِ افتتاحیه‌ی سالِ ${yr}`, lines, ref: `opening-${yr}` };
    onChange({ ...state, accounts: list, entries: [...entries.filter((e) => e.ref !== `opening-${yr}`), entry] });
    return true;
  };

  // ---------- فاکتورِ فروش ----------
  const invoices = state.invoices || [];
  // Persist a new invoice and post its sale journal (Debit cash/AR / Credit فروش / Credit VAT), tagging the party.
  const saveInvoice = (inv: Omit<Invoice, 'id' | 'number'>): Invoice | null => {
    const number = (state.invoiceSeq || 0) + 1;
    const full: Invoice = { ...inv, id: `inv-${Date.now()}`, number };
    const subtotal = inv.items.reduce((s, it) => s + it.qty * it.price, 0);
    const net = Math.max(0, subtotal - (inv.discount || 0));
    const vat = Math.round(net * (inv.vatRate || 0) / 100);
    const total = net + vat;
    if (total <= 0) { confirm('مبلغِ فاکتور صفر است.', () => {}); return null; }
    const channelName = inv.paid === 'bank' ? 'بانک' : 'صندوق (نقد)';
    const isPurchase = inv.kind === 'purchase';
    const kindLabel = isPurchase ? 'خرید' : 'فروش';
    const spec: { name: string; type: AccType; debit?: number; credit?: number; party?: string }[] = isPurchase
      ? [ // purchase: Debit inventory/expense + input VAT / Credit cash|bank|payable(supplier)
          { name: inv.asInventory ? 'موجودیِ کالا' : 'هزینه‌های عمومی و اداری', type: inv.asInventory ? 'asset' : 'expense', debit: net },
          ...(vat ? [{ name: 'مالیات بر ارزش افزوده (خرید)', type: 'asset' as AccType, debit: vat }] : []),
          { name: inv.paid === 'credit' ? 'حساب‌های پرداختنی' : channelName, type: inv.paid === 'credit' ? 'liability' : 'asset', credit: total, party: inv.paid === 'credit' ? inv.partyId : undefined },
        ]
      : [ // sale: Debit cash|bank|receivable(customer) / Credit sales + output VAT
          { name: inv.paid === 'credit' ? 'حساب‌های دریافتنی' : channelName, type: 'asset', debit: total, party: inv.paid === 'credit' ? inv.partyId : undefined },
          { name: 'فروش', type: 'income', credit: net },
          ...(vat ? [{ name: 'مالیات بر ارزش افزوده (فروش)', type: 'liability' as AccType, credit: vat }] : []),
        ];
    // For a sale of inventory-linked items, also record cost of goods sold (COGS) and reduce stock.
    const cogs = isPurchase ? 0 : inv.items.reduce((s, it) => s + (it.itemId ? (it.cost || 0) * it.qty : 0), 0);
    if (cogs > 0) {
      spec.push({ name: 'بهای تمام‌شده‌ی کالای فروش‌رفته', type: 'expense', debit: cogs });
      spec.push({ name: 'موجودیِ کالا', type: 'asset', credit: cogs });
    }
    const built = buildQuick({ y: inv.y, m: inv.m, d: inv.d }, `فاکتورِ ${kindLabel} #${number}${inv.buyerName ? ` — ${inv.buyerName}` : ''}`, spec);
    if (!built) { confirm('سندِ فاکتور ساخته نشد.', () => {}); return null; }
    // single commit: posted journal + saved invoice + sequence
    onChange({ ...state, accounts: built.accounts, entries: [...entries, built.entry], invoices: [...invoices, full], invoiceSeq: number });
    // reduce inventory stock for the scanned/linked items (sales only)
    if (!isPurchase && onSellStock) {
      const stockLines = inv.items.filter((it) => it.itemId).map((it) => ({ itemId: it.itemId!, qty: it.qty }));
      if (stockLines.length) onSellStock(stockLines, { y: inv.y, m: inv.m, d: inv.d });
    }
    return full;
  };

  // ---------- طرف‌حساب‌ها (تفصیلی) و مرکزِ هزینه ----------
  const parties = state.parties || [];
  const centers = state.centers || [];
  const partyName = (id?: string) => parties.find((p) => p.id === id)?.name || '';
  const centerName = (id?: string) => centers.find((c) => c.id === id)?.name || '';
  const [pName, setPName] = useState(''); const [pKind, setPKind] = useState<Party['kind']>('customer');
  const addParty = () => { if (!pName.trim()) return; onChange({ ...state, parties: [...parties, { id: `p-${Date.now()}`, name: pName.trim(), kind: pKind }] }); setPName(''); };
  const partyUsed = (id: string) => entries.some((e) => e.lines.some((l) => l.party === id));
  const delParty = (id: string) => { if (partyUsed(id)) { confirm('این طرف‌حساب در اسناد استفاده شده و حذف نمی‌شود.', () => {}); return; } confirm('این طرف‌حساب حذف شود؟', () => onChange({ ...state, parties: parties.filter((p) => p.id !== id) })); };
  const [cName, setCName] = useState('');
  const addCenter = () => { if (!cName.trim()) return; onChange({ ...state, centers: [...centers, { id: `c-${Date.now()}`, name: cName.trim() }] }); setCName(''); };
  const centerUsed = (id: string) => entries.some((e) => e.lines.some((l) => l.center === id));
  const delCenter = (id: string) => { if (centerUsed(id)) { confirm('این مرکزِ هزینه در اسناد استفاده شده و حذف نمی‌شود.', () => {}); return; } confirm('این مرکزِ هزینه حذف شود؟', () => onChange({ ...state, centers: centers.filter((c) => c.id !== id) })); };
  // Net balance per party across all tagged lines (debit − credit): + = طلبِ ما (دریافتنی), − = بدهیِ ما (پرداختنی).
  const partyBalance = (id: string) => { let b = 0; entries.forEach((e) => e.lines.forEach((l) => { if (l.party === id) b += l.debit - l.credit; })); return b; };
  // Total expense tagged to a cost center.
  const centerTotal = (id: string) => { let t = 0; entries.forEach((e) => e.lines.forEach((l) => { if (l.center === id) t += l.debit - l.credit; })); return t; };
  const [partyLedger, setPartyLedger] = useState<string>('');

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

  // Rolled-up debit/credit for a node = its own lines + all descendants' (for the multi-level trial balance).
  const sumById: { [id: string]: { d: number; c: number } } = {};
  sums.forEach((x) => { sumById[x.a.id] = { d: x.debit, c: x.credit }; });
  const rolled = (id: string): { d: number; c: number } => {
    const own = sumById[id] || { d: 0, c: 0 };
    let d = own.d, c = own.c;
    accounts.filter((a) => a.parent === id).forEach((ch) => { const r = rolled(ch.id); d += r.d; c += r.c; });
    return { d, c };
  };
  // VAT return (اظهارنامه): output VAT (on sales) − input VAT (on purchases) = net payable.
  const vatOut = sums.filter((x) => x.a.type === 'liability' && x.a.name.includes('ارزش افزوده')).reduce((s, x) => s + x.bal, 0);
  const vatIn = sums.filter((x) => x.a.type === 'asset' && x.a.name.includes('ارزش افزوده')).reduce((s, x) => s + x.bal, 0);
  const vatPayable = vatOut - vatIn;

  // Fiscal-year close: zero the temporary accounts (income/expense) into retained earnings.
  const [closeY, setCloseY] = useState(String(today.year));
  const closeFiscalYear = () => {
    const temps = sums.filter((x) => (x.a.type === 'income' || x.a.type === 'expense') && isPostable(x.a) && Math.abs(x.bal) >= 1);
    if (temps.length === 0) { confirm('حساب‌های موقتی (درآمد/هزینه) برای بستن وجود ندارد.', () => {}); return; }
    confirm('سندِ اختتامیه ساخته شود؟ حساب‌های درآمد و هزینه صفر و سود/زیان به «سود و زیانِ انباشته» منتقل می‌شود.', () => {
      let list = accounts.slice();
      const lines: EntryLine[] = [];
      let net = 0; // + = profit
      temps.forEach((x) => {
        if (x.a.type === 'income') { lines.push({ accountId: x.a.id, debit: x.bal, credit: 0 }); net += x.bal; }
        else { lines.push({ accountId: x.a.id, debit: 0, credit: x.bal }); net -= x.bal; }
      });
      const r = resolveLocal(list, 'سود و زیانِ انباشته', 'equity'); list = r.list;
      if (net > 0) lines.push({ accountId: r.acc.id, debit: 0, credit: net });
      else if (net < 0) lines.push({ accountId: r.acc.id, debit: -net, credit: 0 });
      const yr = digits(closeY) || today.year;
      const entry: JournalEntry = { id: `je-${Date.now()}`, y: yr, m: 11, d: 29, desc: `سندِ اختتامیه‌ی سالِ ${yr}`, lines, ref: `close-${yr}` };
      onChange({ ...state, accounts: list, entries: [...entries.filter((e) => e.ref !== `close-${yr}`), entry] });
    });
  };

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
            <button type="button" className={`mini-toggle-btn ${tab === 'invoice' ? 'active' : ''}`} onClick={() => setTab('invoice')}>فاکتور</button>
            <button type="button" className={`mini-toggle-btn ${tab === 'journal' ? 'active' : ''}`} onClick={() => setTab('journal')}>اسناد</button>
            <button type="button" className={`mini-toggle-btn ${tab === 'reports' ? 'active' : ''}`} onClick={() => setTab('reports')}>دفتر و تراز</button>
            <button type="button" className={`mini-toggle-btn ${tab === 'parties' ? 'active' : ''}`} onClick={() => setTab('parties')}>طرف‌حساب</button>
            <button type="button" className={`mini-toggle-btn ${tab === 'accounts' ? 'active' : ''}`} onClick={() => setTab('accounts')}>حساب‌ها</button>
          </div>

          {/* ---------------- ثبتِ سریع (راهنمای غیرحسابدار) ---------------- */}
          {tab === 'quick' && <QuickEntry today={today} vatRate={vatRate} parties={parties} centers={centers} postQuick={postQuick} onDone={() => setTab('journal')} />}

          {/* ---------------- فاکتورِ فروش ---------------- */}
          {tab === 'invoice' && <InvoicePanel today={today} vatRate={vatRate} orgName={orgName} parties={parties} invoices={invoices} partyName={partyName} monthNames={monthNames} saveInvoice={saveInvoice} invItems={invItems || []} confirm={confirm} />}

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
                          <span className="ld-date">{dateStr(e)} · {e.lines.map((l) => { const a = accById(l.accountId); const tag = l.party ? `«${partyName(l.party)}»` : l.center ? `[${centerName(l.center)}]` : ''; return `${a ? a.name : '—'}${tag} ${l.debit ? 'بد ' + fmt(l.debit) : 'بس ' + fmt(l.credit)}`; }).join(' / ')}</span>
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
                {orgName && <div className="acc-print-org">{orgName}</div>}
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

                <div className="acc-print-title">ترازِ گروه‌بندی‌شده (گروه / کل / معین)</div>
                <table className="acc-table">
                  <thead><tr><th>حساب</th><th>بدهکار</th><th>بستانکار</th><th>مانده</th></tr></thead>
                  <tbody>
                    {treeOrder.filter((a) => { const r = rolled(a.id); return r.d || r.c; }).map((a) => {
                      const r = rolled(a.id); const lvl = a.level || 'sub';
                      const bal = isDebitNormal(a.type) ? r.d - r.c : r.c - r.d;
                      return (
                        <tr key={a.id} className={lvl === 'group' ? 'acc-grp-row' : lvl === 'total' ? 'acc-tot-row' : ''}>
                          <td style={{ paddingInlineStart: 4 + depthOf(a) * 14 }}>{a.code} · {a.name}</td>
                          <td>{fmt(r.d)}</td><td>{fmt(r.c)}</td>
                          <td>{fmt(Math.abs(bal))} {bal === 0 ? '' : isDebitNormal(a.type) === bal > 0 ? 'بد' : 'بس'}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>

                <div className="acc-print-title">اظهارنامه‌ی مالیات بر ارزش افزوده</div>
                <table className="acc-table">
                  <tbody>
                    <tr><td>مالیاتِ فروش (دریافتی)</td><td>{fmt(vatOut)}</td></tr>
                    <tr><td>مالیاتِ خرید (پرداختی، قابلِ کسر)</td><td>{fmt(vatIn)}</td></tr>
                    <tr className="acc-total"><td>{vatPayable >= 0 ? 'مالیاتِ قابلِ پرداخت' : 'اعتبارِ مالیاتی (طلب)'}</td><td>{fmt(Math.abs(vatPayable))}</td></tr>
                  </tbody>
                </table>

                {centers.length > 0 && (
                  <>
                    <div className="acc-print-title">هزینه به تفکیکِ مرکزِ هزینه</div>
                    <table className="acc-table">
                      <thead><tr><th>مرکزِ هزینه</th><th>جمعِ هزینه</th></tr></thead>
                      <tbody>
                        {centers.map((c) => <tr key={c.id}><td>{c.name}</td><td>{fmt(centerTotal(c.id))}</td></tr>)}
                        <tr className="acc-total"><td>جمع</td><td>{fmt(centers.reduce((s, c) => s + centerTotal(c.id), 0))}</td></tr>
                      </tbody>
                    </table>
                  </>
                )}

                {parties.length > 0 && (
                  <>
                    <div className="acc-print-title">مانده‌ی طرف‌حساب‌ها</div>
                    <table className="acc-table">
                      <thead><tr><th>طرف‌حساب</th><th>مانده</th><th>وضعیت</th></tr></thead>
                      <tbody>
                        {parties.map((p) => { const bal = partyBalance(p.id); return <tr key={p.id}><td>{p.name}</td><td>{fmt(Math.abs(bal))}</td><td>{bal === 0 ? 'تسویه' : bal > 0 ? 'طلبِ ما' : 'بدهیِ ما'}</td></tr>; })}
                      </tbody>
                    </table>
                  </>
                )}

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
              <div className="loan-sched-head acc-noprint"><span>بستنِ سالِ مالی (سندِ اختتامیه)</span></div>
              <div className="acc-addacc acc-noprint">
                <input className="tool-text-input" type="number" inputMode="numeric" dir="ltr" value={closeY} onChange={(e) => setCloseY(e.target.value.replace(/[^0-9]/g, ''))} />
                <button className="loan-submit" onClick={closeFiscalYear}>🔒 بستنِ سال و انتقالِ سود/زیان</button>
              </div>
              <div className="tool-note acc-noprint">حساب‌های درآمد و هزینه صفر و سود/زیانِ دوره به «سود و زیانِ انباشته» منتقل می‌شود. برای لغو، سندِ اختتامیه را از تبِ «اسناد» حذف کنید.</div>
              <button className="loan-submit acc-noprint" onClick={printReport}>🖨️ چاپ / ذخیره‌ی PDF</button>
              <button className="acc-addline acc-noprint" onClick={() => downloadCsv('trial-balance.csv', [['حساب', 'بدهکار', 'بستانکار', 'مانده'], ...sums.map((x) => [`${x.a.code} ${x.a.name}`, x.debit, x.credit, x.bal]), ['جمع', grandDebit, grandCredit, '']])}>📤 خروجیِ اکسل (CSV)</button>
            </>
          )}

          {/* ---------------- طرف‌حساب‌ها (تفصیلی) و مرکزِ هزینه ---------------- */}
          {tab === 'parties' && (
            <>
              <div className="loan-sched-head"><span>افزودنِ طرف‌حساب</span></div>
              <input className="tool-text-input" type="text" placeholder="نامِ مشتری / تأمین‌کننده" value={pName} onChange={(e) => setPName(e.target.value)} />
              <div className="acc-type-pick">
                {(['customer', 'supplier', 'both'] as Party['kind'][]).map((k) => (
                  <button key={k} type="button" className={`fund-level-btn ${pKind === k ? 'active' : ''}`} onClick={() => setPKind(k)}>{PARTY_KIND_LABEL[k]}</button>
                ))}
              </div>
              <button className="loan-submit" disabled={!pName.trim()} onClick={addParty}>افزودنِ طرف‌حساب</button>

              <div className="loan-sched-head"><span>مانده‌ی طرف‌حساب‌ها</span><span className="loan-sched-hint">{parties.length}</span></div>
              <div className="loan-detail-list">
                {parties.length === 0 && <div className="tool-note">هنوز طرف‌حسابی ثبت نشده. در «ثبتِ سریع» هنگامِ فروش/خرید نسیه، طرف‌حساب را انتخاب کنید.</div>}
                {parties.map((p) => { const bal = partyBalance(p.id); return (
                  <div key={p.id} className="loan-detail-row">
                    <div className="ld-info">
                      <span className="ld-amt">{p.name} <span className="acc-lvl-tag">{PARTY_KIND_LABEL[p.kind]}</span></span>
                      <span className="ld-date">{bal === 0 ? 'تسویه' : bal > 0 ? `طلبِ ما: ${fmt(bal)}` : `بدهیِ ما: ${fmt(-bal)}`}</span>
                    </div>
                    <div className="att-approw">
                      <button className="att-inlinebtn" title="کارتِ حساب" onClick={() => setPartyLedger(partyLedger === p.id ? '' : p.id)}>کارت</button>
                      {!partyUsed(p.id) && <button className="fm-notify" title="حذف" onClick={() => delParty(p.id)}>🗑</button>}
                    </div>
                  </div>
                ); })}
              </div>

              {/* کارتِ حساب (per-party ledger) */}
              {partyLedger && (
                <div className="acc-print">
                  <div className="acc-print-title">کارتِ حساب — {partyName(partyLedger)}</div>
                  <table className="acc-table">
                    <thead><tr><th>تاریخ</th><th>شرح</th><th>بدهکار</th><th>بستانکار</th><th>مانده</th></tr></thead>
                    <tbody>
                      {(() => {
                        const rowsOut: { e: JournalEntry; d: number; c: number; run: number }[] = []; let run = 0;
                        entries.slice().sort((a, b) => (a.y * 10000 + a.m * 100 + a.d) - (b.y * 10000 + b.m * 100 + b.d))
                          .forEach((e) => e.lines.forEach((l) => { if (l.party === partyLedger) { run += l.debit - l.credit; rowsOut.push({ e, d: l.debit, c: l.credit, run }); } }));
                        return rowsOut.length === 0
                          ? <tr><td colSpan={5} style={{ textAlign: 'center', opacity: .6 }}>گردشی ندارد</td></tr>
                          : rowsOut.map((r, i) => <tr key={i}><td>{dateStr(r.e)}</td><td>{r.e.desc}</td><td>{r.d ? fmt(r.d) : ''}</td><td>{r.c ? fmt(r.c) : ''}</td><td>{fmt(Math.abs(r.run))} {r.run >= 0 ? 'بد' : 'بس'}</td></tr>);
                      })()}
                    </tbody>
                  </table>
                </div>
              )}

              <div className="loan-sched-head"><span>مراکزِ هزینه</span><span className="loan-sched-hint">{centers.length}</span></div>
              <div className="acc-addacc">
                <input className="tool-text-input" type="text" placeholder="نامِ مرکزِ هزینه (مثلاً پروژه‌ی الف)" value={cName} onChange={(e) => setCName(e.target.value)} />
                <button className="loan-submit" disabled={!cName.trim()} onClick={addCenter}>افزودن</button>
              </div>
              <div className="loan-detail-list">
                {centers.map((c) => (
                  <div key={c.id} className="loan-detail-row">
                    <div className="ld-info"><span className="ld-amt">{c.name}</span><span className="ld-date">هزینه: {fmt(centerTotal(c.id))}</span></div>
                    {!centerUsed(c.id) && <button className="fm-notify" title="حذف" onClick={() => delCenter(c.id)}>🗑</button>}
                  </div>
                ))}
              </div>
            </>
          )}

          {/* ---------------- حساب‌ها (کدینگِ سلسله‌مراتبی) ---------------- */}
          {tab === 'accounts' && (
            <>
              <label className="field-label">نامِ شرکت/کسب‌وکار (سربرگِ گزارش‌ها)</label>
              <input className="tool-text-input" type="text" placeholder="مثلاً شرکتِ سیمرغ" value={orgName} onChange={(e) => setOrgName(e.target.value)} />
              <label className="field-label">نرخِ مالیات بر ارزش افزوده (٪)</label>
              <input className="tool-text-input" type="text" inputMode="numeric" dir="ltr" value={String(vatRate)} onChange={(e) => setVat(digits(e.target.value))} />

              <div className="loan-sched-head"><span>سندِ افتتاحیه (مانده‌ی اول دوره)</span></div>
              <OpeningEntry accounts={postable.filter((a) => a.type === 'asset' || a.type === 'liability' || a.type === 'equity')} today={today} postOpening={postOpening} />

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
function QuickEntry({ today, vatRate, parties, centers, postQuick, onDone }: {
  today: { year: number; month: number; day: number };
  vatRate: number;
  parties: Party[];
  centers: CostCenter[];
  postQuick: (date: { y: number; m: number; d: number }, desc: string, spec: { name: string; type: AccType; debit?: number; credit?: number; party?: string; center?: string }[]) => boolean;
  onDone: () => void;
}) {
  const [op, setOp] = useState<QuickOp>('sale');
  const [amount, setAmount] = useState('');
  const [channel, setChannel] = useState<'cash' | 'bank'>('cash');   // صندوق یا بانک
  const [onCredit, setOnCredit] = useState(false);                   // نسیه؟
  const [selParty, setSelParty] = useState('');                      // طرف‌حساب (تفصیلی)
  const [selCenter, setSelCenter] = useState('');                    // مرکزِ هزینه
  const [withVat, setWithVat] = useState(true);                      // شاملِ مالیات بر ارزش افزوده؟
  const [asInventory, setAsInventory] = useState(false);            // خرید به‌عنوانِ موجودیِ کالا یا هزینه
  const [desc, setDesc] = useState('');
  const [eY, setEY] = useState(String(today.year)); const [eM, setEM] = useState(String(today.month + 1)); const [eD, setED] = useState(String(today.day));

  const amt = digits(amount);
  const vat = withVat ? Math.round(amt * vatRate / 100) : 0;
  const channelName = channel === 'cash' ? 'صندوق (نقد)' : 'بانک';
  // Build the journal lines for the chosen operation, then tag the subsidiary dimensions:
  // party (طرف‌حساب) on the receivable/payable line, cost center (مرکز هزینه) on the expense line.
  const spec: { name: string; type: AccType; debit?: number; credit?: number; party?: string; center?: string }[] = (() => {
    const raw = ((): { name: string; type: AccType; debit?: number; credit?: number }[] => {
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
    return raw.map((l) => {
      const out: typeof l & { party?: string; center?: string } = { ...l };
      if (selParty && (l.name === 'حساب‌های دریافتنی' || l.name === 'حساب‌های پرداختنی')) out.party = selParty;
      if (selCenter && l.type === 'expense') out.center = selCenter;
      return out;
    });
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
      {/* طرف‌حساب (تفصیلی) — برای فروش/خرید/دریافت/پرداختِ نسیه */}
      {(op === 'sale' || op === 'purchase' || op === 'receive' || op === 'pay') && parties.length > 0 && (
        <>
          <label className="field-label">طرف‌حساب (اختیاری — برای نسیه)</label>
          <select className="tool-text-input" value={selParty} onChange={(e) => setSelParty(e.target.value)}>
            <option value="">— بدون طرف‌حساب —</option>
            {parties.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </>
      )}
      {/* مرکزِ هزینه — برای خرید/پرداختِ هزینه‌ای */}
      {(op === 'purchase' || op === 'pay') && centers.length > 0 && (
        <>
          <label className="field-label">مرکزِ هزینه (اختیاری)</label>
          <select className="tool-text-input" value={selCenter} onChange={(e) => setSelCenter(e.target.value)}>
            <option value="">— بدون مرکز —</option>
            {centers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </>
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

// ---------------- Opening entry (سندِ افتتاحیه) ----------------
// Enter starting balances per account (natural side); any imbalance plugs to سرمایه so it always balances.
function OpeningEntry({ accounts, today, postOpening }: {
  accounts: Account[];
  today: { year: number; month: number; day: number };
  postOpening: (yr: number, amounts: { [id: string]: number }) => boolean;
}) {
  const [yr, setYr] = useState(String(today.year));
  const [amts, setAmts] = useState<{ [id: string]: string }>({});
  const set = (id: string, v: string) => setAmts((s) => ({ ...s, [id]: withSep(v) }));
  let debit = 0, credit = 0;
  accounts.forEach((a) => { const v = digits(amts[a.id] || ''); if (v > 0) { if (a.type === 'asset') debit += v; else credit += v; } });
  const plug = debit - credit;
  const submit = () => {
    const map: { [id: string]: number } = {};
    accounts.forEach((a) => { const v = digits(amts[a.id] || ''); if (v > 0) map[a.id] = v; });
    if (postOpening(digits(yr) || today.year, map)) setAmts({});
  };
  return (
    <>
      <div className="tool-note">مانده‌ی ابتدای دوره‌ی هر حساب را وارد کنید (دارایی = بدهکار، بدهی/سرمایه = بستانکار). اختلاف به‌صورتِ خودکار به «سرمایه» می‌رود تا سند متوازن شود.</div>
      <label className="field-label">سالِ مالی</label>
      <input className="tool-text-input" type="number" inputMode="numeric" dir="ltr" value={yr} onChange={(e) => setYr(e.target.value.replace(/[^0-9]/g, ''))} />
      <div className="acc-open-list">
        {accounts.map((a) => (
          <div key={a.id} className="acc-open-row">
            <span className="acc-open-name">{a.code} · {a.name}</span>
            <input className="tool-text-input" type="text" inputMode="numeric" dir="ltr" placeholder={a.type === 'asset' ? 'بدهکار' : 'بستانکار'} value={amts[a.id] || ''} onChange={(e) => set(a.id, e.target.value)} />
          </div>
        ))}
      </div>
      <div className="tool-result">
        <div className="tool-result-row"><span>جمعِ بدهکار</span><strong>{fmt(debit)}</strong></div>
        <div className="tool-result-row"><span>جمعِ بستانکار</span><strong>{fmt(credit)}</strong></div>
        <div className="tool-result-row closing"><span>اختلاف (به سرمایه)</span><strong>{fmt(Math.abs(plug))} {plug === 0 ? '' : plug > 0 ? '← بستانکارِ سرمایه' : '← بدهکارِ سرمایه'}</strong></div>
      </div>
      <button className="loan-submit" disabled={debit + credit <= 0} onClick={submit}>🔓 ثبتِ سندِ افتتاحیه</button>
    </>
  );
}

// ---------------- Official sales invoice (فاکتورِ فروش) ----------------
function InvoicePanel({ today, vatRate, orgName, parties, invoices, partyName, monthNames, saveInvoice, invItems, confirm }: {
  today: { year: number; month: number; day: number };
  vatRate: number;
  orgName: string;
  parties: Party[];
  invoices: Invoice[];
  partyName: (id?: string) => string;
  monthNames: string[];
  saveInvoice: (inv: Omit<Invoice, 'id' | 'number'>) => Invoice | null;
  invItems: InvLookupItem[];
  confirm: (msg: string, onYes: () => void) => void;
}) {
  type Row = { name: string; qty: string; price: string; itemId?: string; cost?: number };
  const [mode, setMode] = useState<'sale' | 'purchase'>('sale');
  const [partyId, setPartyId] = useState('');
  const [buyerName, setBuyerName] = useState('');
  const [items, setItems] = useState<Row[]>([{ name: '', qty: '1', price: '' }]);
  const [discount, setDiscount] = useState('');
  const [vr, setVr] = useState(String(vatRate));
  const [paid, setPaid] = useState<'cash' | 'bank' | 'credit'>('cash');
  const [asInv, setAsInv] = useState(true);                   // purchase: ثبت به‌عنوانِ موجودیِ کالا یا هزینه
  const [eY, setEY] = useState(String(today.year)); const [eM, setEM] = useState(String(today.month + 1)); const [eD, setED] = useState(String(today.day));
  const [shown, setShown] = useState<Invoice | null>(null);   // invoice to print (just-saved or reprint)
  const [scan, setScan] = useState('');
  const [showCam, setShowCam] = useState(false);              // phone-camera scanner overlay
  const counterpartyLabel = mode === 'purchase' ? 'فروشنده' : 'خریدار';

  const setItem = (i: number, patch: Partial<Row>) => setItems((s) => s.map((x, k) => (k === i ? { ...x, ...patch } : x)));
  const subtotal = items.reduce((s, it) => s + (digits(it.qty) * digits(it.price)), 0);
  const disc = digits(discount);
  const net = Math.max(0, subtotal - disc);
  const vat = Math.round(net * (digits(vr) || 0) / 100);
  const total = net + vat;

  // Barcode scan → look up an inventory item by barcode/code/std-code and add (or increment) its invoice line.
  const onScan = (codeRaw: string) => {
    const code = cleanBarcode(codeRaw); setScan('');
    const it = invItems.find((x) => cleanBarcode(x.barcode || '') === code || cleanBarcode(x.code || '') === code || cleanBarcode(x.stdCode || '') === code);
    if (!it) { confirm(`بارکدِ «${codeRaw}» در انبار نیست.`, () => {}); return; }
    setItems((s) => {
      const idx = s.findIndex((r) => r.itemId === it.id);
      if (idx >= 0) { const c = s.slice(); c[idx] = { ...c[idx], qty: String((digits(c[idx].qty) || 0) + 1) }; return c; }
      const line: Row = { name: it.name, qty: '1', price: withSep(String(mode === 'purchase' ? (it.buy || 0) : (it.sell || 0))), itemId: it.id, cost: it.buy || 0 };
      // replace the first empty row, else append
      const empty = s.findIndex((r) => !r.name.trim());
      if (empty >= 0) { const c = s.slice(); c[empty] = line; return c; }
      return [...s, line];
    });
  };

  const submit = () => {
    const cleanItems: InvoiceItem[] = items.filter((it) => it.name.trim() && digits(it.price) > 0).map((it) => ({ name: it.name.trim(), qty: digits(it.qty) || 1, price: digits(it.price), itemId: it.itemId, cost: it.cost }));
    if (cleanItems.length === 0) return;
    const m0 = Math.min(11, Math.max(0, (digits(eM) || 1) - 1));
    const inv = saveInvoice({ kind: mode, y: digits(eY) || today.year, m: m0, d: Math.min(31, Math.max(1, digits(eD) || 1)), partyId: partyId || undefined, buyerName: partyId ? partyName(partyId) : (buyerName.trim() || undefined), items: cleanItems, discount: disc, vatRate: digits(vr) || 0, paid, asInventory: mode === 'purchase' ? asInv : undefined });
    if (inv) { setShown(inv); setItems([{ name: '', qty: '1', price: '' }]); setDiscount(''); setBuyerName(''); }
  };

  const dateStr = (e: { y: number; m: number; d: number }) => `${e.d} ${monthNames[e.m]} ${e.y}`;
  // Printable invoice block
  const printInvoice = (inv: Invoice) => {
    const sub = inv.items.reduce((s, it) => s + it.qty * it.price, 0);
    const n = Math.max(0, sub - inv.discount); const v = Math.round(n * inv.vatRate / 100); const t = n + v;
    const kl = inv.kind === 'purchase' ? 'خرید' : 'فروش';
    const cpl = inv.kind === 'purchase' ? 'فروشنده' : 'خریدار';
    return (
      <div className="acc-print acc-invoice">
        <div className="acc-print-org">{orgName || `فاکتورِ ${kl}`}</div>
        <div className="acc-inv-head">
          <span>فاکتورِ {kl} شماره‌ی {inv.number}</span>
          <span>تاریخ: {dateStr(inv)}</span>
        </div>
        <div className="acc-inv-buyer">{cpl}: {inv.buyerName || partyName(inv.partyId) || '—'} · پرداخت: {inv.paid === 'credit' ? 'نسیه' : inv.paid === 'bank' ? 'بانک' : 'نقدی'}</div>
        <table className="acc-table">
          <thead><tr><th>ردیف</th><th>شرح</th><th>تعداد</th><th>مبلغِ واحد</th><th>مبلغِ کل</th></tr></thead>
          <tbody>
            {inv.items.map((it, i) => <tr key={i}><td>{i + 1}</td><td>{it.name}</td><td>{it.qty}</td><td>{fmt(it.price)}</td><td>{fmt(it.qty * it.price)}</td></tr>)}
            <tr><td colSpan={4}>جمعِ کل</td><td>{fmt(sub)}</td></tr>
            {inv.discount > 0 && <tr><td colSpan={4}>تخفیف</td><td>−{fmt(inv.discount)}</td></tr>}
            {v > 0 && <tr><td colSpan={4}>مالیات بر ارزش افزوده ({inv.vatRate}٪)</td><td>{fmt(v)}</td></tr>}
            <tr className="acc-total"><td colSpan={4}>مبلغِ قابلِ پرداخت</td><td>{fmt(t)} تومان</td></tr>
          </tbody>
        </table>
      </div>
    );
  };

  return (
    <>
      <div className="acc-inv-form acc-noprint">
        <div className="acc-quick-seg">
          <button type="button" className={`mini-toggle-btn ${mode === 'sale' ? 'active' : ''}`} onClick={() => setMode('sale')}>فاکتورِ فروش</button>
          <button type="button" className={`mini-toggle-btn ${mode === 'purchase' ? 'active' : ''}`} onClick={() => setMode('purchase')}>فاکتورِ خرید</button>
        </div>
        <div className="att-addgrid">
          <div><label className="field-label">{counterpartyLabel} (طرف‌حساب)</label>
            <select className="tool-text-input" value={partyId} onChange={(e) => setPartyId(e.target.value)}>
              <option value="">— نام را دستی بنویسید —</option>
              {parties.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </div>
          {!partyId && <div><label className="field-label">نامِ {counterpartyLabel}</label><input className="tool-text-input" type="text" value={buyerName} onChange={(e) => setBuyerName(e.target.value)} /></div>}
        </div>
        {mode === 'purchase' && (
          <label className="fund-switch"><input type="checkbox" checked={asInv} onChange={(e) => setAsInv(e.target.checked)} /><span>ثبت به‌عنوانِ «موجودیِ کالا» (در غیرِ این‌صورت هزینه)</span></label>
        )}

        {invItems.length > 0 && (
          <>
            <label className="field-label">افزودن با بارکد (اسکنر، دوربین یا تایپ + Enter)</label>
            <div className="att-addgrid">
              <input className="tool-text-input" type="text" dir="ltr" placeholder="بارکدِ کالا را بخوانید…" value={scan} onChange={(e) => setScan(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && scan.trim()) onScan(scan.trim()); }} />
              <button className="acc-addline" onClick={() => setShowCam(true)}>📷 دوربین</button>
            </div>
            {mode === 'sale' && <div className="tool-note">با ثبتِ فاکتورِ فروش، موجودیِ این کالاها از انبار کم و بهای تمام‌شده در حسابداری ثبت می‌شود.</div>}
          </>
        )}
        <div className="loan-sched-head"><span>اقلامِ فاکتور</span></div>
        <div className="acc-inv-items">
          <div className="acc-inv-item acc-inv-item-head"><span>شرح</span><span>تعداد</span><span>مبلغِ واحد</span><span></span></div>
          {items.map((it, i) => (
            <div className="acc-inv-item" key={i}>
              <input className="tool-text-input" type="text" placeholder="کالا/خدمت" value={it.name} onChange={(e) => setItem(i, { name: e.target.value })} />
              <input className="tool-text-input" type="text" inputMode="numeric" dir="ltr" value={it.qty} onChange={(e) => setItem(i, { qty: e.target.value.replace(/[^0-9]/g, '') })} />
              <input className="tool-text-input" type="text" inputMode="numeric" dir="ltr" value={it.price} onChange={(e) => setItem(i, { price: withSep(e.target.value) })} />
              <button className="acc-line-del" onClick={() => setItems(items.length > 1 ? items.filter((_, k) => k !== i) : items)}>✕</button>
            </div>
          ))}
        </div>
        <button className="acc-addline" onClick={() => setItems([...items, { name: '', qty: '1', price: '' }])}>+ ردیف</button>

        <div className="att-addgrid">
          <div><label className="field-label">تخفیف</label><input className="tool-text-input" type="text" inputMode="numeric" dir="ltr" value={discount} onChange={(e) => setDiscount(withSep(e.target.value))} /></div>
          <div><label className="field-label">مالیات (٪)</label><input className="tool-text-input" type="text" inputMode="numeric" dir="ltr" value={vr} onChange={(e) => setVr(e.target.value.replace(/[^0-9]/g, ''))} /></div>
        </div>
        <div className="acc-quick-seg">
          <button type="button" className={`mini-toggle-btn ${paid === 'cash' ? 'active' : ''}`} onClick={() => setPaid('cash')}>نقدی</button>
          <button type="button" className={`mini-toggle-btn ${paid === 'bank' ? 'active' : ''}`} onClick={() => setPaid('bank')}>بانک</button>
          <button type="button" className={`mini-toggle-btn ${paid === 'credit' ? 'active' : ''}`} onClick={() => setPaid('credit')}>نسیه</button>
        </div>
        <label className="field-label">تاریخ (روز / ماه / سال)</label>
        <div className="acc-date">
          <input className="tool-text-input" type="number" inputMode="numeric" dir="ltr" value={eD} onChange={(e) => setED(e.target.value.replace(/[^0-9]/g, ''))} />
          <input className="tool-text-input" type="number" inputMode="numeric" dir="ltr" value={eM} onChange={(e) => setEM(e.target.value.replace(/[^0-9]/g, ''))} />
          <input className="tool-text-input" type="number" inputMode="numeric" dir="ltr" value={eY} onChange={(e) => setEY(e.target.value.replace(/[^0-9]/g, ''))} />
        </div>

        <div className="tool-result">
          <div className="tool-result-row"><span>جمعِ کل</span><strong>{fmt(subtotal)}</strong></div>
          {disc > 0 && <div className="tool-result-row"><span>تخفیف</span><strong>−{fmt(disc)}</strong></div>}
          <div className="tool-result-row"><span>مالیات</span><strong>{fmt(vat)}</strong></div>
          <div className="tool-result-row closing"><span>قابلِ پرداخت</span><strong>{fmt(total)}</strong></div>
        </div>
        <button className="loan-submit" disabled={total <= 0} onClick={submit}>🧾 ثبت و صدورِ فاکتورِ {mode === 'purchase' ? 'خرید' : 'فروش'}</button>
        {paid === 'credit' && !partyId && <div className="tool-note">برای معامله‌ی نسیه بهتر است {counterpartyLabel} را به‌عنوانِ طرف‌حساب انتخاب کنید تا در «کارتِ حساب» ثبت شود.</div>}
      </div>

      {shown && (<>
        {printInvoice(shown)}
        <button className="loan-submit acc-noprint" onClick={() => window.print()}>🖨️ چاپِ فاکتور / PDF</button>
      </>)}

      {invoices.length > 0 && (
        <div className="acc-noprint">
          <div className="loan-sched-head"><span>فاکتورهای صادرشده</span><span className="loan-sched-hint">{invoices.length}</span></div>
          <div className="loan-detail-list">
            {invoices.slice().reverse().slice(0, 30).map((inv) => {
              const sub = inv.items.reduce((s, it) => s + it.qty * it.price, 0); const n = Math.max(0, sub - inv.discount); const t = n + Math.round(n * inv.vatRate / 100);
              return (
                <div key={inv.id} className="loan-detail-row">
                  <div className="ld-info">
                    <span className="ld-amt">{inv.kind === 'purchase' ? 'خرید' : 'فروش'} #{inv.number} {inv.buyerName || partyName(inv.partyId) || ''} <span className="fm-shares">{fmt(t)}</span></span>
                    <span className="ld-date">{dateStr(inv)} · {inv.items.length} قلم · {inv.paid === 'credit' ? 'نسیه' : inv.paid === 'bank' ? 'بانک' : 'نقدی'}</span>
                  </div>
                  <button className="att-inlinebtn" onClick={() => setShown(inv)}>نمایش</button>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {showCam && (
        <CameraScanner onClose={() => setShowCam(false)} onResult={(code) => { setShowCam(false); onScan(code); }} />
      )}
    </>
  );
}
