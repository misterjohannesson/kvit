import { parseKrToOre } from '../format';
import { badRequest } from './errors';

/** Customer form fields -> service input (shared by create and edit actions). */
export function customerFormToInput(form: FormData) {
  const str = (k: string) => String(form.get(k) ?? '').trim();
  let hourlyRateOre: number | null = null;
  if (str('hourlyRate') !== '') {
    try {
      hourlyRateOre = parseKrToOre(str('hourlyRate'));
    } catch {
      throw badRequest('Timepris: ugyldigt beløb – skriv fx 950 eller 950,00', { hourlyRate: 'Ugyldigt beløb' });
    }
  }
  return {
    name: str('name'),
    address: str('address'),
    zip: str('zip'),
    city: str('city'),
    country: str('country') || 'DK',
    cvr: str('cvr') || null,
    email: str('email'),
    paymentTermsDays: str('paymentTermsDays') === '' ? null : str('paymentTermsDays'),
    hourlyRateOre
  };
}
