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
  // "1.000" / "12.345.678" without a comma: dots are Danish thousands separators.
  const thousandsOnly = !raw.includes(',') && /^-?\d{1,3}(\.\d{3})+$/.test(raw);
  const normalized = raw.includes(',') || thousandsOnly ? raw.replace(/\./g, '').replace(',', '.') : raw;
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
  // Two decimals (the precision the UI displays), rounded half away from zero on the
  // decimal string so binary float noise (1.005 -> 1.00499…) cannot bite.
  const negative = normalized.startsWith('-');
  const [intPart, decPart = ''] = normalized.replace('-', '').split('.');
  let cents = parseInt((decPart + '000').slice(0, 2), 10);
  let whole = parseInt(intPart, 10);
  if (parseInt((decPart + '000').charAt(2), 10) >= 5) cents += 1;
  if (cents === 100) {
    cents = 0;
    whole += 1;
  }
  const abs = whole + cents / 100;
  return negative ? -abs : abs;
}

/** ISO yyyy-mm-dd -> dd.mm.yyyy */
export function formatDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  const [y, m, d] = iso.split('-');
  return `${d}.${m}.${y}`;
}

/** "07.09.2026" (Danish, also "7.9.2026") or ISO "2026-09-07" -> ISO. Throws on anything else. */
export function parseDateInput(input: string): string {
  const s = input.trim();
  let y: number, m: number, d: number;
  let match: RegExpMatchArray | null;
  if ((match = s.match(/^(\d{4})-(\d{2})-(\d{2})$/))) {
    [y, m, d] = [Number(match[1]), Number(match[2]), Number(match[3])];
  } else if ((match = s.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})$/))) {
    [d, m, y] = [Number(match[1]), Number(match[2]), Number(match[3])];
  } else {
    throw new Error(`Ugyldig dato: ${input} (brug dd.mm.åååå)`);
  }
  const date = new Date(Date.UTC(y, m - 1, d));
  if (date.getUTCFullYear() !== y || date.getUTCMonth() !== m - 1 || date.getUTCDate() !== d) {
    throw new Error(`Ugyldig dato: ${input}`);
  }
  return date.toISOString().slice(0, 10);
}

/** True for a real calendar date in ISO form (rejects 2026-13-01, 2026-02-30). */
export function isValidIsoDate(s: string): boolean {
  try {
    return parseDateInput(s) === s;
  } catch {
    return false;
  }
}

/** CVR grouped in pairs for reading: 12345678 -> "12 34 56 78". */
export function formatCvr(cvr: string | null | undefined): string {
  if (!cvr) return '';
  return cvr.replace(/\s/g, '').replace(/(\d{2})(?=\d)/g, '$1 ');
}

/** Percentage from basis points, "25 %" */
export function formatVatRate(bp: number): string {
  const pct = bp / 100;
  return `${Number.isInteger(pct) ? pct : pct.toFixed(2).replace('.', ',')} %`;
}

/**
 * Line total in whole øre. Quantities carry at most two decimals, so the product
 * is computed on integers (hundredths × øre) and only the final /100 is rounded,
 * half away from zero. Shared by the server and the editor preview.
 */
export function lineTotalOre(quantity: number, unitPriceOre: number): number {
  const hundredths = Math.round(quantity * 100);
  return roundOre((hundredths * unitPriceOre) / 100);
}

/** Round to whole øre, half away from zero, so negation is exact: round(-x) === -round(x). */
export function roundOre(n: number): number {
  return n < 0 ? -Math.round(-n) : Math.round(n);
}

/** Today's date in the business's time zone (DKK-only app: Europe/Copenhagen). */
export function todayIso(now = new Date()): string {
  return new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Copenhagen' }).format(now);
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
  if (inv.isCreditNote) return { label: 'Kreditnota', cls: 'badge--kreditnota' };
  if (inv.paidDate) return { label: 'Betalt', cls: 'badge--betalt' };
  if (inv.dueDate < today) {
    const days = Math.round((Date.parse(today) - Date.parse(inv.dueDate)) / 86400000);
    return { label: 'Forfalden', cls: 'badge--forfalden', overdueDays: days };
  }
  return { label: 'Åben', cls: 'badge--aaben' };
}
