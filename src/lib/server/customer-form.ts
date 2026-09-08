/** Customer form fields -> service input (shared by create and edit actions). */
export function customerFormToInput(form: FormData) {
  const str = (k: string) => String(form.get(k) ?? '').trim();
  return {
    name: str('name'),
    address: str('address'),
    zip: str('zip'),
    city: str('city'),
    country: str('country') || 'DK',
    cvr: str('cvr') || null,
    email: str('email'),
    paymentTermsDays: str('paymentTermsDays') === '' ? null : str('paymentTermsDays')
  };
}
