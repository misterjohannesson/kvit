export const DEFAULT_SETTINGS: Record<string, string> = {
  company_name: '',
  company_address: '',
  company_zip: '',
  company_city: '',
  company_cvr: '',
  bank_reg: '',
  bank_account: '',
  payment_terms_days: '14',
  next_invoice_number: '1001',
  vat_registered: '1'
};

export const SETTING_KEYS = Object.keys(DEFAULT_SETTINGS);
