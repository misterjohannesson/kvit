import { parseDateInput, parseKrToOre, parseQuantity } from '../format';
import { badRequest } from './errors';
import type { TimeRowInput } from './services/time';

export interface EditorLine {
  description: string;
  quantity: string;
  unit: string;
  unitPrice: string;
  accountId?: string | number | undefined;
}

/** A row of the editor's time section as the hidden field carries it (Danish number strings). */
export interface EditorTimeRow {
  type: 'group' | 'entry';
  description?: string;
  entryId?: number;
  indent?: boolean;
  invoicedHours?: string;
  invoicedDescription?: string;
  rate?: string;
}

/** The editor's time section -> service rows; undefined when the form has no time field. */
function timeRowsFromForm(raw: string, errors: string[]) {
  if (raw === '') return undefined;
  let rows: unknown;
  try {
    rows = JSON.parse(raw);
  } catch {
    throw badRequest('Timelinjer kunne ikke læses');
  }
  if (!Array.isArray(rows) || rows.some((r) => typeof r !== 'object' || r === null)) throw badRequest('Timelinjer kunne ikke læses');
  return (rows as EditorTimeRow[]).flatMap((r, i): TimeRowInput[] => {
    if (r.type === 'group') return [{ type: 'group', description: String(r.description ?? '').trim() }];
    try {
      const rate = String(r.rate ?? '').trim();
      return [
        {
          type: 'entry',
          entryId: Number(r.entryId),
          indent: r.indent === true,
          invoicedHours: parseQuantity(String(r.invoicedHours ?? '')),
          invoicedDescription: String(r.invoicedDescription ?? '').trim(),
          rateOre: rate === '' ? null : parseKrToOre(rate)
        }
      ];
    } catch (e) {
      errors.push(`Timelinje ${i + 1}: ${(e as Error).message}`);
      return [];
    }
  });
}

/** Form fields of the draft editor -> service input for updateDraft(). */
export function formDataToDraft(form: FormData) {
  const str = (k: string) => String(form.get(k) ?? '').trim();
  const timeErrors: string[] = [];
  const time = timeRowsFromForm(str('time'), timeErrors);
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
      unitPrice: String(l.unitPrice ?? '').trim(),
      accountId: l.accountId === undefined || l.accountId === '' ? undefined : Number(l.accountId)
    }))
    .filter((l) => l.description !== '' || l.quantity !== '' || l.unitPrice !== '')
    .flatMap((l, i) => {
      try {
        if (l.accountId !== undefined && (!Number.isInteger(l.accountId) || l.accountId <= 0)) throw new Error('Vælg en salgskonto');
        return [{ description: l.description, quantity: parseQuantity(l.quantity), unit: l.unit, unitPriceOre: parseKrToOre(l.unitPrice), accountId: l.accountId }];
      } catch (e) {
        lineErrors.push(`Linje ${i + 1}: ${(e as Error).message}`);
        return [];
      }
    });
  // Header fields and lines are all validated before throwing so every problem is reported in one round.
  const fields: Record<string, string> = {};
  const messages: string[] = [...timeErrors, ...lineErrors];
  if (lineErrors.length) fields.lines = lineErrors.join('; ');
  if (timeErrors.length) fields.time = timeErrors.join('; ');
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
    lines,
    time
  };
}
