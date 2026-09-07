import { parseDateInput, parseKrToOre, parseQuantity } from '../format';
import { badRequest } from './errors';

export interface EditorLine {
  description: string;
  quantity: string;
  unit: string;
  unitPrice: string;
}

/** Form fields of the draft editor -> service input for updateDraft(). */
export function formDataToDraft(form: FormData) {
  const str = (k: string) => String(form.get(k) ?? '').trim();
  let rawLines: unknown;
  try {
    rawLines = JSON.parse(str('lines') || '[]');
  } catch {
    throw badRequest('Fakturalinjer kunne ikke læses');
  }
  if (!Array.isArray(rawLines) || rawLines.some((l) => typeof l !== 'object' || l === null)) {
    throw badRequest('Fakturalinjer kunne ikke læses');
  }

  const lines = (rawLines as Partial<EditorLine>[])
    .map((l) => ({
      description: String(l.description ?? '').trim(),
      quantity: String(l.quantity ?? '').trim(),
      unit: String(l.unit ?? '').trim(),
      unitPrice: String(l.unitPrice ?? '').trim()
    }))
    .filter((l) => l.description !== '' || l.quantity !== '' || l.unitPrice !== '')
    .map((l, i) => {
      try {
        return {
          description: l.description,
          quantity: parseQuantity(l.quantity),
          unit: l.unit,
          unitPriceOre: parseKrToOre(l.unitPrice)
        };
      } catch (e) {
        throw badRequest(`Linje ${i + 1}: ${(e as Error).message}`);
      }
    });

  const vatExempt = form.get('vatExempt') === 'on';
  const reason = str('vatExemptReason');
  if (vatExempt && !reason) throw badRequest('Angiv årsag til momsfritagelse', { vatExemptReason: 'Skal udfyldes' });

  const date = (k: string, label: string) => {
    try {
      return parseDateInput(str(k));
    } catch {
      throw badRequest(`${label}: ugyldig dato – brug dd.mm.åååå`, { [k]: 'Ugyldig dato – brug dd.mm.åååå' });
    }
  };

  return {
    customerId: Number(str('customerId')),
    issueDate: date('issueDate', 'Fakturadato'),
    dueDate: date('dueDate', 'Forfaldsdato'),
    paymentReference: str('paymentReference'),
    vatExemptReason: vatExempt ? reason : null,
    lines
  };
}
