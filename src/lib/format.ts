/** Shared (client + server) formatting helpers. All money is integer øre. */

const MINUS = '−';

export function formatOre(ore: number, withUnit = true): string {
  const negative = ore < 0;
  const abs = Math.abs(Math.round(ore));
  const kr = Math.floor(abs / 100);
  const rest = abs % 100;
  const krStr = kr.toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  const s = `${krStr},${rest.toString().padStart(2, '0')}`;
  const signed = negative ? `${MINUS}${s}` : s;
  return withUnit ? `${signed} kr.` : signed;
}

/** "1.234,56" -> 123456. Accepts "1234.56", "1234,56", "1.234,56", "-12". */
export function parseKrToOre(input: string): number {
  const raw = input
    .trim()
    .replace(/\s/g, '')
    .replace(/kr\.?$/i, '')
    .replace(new RegExp(MINUS, 'g'), '-');
  if (raw === '') throw new Error('Tomt beløb');
  const normalized = raw.includes(',') ? raw.replace(/\./g, '').replace(',', '.') : raw;
  if (!/^-?\d+(\.\d{1,2})?$/.test(normalized)) throw new Error(`Ugyldigt beløb: ${input}`);
  const [intPart, decPart = ''] = normalized.replace('-', '').split('.');
  const ore = parseInt(intPart, 10) * 100 + parseInt((decPart + '00').slice(0, 2), 10);
  return normalized.startsWith('-') ? -ore : ore;
}

/** Danish decimal with 2 decimals for quantities, e.g. 42 -> "42,00". */
export function formatQuantity(q: number): string {
  const s = q.toFixed(2).replace('.', ',');
  return s.startsWith('-') ? MINUS + s.slice(1) : s;
}

export function parseQuantity(input: string): number {
  const raw = input.trim().replace(/\s/g, '').replace(new RegExp(MINUS, 'g'), '-');
  const normalized = raw.includes(',') ? raw.replace(/\./g, '').replace(',', '.') : raw;
  if (normalized === '' || !/^-?\d+(\.\d+)?$/.test(normalized)) {
    throw new Error(`Ugyldigt antal: ${input}`);
  }
  return Math.round(Number(normalized) * 1000) / 1000;
}

/** ISO yyyy-mm-dd -> dd.mm.yyyy */
export function formatDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  const [y, m, d] = iso.split('-');
  return `${d}.${m}.${y}`;
}

/** Percentage from basis points, "25 %" */
export function formatVatRate(bp: number): string {
  const pct = bp / 100;
  return `${Number.isInteger(pct) ? pct : pct.toFixed(2).replace('.', ',')} %`;
}

export function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

export function addDays(iso: string, days: number): string {
  const d = new Date(iso + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function quarterOf(iso: string): { year: number; quarter: number } {
  const [y, m] = iso.split('-').map(Number);
  return { year: y, quarter: Math.floor((m - 1) / 3) + 1 };
}

export function quarterRange(year: number, quarter: number): { from: string; to: string } {
  const startMonth = (quarter - 1) * 3 + 1;
  const endMonth = startMonth + 2;
  const lastDay = new Date(Date.UTC(year, endMonth, 0)).getUTCDate();
  const pad = (n: number) => n.toString().padStart(2, '0');
  return { from: `${year}-${pad(startMonth)}-01`, to: `${year}-${pad(endMonth)}-${pad(lastDay)}` };
}

export const QUARTER_LABELS: Record<number, string> = {
  1: '1. kvartal (jan–mar)',
  2: '2. kvartal (apr–jun)',
  3: '3. kvartal (jul–sep)',
  4: '4. kvartal (okt–dec)'
};

export type InvoiceStatusLabel = 'Kladde' | 'Åben' | 'Forfalden' | 'Betalt' | 'Krediteret' | 'Kreditnota';

export function invoiceStatus(
  inv: { status: string; dueDate: string; paidDate: string | null; isCreditNote?: boolean },
  today = todayIso()
): { label: InvoiceStatusLabel; cls: string; overdueDays?: number } {
  if (inv.status === 'draft') return { label: 'Kladde', cls: 'badge--kladde' };
  if (inv.status === 'credited') return { label: 'Krediteret', cls: 'badge--krediteret' };
  if (inv.isCreditNote) return { label: 'Kreditnota', cls: 'badge--krediteret' };
  if (inv.paidDate) return { label: 'Betalt', cls: 'badge--betalt' };
  if (inv.dueDate < today) {
    const days = Math.round((Date.parse(today) - Date.parse(inv.dueDate)) / 86400000);
    return { label: 'Forfalden', cls: 'badge--forfalden', overdueDays: days };
  }
  return { label: 'Åben', cls: 'badge--aaben' };
}
