import { describe, expect, it } from 'vitest';
import {
  addDays,
  formatCvr,
  formatDate,
  formatMonth,
  formatOre,
  formatQuantity,
  invoiceStatus,
  monthOf,
  nextMonth,
  parseDateInput,
  parseKrToOre,
  parseQuantity,
  quarterOf,
  quarterRange,
  roundOre,
  todayIso,
  vatSettlementDate
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
    expect(parseKrToOre('1.000')).toBe(100000);
    expect(parseKrToOre('12.345.678')).toBe(1234567800);
    expect(parseKrToOre('0,5')).toBe(50);
    expect(parseKrToOre('-12,00')).toBe(-1200);
    expect(parseKrToOre('950,00 kr.')).toBe(95000);
    expect(() => parseKrToOre('abc')).toThrow();
    expect(() => parseKrToOre('1,234')).toThrow();
  });

  it('rounds half away from zero so credit notes negate exactly', () => {
    expect(roundOre(2500.5)).toBe(2501);
    expect(roundOre(-2500.5)).toBe(-2501);
    expect(roundOre(-2500.4)).toBe(-2500);
    for (const n of [0.5, 1.5, 2.5, 10002 / 4, 12.499, 1234.5]) expect(roundOre(-n)).toBe(-roundOre(n));
  });

  it('round-trips quantities at two decimals', () => {
    expect(formatQuantity(42)).toBe('42,00');
    expect(formatQuantity(12.5)).toBe('12,50');
    expect(formatQuantity(-1)).toBe('−1,00');
    expect(parseQuantity('12,5')).toBe(12.5);
    expect(parseQuantity('1.000,25')).toBe(1000.25);
    expect(parseQuantity('1,005')).toBe(1.01);
  });
});

describe('dates and quarters', () => {
  it('formats and shifts dates', () => {
    expect(formatDate('2026-09-07')).toBe('07.09.2026');
    expect(formatDate(null)).toBe('—');
    expect(addDays('2026-08-25', 30)).toBe('2026-09-24');
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
  });

  it('knows months and the quarterly VAT settlement deadlines', () => {
    expect(monthOf('2026-09-08')).toBe('2026-09');
    expect(nextMonth('2026-12')).toBe('2027-01');
    expect(formatMonth('2026-09')).toBe('sep 2026');
    expect(vatSettlementDate(2026, 1)).toBe('2026-06-01');
    expect(vatSettlementDate(2026, 2)).toBe('2026-09-01');
    expect(vatSettlementDate(2026, 3)).toBe('2026-12-01');
    expect(vatSettlementDate(2026, 4)).toBe('2027-03-01');
  });

  it('parses Danish and ISO date input', () => {
    expect(parseDateInput('07.09.2026')).toBe('2026-09-07');
    expect(parseDateInput('7.9.2026')).toBe('2026-09-07');
    expect(parseDateInput('2026-09-07')).toBe('2026-09-07');
    expect(() => parseDateInput('31.02.2026')).toThrow();
    expect(() => parseDateInput('09/07/2026')).toThrow();
    expect(() => parseDateInput('')).toThrow();
  });

  it('uses the Copenhagen calendar day, not UTC', () => {
    // 23:30 UTC on 7 Sep is already 8 Sep in Copenhagen (CEST, UTC+2).
    expect(todayIso(new Date('2026-09-07T23:30:00Z'))).toBe('2026-09-08');
    // 23:30 UTC on 31 Dec is 00:30 on 1 Jan in Copenhagen (CET, UTC+1).
    expect(todayIso(new Date('2026-12-31T23:30:00Z'))).toBe('2027-01-01');
    expect(todayIso(new Date('2026-09-07T12:00:00Z'))).toBe('2026-09-07');
  });

  it('computes quarters', () => {
    expect(quarterOf('2026-09-07')).toEqual({ year: 2026, quarter: 3 });
    expect(quarterOf('2026-01-01')).toEqual({ year: 2026, quarter: 1 });
    expect(quarterRange(2026, 2)).toEqual({ from: '2026-04-01', to: '2026-06-30' });
    expect(quarterRange(2026, 4)).toEqual({ from: '2026-10-01', to: '2026-12-31' });
    expect(quarterRange(2028, 1)).toEqual({ from: '2028-01-01', to: '2028-03-31' });
  });

  it('groups CVR numbers', () => {
    expect(formatCvr('12345678')).toBe('12 34 56 78');
    expect(formatCvr(null)).toBe('');
  });
});

describe('invoice status', () => {
  const today = '2026-09-07';
  it('derives the five badge states plus the credit-note document', () => {
    expect(invoiceStatus({ status: 'draft', dueDate: '2026-01-01', paidDate: null }, today).label).toBe('Kladde');
    expect(invoiceStatus({ status: 'credited', dueDate: '2026-01-01', paidDate: null }, today).label).toBe('Krediteret');
    expect(invoiceStatus({ status: 'issued', dueDate: '2026-01-01', paidDate: '2026-01-05' }, today).label).toBe('Betalt');
    const overdue = invoiceStatus({ status: 'issued', dueDate: '2026-08-17', paidDate: null }, today);
    expect(overdue.label).toBe('Forfalden');
    expect(overdue.overdueDays).toBe(21);
    expect(invoiceStatus({ status: 'issued', dueDate: '2026-09-24', paidDate: null }, today).label).toBe('Åben');
    expect(invoiceStatus({ status: 'issued', dueDate: '2026-09-07', paidDate: null }, today).label).toBe('Åben');
    const cn = invoiceStatus({ status: 'issued', dueDate: '2026-01-01', paidDate: null, isCreditNote: true }, today);
    expect(cn.label).toBe('Kreditnota');
    expect(cn.cls).toBe('badge--kreditnota');
  });
});
