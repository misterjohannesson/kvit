/**
 * Presentation helpers. Amounts arrive from the app as integer øre and go out
 * to the model as both the integer and the Danish string ("1.234,56 kr.").
 * Kept independent of the app's code: the MCP is a separate codebase that only
 * speaks HTTP.
 */

const MINUS = '−';

export interface Money {
  amount_ore: number;
  amount_formatted: string;
}

export function formatOre(ore: number): string {
  const negative = ore < 0;
  const abs = Math.abs(Math.round(ore));
  const kr = Math.floor(abs / 100).toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  const rest = (abs % 100).toString().padStart(2, '0');
  return `${negative ? MINUS : ''}${kr},${rest} kr.`;
}

export function money(ore: number): Money {
  return { amount_ore: ore, amount_formatted: formatOre(ore) };
}

/** Today's date in the business's time zone (Europe/Copenhagen), ISO yyyy-mm-dd. */
export function todayIso(now = new Date()): string {
  return new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Copenhagen' }).format(now);
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

/** Kvartalsmoms deadlines: 1 June, 1 September, 1 December, 1 March of the following year. */
export function vatSettlementDate(year: number, quarter: number): string {
  return [`${year}-06-01`, `${year}-09-01`, `${year}-12-01`, `${year + 1}-03-01`][quarter - 1];
}

/** "2026-Q3" -> { year, quarter }; also accepts "2026-3" and "Q3 2026". */
export function parseQuarter(input: string): { year: number; quarter: number } {
  const s = input.trim();
  const yq = s.match(/^(\d{4})[-\s]?Q?([1-4])$/i);
  if (yq) return { year: Number(yq[1]), quarter: Number(yq[2]) };
  const qy = s.match(/^Q([1-4])[-\s]+(\d{4})$/i);
  if (qy) return { year: Number(qy[2]), quarter: Number(qy[1]) };
  throw new Error(`Quarter must look like "2026-Q3" (got "${input}")`);
}

export function isIsoDate(s: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const [y, m, d] = s.split('-').map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d;
}

export function daysBetween(fromIso: string, toIso: string): number {
  return Math.round((Date.parse(toIso) - Date.parse(fromIso)) / 86400000);
}
