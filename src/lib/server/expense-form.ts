import { parseDateInput, parseKrToOre } from '../format';
import { badRequest } from './errors';
import type { UploadFile } from './services/expenses';

export const MAX_UPLOAD_BYTES = 20 * 1024 * 1024;

const LABELS: Record<string, string> = {
  date: 'Dato',
  supplier: 'Leverandør',
  description: 'Beskrivelse',
  category: 'Kategori',
  amountExVat: 'Beløb ekskl. moms',
  vat: 'Moms',
  paidDate: 'Betalt'
};

/**
 * Shared by the API (multipart) and the form actions: form fields -> service input.
 * Errors carry the offending field so the form can mark it (style.md §4).
 */
export function formDataToExpense(form: FormData) {
  const str = (k: string) => String(form.get(k) ?? '').trim();
  const fail = (field: string, msg: string) => badRequest(`${LABELS[field]}: ${msg}`, { [field]: msg });
  const money = (k: string) => {
    const v = str(k);
    if (v === '') throw fail(k, 'Skal udfyldes');
    try {
      return parseKrToOre(v);
    } catch {
      throw fail(k, 'Ugyldigt beløb – brug fx 1.234,56');
    }
  };
  const date = (k: string, required: boolean) => {
    const v = str(k);
    if (v === '') {
      if (required) throw fail(k, 'Skal udfyldes');
      return null;
    }
    try {
      return parseDateInput(v);
    } catch {
      throw fail(k, 'Ugyldig dato – brug dd.mm.åååå');
    }
  };
  for (const k of ['supplier', 'description', 'category']) {
    if (str(k) === '') throw fail(k, 'Skal udfyldes');
  }
  return {
    date: date('date', true) as string,
    supplier: str('supplier'),
    description: str('description'),
    category: str('category'),
    amountExVatOre: money('amountExVat'),
    vatOre: money('vat'),
    paidDate: date('paidDate', false)
  };
}

export async function uploadFromForm(form: FormData, field = 'file'): Promise<UploadFile | null> {
  const f = form.get(field);
  if (!(f instanceof File) || f.size === 0) return null;
  if (f.size > MAX_UPLOAD_BYTES) throw badRequest('Filen er for stor (maks. 20 MB)', { [field]: 'Maks. 20 MB' });
  return { name: f.name, type: f.type, bytes: Buffer.from(await f.arrayBuffer()) };
}

/** Keep the user's typed values when re-rendering a failed form. */
export function formValues(form: FormData): Record<string, string> {
  const values: Record<string, string> = {};
  for (const [k, v] of form.entries()) if (typeof v === 'string') values[k] = v;
  return values;
}
