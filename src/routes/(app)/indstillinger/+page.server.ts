import { fail } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { getSettings, updateSettings } from '$lib/server/services/settings';
import { accountUsageMap, createAccount, deleteAccount, listAccounts, updateAccount } from '$lib/server/services/accounts';
import { describeImport, importKontoplan, KONTOPLAN_MAX_BYTES } from '$lib/server/services/accounts-csv';
import { errorMessage } from '$lib/server/api';
import { parseDateInput, parseKrToOre } from '$lib/format';
import { badRequest } from '$lib/server/errors';
import { BALANCE_ACCOUNTS, balanceNameKey, balanceNumberKey } from '$lib/server/services/settings-defaults';

function accountIdFrom(form: FormData): number {
  const n = Number(String(form.get('id') ?? ''));
  if (!Number.isInteger(n) || n <= 0) throw badRequest('Ugyldig konto');
  return n;
}

/** Only the fields the form sent change; `?/renameAccount` sends the name alone. */
function accountPatch(form: FormData): Record<string, string> {
  const patch: Record<string, string> = {};
  for (const k of ['name', 'group', 'archived'] as const) {
    const v = form.get(k);
    if (typeof v === 'string') patch[k] = v;
  }
  return patch;
}

export const load: PageServerLoad = () => {
  const usage = accountUsageMap();
  const accounts = listAccounts().map((a) => ({ ...a, usage: usage.get(a.id) ?? 0 }));
  return {
    settings: getSettings(),
    accounts,
    groups: [...new Set(accounts.map((a) => a.group).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'da')),
    balanceAccounts: BALANCE_ACCOUNTS.map((b) => ({ key: b.key, label: b.label, numberKey: balanceNumberKey(b.key), nameKey: balanceNameKey(b.key) }))
  };
};

export const actions: Actions = {
  save: async ({ request }) => {
    const form = await request.formData();
    const input: Record<string, string> = {};
    for (const key of [
      'company_name', 'company_address', 'company_zip', 'company_city', 'company_cvr',
      'bank_reg', 'bank_account', 'payment_terms_days', 'next_invoice_number',
      ...BALANCE_ACCOUNTS.flatMap((b) => [balanceNumberKey(b.key), balanceNameKey(b.key)])
    ]) {
      const v = form.get(key);
      if (typeof v === 'string') input[key] = v.trim();
    }
    input.vat_registered = form.get('vat_registered') === 'on' ? '1' : '0';
    try {
      const fields: Record<string, string> = {};
      const ob = String(form.get('opening_balance') ?? '').trim();
      try {
        input.opening_balance_ore = String(parseKrToOre(ob));
      } catch {
        fields.opening_balance = ob === '' ? 'Skal udfyldes (0,00 hvis kontoen var tom)' : 'Ugyldigt beløb – brug fx 12.345,67';
      }
      try {
        input.opening_balance_date = parseDateInput(String(form.get('opening_balance_date') ?? ''));
      } catch {
        fields.opening_balance_date = 'Ugyldig dato – brug dd.mm.åååå';
      }
      if (Object.keys(fields).length) throw badRequest('Åbningssaldo: ret de markerede felter', fields);
      await updateSettings(input);
      return { saved: true };
    } catch (e) {
      const { status, message } = errorMessage(e);
      const fields = e instanceof Error && 'fields' in e ? (e as { fields: Record<string, string> }).fields : undefined;
      return fail(status, { error: message, fields: fields && Object.keys(fields).length ? fields : undefined });
    }
  },

  addAccount: async ({ request }) => {
    const form = await request.formData();
    try {
      createAccount({
        number: String(form.get('number') ?? ''),
        name: String(form.get('name') ?? ''),
        type: String(form.get('type') ?? ''),
        group: String(form.get('group') ?? '')
      });
      return { saved: true };
    } catch (e) {
      const { status, message } = errorMessage(e);
      return fail(status, { error: message });
    }
  },

  /** Name, group and archived from the row form. */
  updateAccount: async ({ request }) => {
    const form = await request.formData();
    try {
      updateAccount(accountIdFrom(form), accountPatch(form));
      return { saved: true };
    } catch (e) {
      const { status, message } = errorMessage(e);
      return fail(status, { error: message });
    }
  },

  /** Kept for older forms and scripts: same as updateAccount with the name only. */
  renameAccount: async ({ request }) => {
    const form = await request.formData();
    try {
      updateAccount(accountIdFrom(form), { name: String(form.get('name') ?? '') });
      return { saved: true };
    } catch (e) {
      const { status, message } = errorMessage(e);
      return fail(status, { error: message });
    }
  },

  deleteAccount: async ({ request }) => {
    const form = await request.formData();
    try {
      deleteAccount(accountIdFrom(form));
      return { saved: true };
    } catch (e) {
      const { status, message } = errorMessage(e);
      return fail(status, { error: message });
    }
  },

  /** Upload kontoplan.csv; atomic, so an error leaves the kontoplan as it was. */
  importAccounts: async ({ request }) => {
    const form = await request.formData();
    try {
      const file = form.get('file');
      if (!(file instanceof File) || file.size === 0) throw badRequest('Vælg den CSV-fil, du har redigeret');
      if (file.size > KONTOPLAN_MAX_BYTES) throw badRequest('Filen er for stor til at være en kontoplan (maks. 256 KB)');
      const text = Buffer.from(await file.arrayBuffer()).toString('utf8');
      const result = importKontoplan(text, { prune: form.get('prune') === 'on' });
      return { imported: describeImport(result) };
    } catch (e) {
      const { status, message } = errorMessage(e);
      return fail(status, { error: message });
    }
  }
};
