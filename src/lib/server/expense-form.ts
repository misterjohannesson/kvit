import { parseDateInput, parseKrToOre } from '../format';
import { badRequest } from './errors';
import type { UploadFile } from './services/expenses';

export const MAX_UPLOAD_BYTES = 20 * 1024 * 1024;

/** The select's value that reveals the "new supplier" text field. */
export const NEW_SUPPLIER = '__new__';

const LABELS: Record<string, string> = {
  date: 'Dato',
  supplier: 'Leverandør',
  description: 'Beskrivelse',
  accountId: 'Konto',
  amountExVat: 'Beløb ekskl. moms',
  vat: 'Moms',
  paidDate: 'Betalt'
};

/**
 * Shared by the API (multipart) and the form actions: form fields -> service input.
 * Every field is validated before throwing, so the form can mark all offending
 * fields at once (style.md §4). The supplier comes as `supplierId` (an existing
 * one) or, when that is empty or "__new__", as the typed `supplier` name.
 */
export function formDataToExpense(form: FormData) {
  const str = (k: string) => String(form.get(k) ?? '').trim();
  const fields: Record<string, string> = {};
  const money = (k: string): number => {
    const v = str(k);
    if (v === '') {
      fields[k] = 'Skal udfyldes';
      return 0;
    }
    try {
      return parseKrToOre(v);
    } catch {
      fields[k] = 'Ugyldigt beløb – brug fx 1.234,56';
      return 0;
    }
  };
  const date = (k: string, required: boolean): string | null => {
    const v = str(k);
    if (v === '') {
      if (required) fields[k] = 'Skal udfyldes';
      return null;
    }
    try {
      return parseDateInput(v);
    } catch {
      fields[k] = 'Ugyldig dato – brug dd.mm.åååå';
      return null;
    }
  };
  if (str('description') === '') fields.description = 'Skal udfyldes';

  const supplierChoice = str('supplierId');
  let supplierId: number | undefined;
  let supplierName: string | undefined;
  if (supplierChoice !== '' && supplierChoice !== NEW_SUPPLIER) {
    supplierId = Number(supplierChoice);
    if (!Number.isInteger(supplierId) || supplierId <= 0) fields.supplier = 'Vælg en leverandør';
  } else if (str('supplier') === '') {
    fields.supplier = supplierChoice === NEW_SUPPLIER ? 'Skriv navnet på den nye leverandør' : 'Vælg en leverandør, eller skriv en ny';
  } else {
    supplierName = str('supplier');
  }

  const accountId = Number(str('accountId'));
  if (!Number.isInteger(accountId) || accountId <= 0) fields.accountId = 'Vælg en konto';
  const result = {
    date: date('date', true) as string,
    supplierId,
    supplier: supplierName,
    description: str('description'),
    accountId,
    amountExVatOre: money('amountExVat'),
    vatOre: money('vat'),
    paidDate: date('paidDate', false)
  };
  const keys = Object.keys(fields);
  if (keys.length > 0) {
    throw badRequest(keys.map((k) => `${LABELS[k]}: ${fields[k]}`).join('; '), fields);
  }
  return result;
}

export async function uploadFromForm(form: FormData, field = 'file'): Promise<UploadFile | null> {
  const f = form.get(field);
  if (!(f instanceof File) || f.size === 0) return null;
  if (f.size > MAX_UPLOAD_BYTES) throw badRequest('Filen er for stor (maks. 20 MB)', { [field]: 'Maks. 20 MB' });
  return { name: f.name, type: f.type, bytes: Buffer.from(await f.arrayBuffer()) };
}
