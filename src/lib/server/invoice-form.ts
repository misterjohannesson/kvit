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

  const lineErrors: string[] = [];
  const lines = (rawLines as Partial<EditorLine>[])
    .map((l) => ({
      description: String(l.description ?? '').trim(),
      quantity: String(l.quantity ?? '').trim(),
      unit: String(l.unit ?? '').trim(),
      unitPrice: String(l.unitPrice ?? '').trim()
    }))
    .filter((l) => l.description !== '' || l.quantity !== '' || l.unitPrice !== '')
    .flatMap((l, i) => {
      try {
        return [{ description: l.description, quantity: parseQuantity(l.quantity), unit: l.unit, unitPriceOre: parseKrToOre(l.unitPrice) }];
      } catch (e) {
        lineErrors.push(`Linje ${i + 1}: ${(e as Error).message}`);
        return [];
      }
    });
  if (lineErrors.length) throw badRequest(lineErrors.join('; '), { lines: lineErrors.join('; ') });

  // Header fields are all validated before throwing so every bad field is marked at once.
  const fields: Record<string, string> = {};
  const messages: string[] = [];
  const vatExempt = form.get('vatExempt') === 'on';
  const reason = str('vatExemptReason');
  if (vatExempt && !reason) {
    fields.vatExemptReason = 'Skal udfyldes';
    messages.push('Angiv årsag til momsfritagelse');
  }
  const date = (k: string, label: string): string => {
    try {
      return parseDateInput(str(k));
    } catch {
      fields[k] = 'Ugyldig dato – brug dd.mm.åååå';
      messages.push(`${label}: ugyldig dato – brug dd.mm.åååå`);
      return '';
    }
  };
  const issueDate = date('issueDate', 'Fakturadato');
  const dueDate = date('dueDate', 'Forfaldsdato');
  if (messages.length) throw badRequest(messages.join('; '), fields);

  return {
    customerId: Number(str('customerId')),
    issueDate,
    dueDate,
    paymentReference: str('paymentReference'),
    vatExemptReason: vatExempt ? reason : null,
    lines
  };
}
