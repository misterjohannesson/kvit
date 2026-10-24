/**
 * The draft editor's time section (client side): rows in print order, an indented entry belongs to the heading above
 * it. The figures here are a preview; the server recomputes them from the stored entries on save.
 */
import { lineTotalOre, parseKrToOre, parseQuantity, roundOre } from './format';

export interface EditorGroup {
  type: 'group';
  key: string;
  description: string;
}

export interface EditorEntry {
  type: 'entry';
  key: string;
  entryId: number;
  indent: boolean;
  date: string;
  minutes: number;
  loggedDescription: string;
  invoicedHours: string;
  invoicedDescription: string;
  rate: string;
  /** The customer's rate when the entry was put on the draft; what a write-up or write-down is measured against. */
  standardRateOre: number | null;
}

export type EditorTimeRow = EditorGroup | EditorEntry;

export interface EntryFigures {
  total: number | null;
  logged: number | null;
  diffHours: number | null;
  diffOre: number | null;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

function tryParse<T>(fn: () => T): T | null {
  try {
    return fn();
  } catch {
    return null;
  }
}

export function entryFigures(e: EditorEntry): EntryFigures {
  const hours = tryParse(() => parseQuantity(e.invoicedHours));
  const rate = e.rate.trim() === '' ? 0 : tryParse(() => parseKrToOre(e.rate));
  const total = hours !== null && hours > 0 && rate !== null ? lineTotalOre(hours, rate) : null;
  const logged = e.standardRateOre === null ? (rate === null ? null : roundOre((e.minutes * rate) / 60)) : roundOre((e.minutes * e.standardRateOre) / 60);
  return {
    total,
    logged,
    diffHours: hours === null ? null : round2(hours - e.minutes / 60),
    diffOre: total === null || logged === null ? null : total - logged
  };
}

export interface GroupFigures {
  entries: number;
  hours: number;
  total: number | null;
  rate: number | null;
  diffHours: number;
  diffOre: number | null;
}

/** The indented entries directly under the heading at index i. */
export function groupMembers(rows: EditorTimeRow[], i: number): EditorEntry[] {
  const out: EditorEntry[] = [];
  for (let j = i + 1; j < rows.length; j++) {
    const r = rows[j];
    if (r.type !== 'entry' || !r.indent) break;
    out.push(r);
  }
  return out;
}

export function groupFigures(rows: EditorTimeRow[], i: number): GroupFigures {
  const members = groupMembers(rows, i);
  const figs = members.map(entryFigures);
  const hours = round2(members.reduce((s, m) => s + (tryParse(() => parseQuantity(m.invoicedHours)) ?? 0), 0));
  const total = figs.some((f) => f.total === null) ? null : figs.reduce((s, f) => s + (f.total ?? 0), 0);
  const logged = figs.some((f) => f.logged === null) ? null : figs.reduce((s, f) => s + (f.logged ?? 0), 0);
  return {
    entries: members.length,
    hours,
    total,
    rate: total === null || hours === 0 ? null : roundOre(total / hours),
    diffHours: round2(figs.reduce((s, f) => s + (f.diffHours ?? 0), 0)),
    diffOre: total === null || logged === null ? null : total - logged
  };
}

/** An indented entry needs a heading above it with only indented entries between; anything else is outdented. */
export function normalize(rows: EditorTimeRow[]): void {
  let open = false;
  for (const r of rows) {
    if (r.type === 'group') open = true;
    else if (!r.indent) open = false;
    else if (!open) r.indent = false;
  }
}

/** What the hidden form field carries. */
export function serialize(rows: EditorTimeRow[]): string {
  return JSON.stringify(
    rows.map((r) =>
      r.type === 'group'
        ? { type: 'group', description: r.description }
        : { type: 'entry', entryId: r.entryId, indent: r.indent, invoicedHours: r.invoicedHours, invoicedDescription: r.invoicedDescription, rate: r.rate }
    )
  );
}

/** Sum of what the time section prints, or null while a row cannot be computed. */
export function timeSubtotal(rows: EditorTimeRow[]): number | null {
  let sum = 0;
  for (const r of rows) {
    if (r.type !== 'entry') continue;
    const t = entryFigures(r).total;
    if (t === null) return null;
    sum += t;
  }
  return sum;
}

/** Problems the editor shows before saving; the server checks the same and more. */
export function timeProblems(rows: EditorTimeRow[]): string[] {
  const problems: string[] = [];
  rows.forEach((r, i) => {
    if (r.type === 'group') {
      if (!r.description.trim()) problems.push(`Overskrift ${i + 1} mangler en tekst`);
      if (groupMembers(rows, i).length === 0) problems.push(`Overskriften »${r.description || i + 1}« har ingen timer under sig`);
      return;
    }
    if (!r.invoicedDescription.trim()) problems.push(`Timelinje ${i + 1} mangler en beskrivelse`);
    const hours = tryParse(() => parseQuantity(r.invoicedHours));
    if (hours === null || hours <= 0) problems.push(`Timelinje ${i + 1}: timer skal være mere end 0`);
    if (r.rate.trim() === '') problems.push(`Timelinje ${i + 1} mangler en timepris`);
    else if (tryParse(() => parseKrToOre(r.rate)) === null) problems.push(`Timelinje ${i + 1}: ugyldig timepris`);
  });
  return problems;
}
