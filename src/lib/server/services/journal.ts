/**
 * The derived journal: every invoice, payment, expense and bank movement rendered as balanced debit/credit lines
 * against the kontoplan plus the balance accounts named under Indstillinger. Nothing here is stored; it is computed
 * from the source records at export time so the accountant's system can import posteringer.csv instead of re-keying.
 *
 * Postings per event (positive = debit):
 *   åbningssaldo   Bank +saldo / Egenkapital −saldo
 *   faktura        Debitorer +total / salgskonto −linje … / Salgsmoms −moms      (kreditnota: same lines, negative totals)
 *   indbetaling    Bank +total / Debitorer −total                                 (refusion for a paid credit note)
 *   udgift         omkostningskonto +ekskl. / Købsmoms +moms / Kreditorer −inkl.
 *   betaling       Kreditorer +inkl. / Bank −inkl.
 *   bankbevægelse  Bank +beløb / modkonto efter type −beløb
 * The quarterly transfer of salgsmoms and købsmoms to momsafregning is left to the accountant.
 */
import { asc, inArray } from 'drizzle-orm';
import { db } from '../db';
import { account, cashMovement, customer, expense, invoice, invoiceLine, type CashMovement } from '../schema';
import { getSettings } from './settings';
import { BALANCE_ACCOUNTS, balanceNameKey, balanceNumberKey, type BalanceAccountKey } from './settings-defaults';
import { oreToCsv, toCsv } from '../../csv';

export type JournalType = 'åbningssaldo' | 'faktura' | 'kreditnota' | 'indbetaling' | 'refusion' | 'udgift' | 'betaling' | 'bankbevægelse';

export interface JournalLine {
  date: string;
  /** Sequential per event after sorting; the lines of one event share it and sum to zero. */
  entry: number;
  type: JournalType;
  voucher: string;
  text: string;
  accountNumber: number;
  accountName: string;
  debitOre: number;
  creditOre: number;
}

interface Posting {
  accountNumber: number;
  accountName: string;
  /** Signed: positive debit, negative credit. */
  amountOre: number;
}

interface Event {
  date: string;
  type: JournalType;
  voucher: string;
  sortKey: number;
  text: string;
  postings: Posting[];
}

const TYPE_ORDER: Record<JournalType, number> = { åbningssaldo: 0, faktura: 1, kreditnota: 2, udgift: 3, indbetaling: 4, refusion: 5, betaling: 6, bankbevægelse: 7 };

const MOVEMENT_COUNTER: Record<CashMovement['kind'], BalanceAccountKey> = {
  vat_payment: 'momsafregning',
  owner: 'ejer',
  tax: 'skat',
  correction: 'afstemning',
  other: 'oevrige'
};

