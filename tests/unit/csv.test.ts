import { describe, expect, it } from 'vitest';
import { detectDelimiter, parseCsv } from '../../src/lib/csv';

describe('parseCsv', () => {
  it('reads a BOM + CRLF file the way the export writes it', () => {
    const text = '﻿kontonr;navn;type\r\n1000;Konsulentydelser;salg\r\n2900;"Øvrige; diverse";omkostning\r\n';
    const { delimiter, rows } = parseCsv(text);
    expect(delimiter).toBe(';');
    expect(rows.map((r) => r.cells)).toEqual([
      ['kontonr', 'navn', 'type'],
      ['1000', 'Konsulentydelser', 'salg'],
      ['2900', 'Øvrige; diverse', 'omkostning']
    ]);
    expect(rows.map((r) => r.line)).toEqual([1, 2, 3]);
  });

  it('detects comma and tab delimiters from the header and keeps doubled quotes and embedded newlines', () => {
    expect(detectDelimiter('a,b,c')).toBe(',');
    expect(detectDelimiter('a\tb\tc')).toBe('\t');
    expect(detectDelimiter('a')).toBe(';');
    const { rows } = parseCsv('n,name\n1,"He said ""hi""\nand left"\n2,x');
    expect(rows[1].cells).toEqual(['1', 'He said "hi"\nand left']);
    expect(rows[2]).toEqual({ line: 4, cells: ['2', 'x'] });
  });

  it('skips blank lines and reports an unterminated quote with its line number', () => {
    const { rows } = parseCsv('a;b\n\n1;2\n   \n3;4');
    expect(rows.map((r) => r.cells)).toEqual([['a', 'b'], ['1', '2'], ['3', '4']]);
    expect(rows[2].line).toBe(5);
    expect(() => parseCsv('a;b\n1;"open')).toThrow(/Linje 2/);
  });
});
