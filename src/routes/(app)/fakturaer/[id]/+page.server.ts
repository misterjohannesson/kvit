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
import { errorMessage } from '$lib/server/api';
import { formDataToDraft } from '$lib/server/invoice-form';
import { HttpError } from '$lib/server/errors';
import { todayIso } from '$lib/format';

function id(params: { id: string }): number {
  const n = Number(params.id);
  if (!Number.isInteger(n) || n <= 0) error(404, 'Faktura findes ikke');
  return n;
}

export const load: PageServerLoad = ({ params }) => {
  try {
    const inv = getInvoice(id(params));
    const settings = getSettings();
    return {
      today: todayIso(),
      invoice: inv,
      customers: listCustomers(),
      nextNumber: nextInvoiceNumber(),
      problems: inv.status === 'draft' ? validateForIssue(inv, settings) : []
    };
  } catch (e) {
    if (e instanceof HttpError) error(e.status, e.message);
    throw e;
  }
};

function isRedirect(e: unknown): boolean {
  return !!e && typeof e === 'object' && 'status' in e && 'location' in e;
}

async function run(fn: () => Promise<unknown> | unknown) {
  try {
    await fn();
  } catch (e) {
    if (isRedirect(e)) throw e;
    const { status, message } = errorMessage(e);
    return fail(status, { error: message });
  }
  return { ok: true };
}

export const actions: Actions = {
  save: async ({ params, request }) =>
    run(async () => {
      updateDraft(id(params), formDataToDraft(await request.formData()));
    }),

  issue: async ({ params, request }) =>
    run(async () => {
      const invoiceId = id(params);
      updateDraft(invoiceId, formDataToDraft(await request.formData()));
      await issueInvoice(invoiceId);
      redirect(303, `/fakturaer/${invoiceId}?udstedt=1`);
    }),

  delete: async ({ params }) =>
    run(() => {
      deleteDraft(id(params));
      redirect(303, '/fakturaer');
    }),

  paid: async ({ params, request }) =>
    run(async () => {
      const form = await request.formData();
      setPaidDate(id(params), String(form.get('paidDate') || todayIso()));
    }),

  unpaid: async ({ params }) =>
    run(() => {
      setPaidDate(id(params), null);
    }),

  credit: async ({ params }) =>
    run(async () => {
      const note = await creditInvoice(id(params));
      redirect(303, `/fakturaer/${note.id}`);
    })
};
