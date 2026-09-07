import { parseKrToOre, parseQuantity } from '../format';
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
  let rawLines: EditorLine[] = [];
  try {
    rawLines = JSON.parse(str('lines') || '[]');
  } catch {
    throw badRequest('Fakturalinjer kunne ikke læses');
  }
  if (!Array.isArray(rawLines)) throw badRequest('Fakturalinjer kunne ikke læses');

  const lines = rawLines
    .filter((l) => (l.description ?? '').trim() !== '' || (l.quantity ?? '').trim() !== '' || (l.unitPrice ?? '').trim() !== '')
    .map((l, i) => {
      try {
        return {
          description: String(l.description ?? '').trim(),
          quantity: parseQuantity(String(l.quantity ?? '')),
          unit: String(l.unit ?? '').trim(),
          unitPriceOre: parseKrToOre(String(l.unitPrice ?? ''))
        };
      } catch (e) {
        throw badRequest(`Linje ${i + 1}: ${(e as Error).message}`);
      }
    });

  const vatExempt = form.get('vatExempt') === 'on';
  const reason = str('vatExemptReason');
  if (vatExempt && !reason) throw badRequest('Angiv årsag til momsfritagelse');

  return {
    customerId: Number(str('customerId')),
    issueDate: str('issueDate'),
    dueDate: str('dueDate'),
    paymentReference: str('paymentReference'),
    vatExemptReason: vatExempt ? reason : null,
    lines
  };
}
