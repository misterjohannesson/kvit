import { parseKrToOre } from '../format';
import { badRequest } from './errors';
import type { UploadFile } from './services/expenses';

export const MAX_UPLOAD_BYTES = 20 * 1024 * 1024;

/** Shared by the API (multipart) and the form action: form fields -> service input. */
export function formDataToExpense(form: FormData) {
  const str = (k: string) => String(form.get(k) ?? '').trim();
  const money = (k: string) => {
    const v = str(k);
    if (v === '') throw badRequest(`Feltet ${k} mangler`);
    try {
      return parseKrToOre(v);
    } catch {
      throw badRequest(`Ugyldigt beløb i ${k}: ${v}`);
    }
  };
  return {
    date: str('date'),
    supplier: str('supplier'),
    description: str('description'),
    category: str('category'),
    amountExVatOre: money('amountExVat'),
    vatOre: money('vat'),
    paidDate: str('paidDate') || null
  };
}

export async function uploadFromForm(form: FormData, field = 'file'): Promise<UploadFile | null> {
  const f = form.get(field);
  if (!(f instanceof File) || f.size === 0) return null;
  if (f.size > MAX_UPLOAD_BYTES) throw badRequest('Filen er for stor (maks. 20 MB)');
  return { name: f.name, type: f.type, bytes: Buffer.from(await f.arrayBuffer()) };
}
