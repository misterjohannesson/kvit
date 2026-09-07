/**
 * Seed: owner settings. Extended slice by slice (customers, invoices, expenses).
 *
 * Usage: DATA_DIR=/data APP_PASSWORD=... npm run seed
 */
import { updateSettings } from '../src/lib/server/services/settings';

export const SEED = {
  settings: {
    company_name: 'Mit Firma ApS',
    company_address: 'Eksempelvej 1',
    company_zip: '2100',
    company_city: 'København Ø',
    company_cvr: '12345678',
    bank_reg: '1234',
    bank_account: '1234567890',
    payment_terms_days: 14,
    next_invoice_number: 1001,
    vat_registered: '1'
  }
};

export async function seed(): Promise<void> {
  await updateSettings(SEED.settings);
}

const isMain = process.argv[1]?.replace(/\/g, '/').endsWith('scripts/seed.ts');
if (isMain) {
  seed()
    .then(() => {
      console.log('Seed gennemført: indstillinger.');
      process.exit(0);
    })
    .catch((e) => {
      console.error(e.message ?? e);
      process.exit(1);
    });
}
