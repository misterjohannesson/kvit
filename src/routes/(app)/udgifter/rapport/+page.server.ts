import { fail } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { expenseReport } from '$lib/server/services/finance';
import { listExpenseYears } from '$lib/server/services/expenses';
import { deleteSupplier, listSuppliers, renameSupplier } from '$lib/server/services/suppliers';
import { errorMessage } from '$lib/server/api';
import { badRequest } from '$lib/server/errors';
import { todayIso } from '$lib/format';

export const load: PageServerLoad = ({ url }) => {
  const thisYear = Number(todayIso().slice(0, 4));
  const y = Number(url.searchParams.get('year'));
  const q = url.searchParams.get('quarter');
  const year = Number.isInteger(y) && y >= 2000 && y <= 2100 ? y : thisYear;
  const quarter = q && ['1', '2', '3', '4'].includes(q) ? Number(q) : null;
  const years = [...new Set([thisYear, ...listExpenseYears()])].sort((a, b) => b - a);
  return { year, quarter, years, report: expenseReport(year, quarter), suppliers: listSuppliers() };
};

function idFrom(form: FormData): number {
  const n = Number(String(form.get('id') ?? ''));
  if (!Number.isInteger(n) || n <= 0) throw badRequest('Ugyldig leverandør');
  return n;
}

export const actions: Actions = {
  renameSupplier: async ({ request }) => {
    const form = await request.formData();
    try {
      renameSupplier(idFrom(form), { name: String(form.get('name') ?? '') });
      return { saved: true };
    } catch (e) {
      const { status, message } = errorMessage(e);
      return fail(status, { error: message });
    }
  },
  deleteSupplier: async ({ request }) => {
    const form = await request.formData();
    try {
      deleteSupplier(idFrom(form));
      return { saved: true };
    } catch (e) {
      const { status, message } = errorMessage(e);
      return fail(status, { error: message });
    }
  }
};
