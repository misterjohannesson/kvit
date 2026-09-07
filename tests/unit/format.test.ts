import { describe, expect, it } from 'vitest';
import {
  addDays,
  formatDate,
  formatOre,
  formatQuantity,
  invoiceStatus,
  parseKrToOre,
  parseQuantity,
  quarterOf,
  quarterRange
} from '../../src/lib/format';

describe('money formatting', () => {
  it('formats øre as Danish kroner', () => {
    expect(formatOre(123456)).toBe('1.234,56 kr.');
    expect(formatOre(0)).toBe('0,00 kr.');
    expect(formatOre(5)).toBe('0,05 kr.');
    expect(formatOre(100000000)).toBe('1.000.000,00 kr.');
    expect(formatOre(-925000)).toBe('−9.250,00 kr.');
    expect(formatOre(123456, false)).toBe('1.234,56');
  });

  it('parses Danish and plain decimal input to øre', () => {
    expect(parseKrToOre('1.234,56')).toBe(123456);
    expect(parseKrToOre('1234,56')).toBe(123456);
    expect(parseKrToOre('1234.56')).toBe(123456);
    expect(parseKrToOre('1234')).toBe(123400);
    expect(parseKrToOre('0,5')).toBe(50);
    expect(parseKrToOre('-12,00')).toBe(-1200);
    expect(parseKrToOre('950,00 kr.')).toBe(95000);
    expect(() => parseKrToOre('abc')).toThrow();
    expect(() => parseKrToOre('1,234')).toThrow();
  });

  it('round-trips quantities', () => {
    expect(formatQuantity(42)).toBe('42,00');
    expect(formatQuantity(12.5)).toBe('12,50');
    expect(formatQuantity(-1)).toBe('−1,00');
    expect(parseQuantity('12,5')).toBe(12.5);
    expect(parseQuantity('1.000,25')).toBe(1000.25);
  });
});

describe('dates and quarters', () => {
  it('formats and shifts dates', () => {
    expect(formatDate('2026-09-07')).toBe('07.09.2026');
    expect(formatDate(null)).toBe('—');
    expect(addDays('2026-08-25', 30)).toBe('2026-09-24');
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
  });

  it('computes quarters', () => {
    expect(quarterOf('2026-09-07')).toEqual({ year: 2026, quarter: 3 });
    expect(quarterOf('2026-01-01')).toEqual({ year: 2026, quarter: 1 });
    expect(quarterRange(2026, 2)).toEqual({ from: '2026-04-01', to: '2026-06-30' });
    expect(quarterRange(2026, 4)).toEqual({ from: '2026-10-01', to: '2026-12-31' });
    expect(quarterRange(2028, 1)).toEqual({ from: '2028-01-01', to: '2028-03-31' });
  });
});

describe('invoice status', () => {
  const today = '2026-09-07';
  it('derives the five badge states plus credit note', () => {
    expect(invoiceStatus({ status: 'draft', dueDate: '2026-01-01', paidDate: null }, today).label).toBe('Kladde');
    expect(invoiceStatus({ status: 'credited', dueDate: '2026-01-01', paidDate: null }, today).label).toBe('Krediteret');
    expect(invoiceStatus({ status: 'issued', dueDate: '2026-01-01', paidDate: '2026-01-05' }, today).label).toBe('Betalt');
    const overdue = invoiceStatus({ status: 'issued', dueDate: '2026-08-17', paidDate: null }, today);
    expect(overdue.label).toBe('Forfalden');
    expect(overdue.overdueDays).toBe(21);
    expect(invoiceStatus({ status: 'issued', dueDate: '2026-09-24', paidDate: null }, today).label).toBe('Åben');
    expect(invoiceStatus({ status: 'issued', dueDate: '2026-09-07', paidDate: null }, today).label).toBe('Åben');
    expect(invoiceStatus({ status: 'issued', dueDate: '2026-01-01', paidDate: null, isCreditNote: true }, today).label).toBe('Kreditnota');
  });
});
