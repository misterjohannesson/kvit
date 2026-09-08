import { fail } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { countRows } from '$lib/server/db';
import { account, auditLog, cashMovement, customer, expense, invoice, invoiceAttachment, invoiceLine } from '$lib/server/schema';
import fs from 'node:fs';
import path from 'node:path';
import { FILES_DIR } from '$lib/server/env';
import { errorMessage } from '$lib/server/api';
import { badRequest } from '$lib/server/errors';
import { applyRestore, discardStaged, getStaged, RESTORE_MAX_BYTES, stageRestore } from '$lib/server/services/restore';

function countFiles(dir: string): number {
  if (!fs.existsSync(dir)) return 0;
  return fs.readdirSync(dir, { withFileTypes: true }).reduce((n, d) => n + (d.isDirectory() ? countFiles(path.join(dir, d.name)) : 1), 0);
}

export const load: PageServerLoad = ({ url }) => {
  // A staged upload survives a reload of the page via ?restore=<id>.
  const stagedId = url.searchParams.get('restore');
  let staged = null;
  if (stagedId) {
    try {
      staged = getStaged(stagedId);
    } catch {
      staged = null;
    }
  }
  return {
    counts: {
      invoices: countRows(invoice),
      lines: countRows(invoiceLine),
      attachments: countRows(invoiceAttachment),
      customers: countRows(customer),
      expenses: countRows(expense),
      movements: countRows(cashMovement),
      accounts: countRows(account),
      audit: countRows(auditLog),
      files: countFiles(FILES_DIR)
    },
    staged
  };
};

export const actions: Actions = {
  /** Upload the zip; validation only, then the confirm panel. */
  stage: async ({ request }) => {
    const form = await request.formData();
    try {
      const file = form.get('file');
      if (!(file instanceof File) || file.size === 0) throw badRequest('Vælg den eksport-zip, der skal indlæses');
      if (file.size > RESTORE_MAX_BYTES) throw badRequest('Zippen er større end 512 MB');
      const summary = stageRestore(Buffer.from(await file.arrayBuffer()), file.name);
      return { staged: summary };
    } catch (e) {
      const { status, message } = errorMessage(e);
      return fail(status, { error: message });
    }
  },

  /** The confirmed replacement. */
  apply: async ({ request }) => {
    const form = await request.formData();
    const id = String(form.get('id') ?? '');
    try {
      if (form.get('confirm') !== 'on') throw badRequest('Sæt kryds for at bekræfte, at alle nuværende data erstattes');
      const result = await applyRestore(id);
      return { restored: result };
    } catch (e) {
      const { status, message } = errorMessage(e);
      let staged = null;
      try {
        staged = getStaged(id);
      } catch {
        staged = null;
      }
      return fail(status, { error: message, staged });
    }
  },

  discard: async ({ request }) => {
    const form = await request.formData();
    try {
      discardStaged(String(form.get('id') ?? ''));
      return { discarded: true };
    } catch (e) {
      const { status, message } = errorMessage(e);
      return fail(status, { error: message });
    }
  }
};