export function journalEvents(): Event[] {
  const s = getSettings();
  const bal = (key: BalanceAccountKey): Pick<Posting, 'accountNumber' | 'accountName'> => ({
    accountNumber: Number(s[balanceNumberKey(key)]) || Number(BALANCE_ACCOUNTS.find((b) => b.key === key)!.number),
    accountName: s[balanceNameKey(key)] || BALANCE_ACCOUNTS.find((b) => b.key === key)!.name
  });
  const accounts = new Map(db.select().from(account).all().map((a) => [a.id, a]));
  const customers = new Map(db.select().from(customer).all().map((c) => [c.id, c.name]));
  const events: Event[] = [];

  const opening = Number(s.opening_balance_ore) || 0;
  if (opening !== 0) {
    events.push({
      date: s.opening_balance_date,
      type: 'åbningssaldo',
      voucher: '',
      sortKey: 0,
      text: 'Åbningssaldo bank',
      postings: [{ ...bal('bank'), amountOre: opening }, { ...bal('egenkapital'), amountOre: -opening }]
    });
  }

  const issued = db.select().from(invoice).where(inArray(invoice.status, ['issued', 'credited'])).orderBy(asc(invoice.invoiceNumber)).all();
  const linesByInvoice = new Map<number, { accountId: number; lineTotalOre: number }[]>();
  for (const l of db.select().from(invoiceLine).orderBy(asc(invoiceLine.id)).all()) {
    linesByInvoice.set(l.invoiceId, [...(linesByInvoice.get(l.invoiceId) ?? []), l]);
  }
  for (const inv of issued) {
    const number = inv.invoiceNumber ?? 0;
    const isCredit = inv.totalOre < 0;
    const who = customers.get(inv.customerId) ?? '';
    const label = `${isCredit ? 'Kreditnota' : 'Faktura'} ${number}${who ? ` – ${who}` : ''}`;
    const postings: Posting[] = [{ ...bal('debitorer'), amountOre: inv.totalOre }];
    for (const l of linesByInvoice.get(inv.id) ?? []) {
      const a = accounts.get(l.accountId);
      postings.push({ accountNumber: a?.number ?? 0, accountName: a?.name ?? '', amountOre: -l.lineTotalOre });
    }
    if (inv.vatOre !== 0) postings.push({ ...bal('salgsmoms'), amountOre: -inv.vatOre });
    events.push({ date: inv.issueDate, type: isCredit ? 'kreditnota' : 'faktura', voucher: String(number), sortKey: number, text: label, postings });
    if (inv.paidDate) {
      events.push({
        date: inv.paidDate,
        type: isCredit ? 'refusion' : 'indbetaling',
        voucher: String(number),
        sortKey: number,
        text: `${isCredit ? 'Refusion' : 'Betaling'} ${label.charAt(0).toLowerCase()}${label.slice(1)}`,
        postings: [{ ...bal('bank'), amountOre: inv.totalOre }, { ...bal('debitorer'), amountOre: -inv.totalOre }]
      });
    }
  }

  for (const e of db.select().from(expense).orderBy(asc(expense.voucherNumber)).all()) {
    const a = accounts.get(e.accountId);
    const text = `${e.supplier} – ${e.description}`;
    const postings: Posting[] = [{ accountNumber: a?.number ?? 0, accountName: a?.name ?? '', amountOre: e.amountExVatOre }];
    if (e.vatOre !== 0) postings.push({ ...bal('koebsmoms'), amountOre: e.vatOre });
    postings.push({ ...bal('kreditorer'), amountOre: -e.amountInclOre });
    events.push({ date: e.date, type: 'udgift', voucher: String(e.voucherNumber), sortKey: e.voucherNumber, text, postings });
    if (e.paidDate) {
      events.push({
        date: e.paidDate,
        type: 'betaling',
        voucher: String(e.voucherNumber),
        sortKey: e.voucherNumber,
        text: `Betaling bilag ${e.voucherNumber} – ${e.supplier}`,
        postings: [{ ...bal('kreditorer'), amountOre: e.amountInclOre }, { ...bal('bank'), amountOre: -e.amountInclOre }]
      });
    }
  }

  for (const m of db.select().from(cashMovement).orderBy(asc(cashMovement.id)).all()) {
    events.push({
      date: m.date,
      type: 'bankbevægelse',
      voucher: `B${m.id}`,
      sortKey: m.id,
      text: m.description,
      postings: [{ ...bal('bank'), amountOre: m.amountOre }, { ...bal(MOVEMENT_COUNTER[m.kind]), amountOre: -m.amountOre }]
    });
  }

  events.sort((x, y) => x.date.localeCompare(y.date) || TYPE_ORDER[x.type] - TYPE_ORDER[y.type] || x.sortKey - y.sortKey);
  return events;
}

export function journalLines(): JournalLine[] {
  const lines: JournalLine[] = [];
  let entry = 0;
  for (const ev of journalEvents()) {
    entry += 1;
    for (const p of ev.postings) {
      if (p.amountOre === 0) continue;
      lines.push({
        date: ev.date,
        entry,
        type: ev.type,
        voucher: ev.voucher,
        text: ev.text,
        accountNumber: p.accountNumber,
        accountName: p.accountName,
        debitOre: p.amountOre > 0 ? p.amountOre : 0,
        creditOre: p.amountOre < 0 ? -p.amountOre : 0
      });
    }
  }
  return lines;
}

/** posteringer.csv: one row per posting line, Danish decimal comma, every `postering` balancing to zero. */
export function journalCsv(): string {
  return toCsv(
    ['dato', 'postering', 'bilagstype', 'bilagsnr', 'tekst', 'konto', 'kontonavn', 'debet', 'kredit'],
    journalLines().map((l) => [l.date, l.entry, l.type, l.voucher, l.text, l.accountNumber, l.accountName, oreToCsv(l.debitOre), oreToCsv(l.creditOre)])
  );
}
