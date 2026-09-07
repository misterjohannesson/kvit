import fs from 'node:fs';
import path from 'node:path';
import type { RequestHandler } from './$types';
import { api, errorResponse, idParam } from '$lib/server/api';
import { expenseFileAbsolutePath, getExpense, uploadExpenseFile } from '$lib/server/services/expenses';
import { notFound, badRequest } from '$lib/server/errors';
import { uploadFromForm } from '$lib/server/expense-form';

const MIME: Record<string, string> = { '.pdf': 'application/pdf', '.jpg': 'image/jpeg', '.png': 'image/png' };

/** Stored voucher file, served inline. */
export const GET: RequestHandler = (event) => {
  try {
    const e = getExpense(idParam(event));
    const abs = expenseFileAbsolutePath(e);
    if (!abs || !fs.existsSync(abs)) throw notFound('Ingen fil på bilaget');
    const ext = path.extname(abs).toLowerCase();
    return new Response(fs.readFileSync(abs), {
      headers: {
        'Content-Type': MIME[ext] ?? 'application/octet-stream',
        'Content-Disposition': `inline; filename="bilag-${e.voucherNumber}${ext}"`
      }
    });
  } catch (err) {
    return errorResponse(err);
  }
};

/** multipart/form-data with `file`. */
export const POST: RequestHandler = (event) =>
  api(async () => {
    const form = await event.request.formData();
    const file = await uploadFromForm(form);
    if (!file) throw badRequest('Ingen fil valgt');
    return uploadExpenseFile(idParam(event), file);
  });
