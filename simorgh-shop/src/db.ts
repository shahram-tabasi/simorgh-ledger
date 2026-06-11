// Local data store for the shop POS (localStorage). Simple, offline, no server DB needed.
import { cleanBarcode } from './barcode';

export interface Product { id: string; name: string; barcode: string; price: number; cost: number; stock: number; }
export interface SaleItem { barcode: string; name: string; price: number; cost: number; qty: number; }
export interface Sale { id: string; ts: number; items: SaleItem[]; total: number; profit: number; }

const PKEY = 'shopProducts';
const SKEY = 'shopSales';

const read = <T,>(k: string): T[] => { try { return JSON.parse(localStorage.getItem(k) || '[]'); } catch { return []; } };
const write = (k: string, v: unknown) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* quota */ } };

export const loadProducts = (): Product[] => read<Product>(PKEY);
export const saveProducts = (p: Product[]) => write(PKEY, p);
export const loadSales = (): Sale[] => read<Sale>(SKEY);
export const saveSales = (s: Sale[]) => write(SKEY, s);

export const findByBarcode = (products: Product[], code: string): Product | undefined => {
  const c = cleanBarcode(code);
  return products.find((p) => cleanBarcode(p.barcode) === c);
};

export const money = (n: number): string => Math.round(n || 0).toLocaleString('en-US');
export const digits = (s: string): number => parseInt((s || '').replace(/[^0-9]/g, ''), 10) || 0;
export const withSep = (s: string): string => { const d = digits(s); return d ? d.toLocaleString('en-US') : ''; };
