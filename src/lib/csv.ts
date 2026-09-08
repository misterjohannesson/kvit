/**
 * Small CSV reader for files people edit in a spreadsheet: BOM tolerant, `;` / `,` / tab delimited (detected from the
 * header line), quoted cells with doubled quotes, CRLF or LF. Returns rows of raw strings; blank lines are skipped.
 */
export interface ParsedCsv {
  delimiter: string;
  /** Row 0 is the header. Each row keeps its 1-based line number for error messages. */
  rows: { line: number; cells: string[] }[];
}

export function detectDelimiter(headerLine: string): string {
  const counts: [string, number][] = [';', ',', '\t'].map((d) => [d, headerLine.split(d).length - 1]);
  counts.sort((a, b) => b[1] - a[1]);
  return counts[0][1] > 0 ? counts[0][0] : ';';
}

export function parseCsv(text: string): ParsedCsv {
  const src = text.replace(/^﻿/, '');
  const firstLineEnd = src.search(/\r?\n/);
  const delimiter = detectDelimiter(firstLineEnd === -1 ? src : src.slice(0, firstLineEnd));

  const rows: ParsedCsv['rows'] = [];
  let cells: string[] = [];
  let cell = '';
  let quoted = false;
  let line = 1;
  let rowStartLine = 1;

  const endRow = () => {
    cells.push(cell);
    if (cells.some((c) => c.trim() !== '')) rows.push({ line: rowStartLine, cells });
    cells = [];
    cell = '';
    rowStartLine = line;
  };

  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (quoted) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          cell += '"';
          i++;
        } else quoted = false;
      } else {
        if (ch === '\n') line++;
        cell += ch;
      }
      continue;
    }
    if (ch === '"') {
      quoted = true;
    } else if (ch === delimiter) {
      cells.push(cell);
      cell = '';
    } else if (ch === '\r') {
      // Part of CRLF (the LF ends the row) or a stray CR (ends the row itself).
      if (src[i + 1] !== '\n') {
        line++;
        endRow();
      }
    } else if (ch === '\n') {
      line++;
      endRow();
    } else {
      cell += ch;
    }
  }
  if (quoted) throw new Error(`Linje ${rowStartLine}: et citationstegn er ikke afsluttet`);
  if (cell !== '' || cells.length) endRow();
  return { delimiter, rows };
}

// ---------------------------------------------------------------------------------------------------------------
// Writing: the export's dialect (UTF-8 with BOM, `;`, CRLF, Danish decimal comma, quotes only where needed).

const BOM = String.fromCharCode(0xfeff);

export function csvCell(v: unknown): string {
  if (v === null || v === undefined) return '';
  const s = String(v);
  if (/[";\r\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

/** Integer øre -> "1234,56" (Danish decimal comma, no thousands separator). */
export function oreToCsv(ore: number): string {
  const neg = ore < 0;
  const abs = Math.abs(ore);
  return `${neg ? '-' : ''}${Math.floor(abs / 100)},${String(abs % 100).padStart(2, '0')}`;
}

export function decimalToCsv(n: number): string {
  return String(n).replace('.', ',');
}

export function toCsv(header: string[], rows: unknown[][]): string {
  const lines = [header.map(csvCell).join(';'), ...rows.map((r) => r.map(csvCell).join(';'))];
  return BOM + lines.join('\r\n') + '\r\n';
}
