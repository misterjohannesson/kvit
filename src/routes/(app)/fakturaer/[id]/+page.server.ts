import { error, fail, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import {
  creditInvoice,
  deleteDraft,
  getInvoice,
  issueInvoice,
  markSent,
  nextInvoiceNumber,
  setPaidDate,
  updateDraft,
  validateForIssue
} from '$lib/server/services/invoices';
import { addAttachment, removeAttachment } from '$lib/server/services/attachments';
import { uploadFromForm } from '$lib/server/expense-form';
import { listCustomers } from '$lib/server/services/customers';
import { getSettings } from '$lib/server/services/settings';
import { listAccounts, selectableAccounts } from '$lib/server/services/accounts';
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
      revenueAccounts: selectableAccounts('revenue', inv.lines.map((l) => l.accountId)),
      defaultTermsDays: Number(settings.payment_terms_days) || 0,
      nextNumber: nextInvoiceNumber(),
      problems: inv.status === 'draft' ? validateForIssue(inv, settings) : [],
      /** Changes on every load so the draft preview iframe re-renders after a save. */
      previewKey: Date.now()
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
    }),

  /** "Markér som sendt": the date the document went to the customer (defaults to today). */
  sent: async ({ params, request }) =>
    run(async () => {
      const form = await request.formData();
      const raw = String(form.get('sentAt') ?? '').trim();
      let sentAt = todayIso();
      if (raw) {
        try {
          sentAt = parseDateInput(raw);
        } catch {
          throw new HttpError(400, 'Sendt: ugyldig dato – brug dd.mm.åååå', { sentAt: 'Ugyldig dato' });
        }
      }
      markSent(routeId(params), sentAt);
    }),

  /** Append a PDF to the draft (multipart field `file`). */
  attach: async ({ params, request }) =>
    run(async () => {
      const file = await uploadFromForm(await request.formData());
      if (!file) throw new HttpError(400, 'Vælg en PDF-fil at vedhæfte', { file: 'Vælg en fil' });
      await addAttachment(routeId(params), file);
    }),

  detach: async ({ params, request }) =>
    run(async () => {
      const form = await request.formData();
      const aid = Number(form.get('attachmentId'));
      if (!Number.isInteger(aid) || aid <= 0) throw new HttpError(400, 'Ugyldigt bilag');
      await removeAttachment(routeId(params), aid);
    })
};
