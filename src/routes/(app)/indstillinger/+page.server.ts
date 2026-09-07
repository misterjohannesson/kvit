import { fail } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { getSettings, updateSettings } from '$lib/server/services/settings';
import { errorMessage } from '$lib/server/api';

export const load: PageServerLoad = () => ({ settings: getSettings() });

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
      await updateSettings(input);
      return { saved: true };
    } catch (e) {
      const { status, message } = errorMessage(e);
      return fail(status, { error: message });
    }
  }
};
