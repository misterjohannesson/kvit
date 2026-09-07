import { fail } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { getSettings, updateSettings } from '$lib/server/services/settings';
import { accountUsage, createAccount, deleteAccount, listAccounts, renameAccount } from '$lib/server/services/accounts';
import { errorMessage } from '$lib/server/api';
import { parseDateInput, parseKrToOre } from '$lib/format';
import { badRequest } from '$lib/server/errors';

export const load: PageServerLoad = () => ({
  settings: getSettings(),
  accounts: listAccounts().map((a) => ({ ...a, usage: accountUsage(a.id) }))
});

export const actions: Actions = {
  save: async ({ request }) => {
    const form = await request.formData();
    const input: Record<string, string> = {};
    for (const key of [
      'company_name', 'company_address', 'company_zip', 'company_city', 'company_cvr',
      'bank_reg', 'bank_account', 'payment_terms_days', 'next_invoice_number'
    ]) {
      input[key] = String(form.get(key) ?? '').trim();
    }
    input.vat_registered = form.get('vat_registered') === 'on' ? '1' : '0';
    try {
      const fields: Record<string, string> = {};
      const ob = String(form.get('opening_balance') ?? '').trim();
      try {
        input.opening_balance_ore = String(parseKrToOre(ob || '0'));
      } catch {
        fields.opening_balance = 'Ugyldigt beløb – brug fx 12.345,67';
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
      createAccount({ number: String(form.get('number') ?? ''), name: String(form.get('name') ?? ''), type: String(form.get('type') ?? '') });
      return { saved: true };
    } catch (e) {
      const { status, message } = errorMessage(e);
      return fail(status, { error: message });
    }
  },

  renameAccount: async ({ request }) => {
    const form = await request.formData();
    try {
      renameAccount(Number(form.get('id')), { name: String(form.get('name') ?? '') });
      return { saved: true };
    } catch (e) {
      const { status, message } = errorMessage(e);
      return fail(status, { error: message });
    }
  },

  deleteAccount: async ({ request }) => {
    const form = await request.formData();
    try {
      deleteAccount(Number(form.get('id')));
      return { saved: true };
    } catch (e) {
      const { status, message } = errorMessage(e);
      return fail(status, { error: message });
    }
  }
};
