import { error, fail, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import {
  creditInvoice,
  deleteDraft,
  getInvoice,
  issueInvoice,
  nextInvoiceNumber,
  setPaidDate,
  updateDraft,
  validateForIssue
} from '$lib/server/services/invoices';
import { listCustomers } from '$lib/server/services/customers';
import { getSettings } from '$lib/server/services/settings';
import { listAccounts } from '$lib/server/services/accounts';
import { errorMessage, expectedNumberFrom, isRedirect, routeId } from '$lib/server/api';
import { formDataToDraft } from '$lib/server/invoice-form';
import { HttpError } from '$lib/server/errors';
import { parseDateInput, todayIso } from '$lib/format';

export const load: PageServerLoad = ({ params }) => {
  try {
    const inv = getInvoice(routeId(params));
    const settings = getSettings();
    return {
      today: todayIso(),
      invoice: inv,
      customers: listCustomers(),
      accounts: listAccounts(),
      nextNumber: nextInvoiceNumber(),
      problems: inv.status === 'draft' ? validateForIssue(inv, settings) : []
    };
  } catch (e) {
    if (e instanceof HttpError) error(e.status, e.message);
    throw e;
  }
};

async function run(fn: () => Promise<unknown> | unknown) {
  try {
    await fn();
  } catch (e) {
    if (isRedirect(e)) throw e;
    const { status, message } = errorMessage(e);
    const fields = e instanceof HttpError && Object.keys(e.fields).length ? e.fields : undefined;
    return fail(status, { error: message, fields });
  }
  return { ok: true };
}

export const actions: Actions = {
  save: async ({ params, request }) =>
    run(async () => {
      await updateDraft(routeId(params), formDataToDraft(await request.formData()));
    }),

  /** Saves the form, then issues with the number the user confirmed in the dialog. */
  issue: async ({ params, request }) =>
    run(async () => {
      const invoiceId = routeId(params);
      const form = await request.formData();
      await updateDraft(invoiceId, formDataToDraft(form));
      await issueInvoice(invoiceId, expectedNumberFrom(form.get('expectedNumber')));
      redirect(303, `/fakturaer/${invoiceId}?udstedt=1`);
    }),

  delete: async ({ params }) =>
    run(async () => {
      await deleteDraft(routeId(params));
      redirect(303, '/fakturaer');
    }),

  paid: async ({ params, request }) =>
    run(async () => {
      const form = await request.formData();
      const raw = String(form.get('paidDate') ?? '').trim();
      let paidDate = todayIso();
      if (raw) {
        try {
          paidDate = parseDateInput(raw);
        } catch {
          throw new HttpError(400, 'Betalingsdato: ugyldig dato – brug dd.mm.åååå', { paidDate: 'Ugyldig dato' });
        }
      }
      setPaidDate(routeId(params), paidDate);
    }),

  credit: async ({ params, request }) =>
    run(async () => {
      const form = await request.formData();
      const note = await creditInvoice(routeId(params), expectedNumberFrom(form.get('expectedNumber')));
      redirect(303, `/fakturaer/${note.id}`);
    })
};
