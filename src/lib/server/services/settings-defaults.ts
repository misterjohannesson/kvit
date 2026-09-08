/**
 * Balance accounts the derived journal (posteringer.csv) posts against. The app keeps no balance postings of its own;
 * these numbers only label the export so the accountant's system receives balanced entries. Every one is editable
 * under Indstillinger.
 */
export const BALANCE_ACCOUNTS = [
  { key: 'bank', label: 'Bank (likvider)', number: '5820', name: 'Bank' },
  { key: 'debitorer', label: 'Debitorer (åbne fakturaer)', number: '5600', name: 'Debitorer' },
  { key: 'kreditorer', label: 'Kreditorer (ubetalte udgifter)', number: '6800', name: 'Kreditorer' },
  { key: 'salgsmoms', label: 'Salgsmoms (udgående)', number: '6902', name: 'Udgående moms' },
  { key: 'koebsmoms', label: 'Købsmoms (indgående)', number: '6903', name: 'Indgående moms' },
  { key: 'momsafregning', label: 'Momsafregning (bevægelser af typen moms)', number: '6905', name: 'Momsafregning' },
  { key: 'skat', label: 'Skat (bevægelser af typen skat)', number: '6910', name: 'Skat og AM-bidrag' },
  { key: 'ejer', label: 'Ejer (bevægelser af typen ejer)', number: '6960', name: 'Mellemregning med ejer' },
  { key: 'oevrige', label: 'Øvrige bankbevægelser (typen andet)', number: '6980', name: 'Øvrige bankbevægelser' },
  { key: 'afstemning', label: 'Afstemningsdifferencer (typen korrektion)', number: '6990', name: 'Afstemningsdifferencer' },
  { key: 'egenkapital', label: 'Egenkapital (modpost til åbningssaldoen)', number: '8000', name: 'Egenkapital primo' }
] as const;

export type BalanceAccountKey = (typeof BALANCE_ACCOUNTS)[number]['key'];

export const balanceNumberKey = (k: BalanceAccountKey) => `bal_${k}_number` as const;
export const balanceNameKey = (k: BalanceAccountKey) => `bal_${k}_name` as const;

export const DEFAULT_SETTINGS: Record<string, string> = {
  company_name: '',
  company_address: '',
  company_zip: '',
  company_city: '',
  company_cvr: '',
  bank_reg: '',
  bank_account: '',
  payment_terms_days: '14',
  next_invoice_number: '1001',
  vat_registered: '1',
  /** Bank balance the cash views count from, in øre, as of opening_balance_date. */
  opening_balance_ore: '0',
  opening_balance_date: '2026-01-01',
  ...Object.fromEntries(BALANCE_ACCOUNTS.flatMap((b) => [[balanceNumberKey(b.key), b.number], [balanceNameKey(b.key), b.name]]))
};

export const SETTING_KEYS = Object.keys(DEFAULT_SETTINGS);
