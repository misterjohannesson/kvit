/**
 * Thin typed HTTP client for the app's JSON API. All business rules live in the
 * app; this only shapes requests and turns non-2xx answers into FakturaError
 * with the status and the app's own (Danish) message, so a tool can report
 * "409 Conflict: Faktura 1004 er udstedt og kan ikke ændres" verbatim.
 */
import type { Config } from './config.js';

export class FakturaError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    public readonly fields: Record<string, string> = {}
  ) {
    super(message);
    this.name = 'FakturaError';
  }
  get kind(): 'auth' | 'forbidden' | 'not_found' | 'conflict' | 'validation' | 'unavailable' | 'error' {
    if (this.status === 401) return 'auth';
    if (this.status === 403) return 'forbidden';
    if (this.status === 404) return 'not_found';
    if (this.status === 409) return 'conflict';
    if (this.status === 400 || this.status === 413 || this.status === 422) return 'validation';
    if (this.status === 0 || this.status >= 502) return 'unavailable';
    return 'error';
  }
}

export interface InvoiceRow {
  id: number;
  invoiceNumber: number | null;
  status: 'draft' | 'issued' | 'credited';
  customerId: number;
  customerName: string;
  issueDate: string;
  dueDate: string;
  paidDate: string | null;
  sentAt: string | null;
  subtotalOre: number;
  vatOre: number;
  totalOre: number;
  vatRateBp: number;
  vatExemptReason: string | null;
  paymentReference: string;
  pdfPath: string | null;
  isCreditNote: boolean;
  creditsInvoiceNumber: number | null;
  creditedByNumber: number | null;
}

export interface InvoiceDetail extends InvoiceRow {
  customer: Customer;
  lines: { id: number; description: string; quantity: number; unit: string; unitPriceOre: number; lineTotalOre: number; accountId: number }[];
  creditsInvoiceId: number | null;
  originalPaidDate: string | null;
  attachments: { id: number; name: string; pages: number; sizeBytes: number }[];
}

export interface Customer {
  id: number;
  name: string;
  address: string;
  zip: string;
  city: string;
  country: string;
  cvr: string | null;
  email: string;
  paymentTermsDays: number | null;
}

export interface Account {
  id: number;
  number: number;
  name: string;
  type: 'revenue' | 'cost';
  /** Kontoplan group heading (report subtotals); '' when ungrouped. */
  group: string;
  /** Archived accounts keep their history but take no new records. */
  archived: boolean;
}

export interface Expense {
  id: number;
  voucherNumber: number;
  date: string;
  supplier: string;
  description: string;
  accountId: number;
  amountExVatOre: number;
  vatOre: number;
  amountInclOre: number;
  paidDate: string | null;
  filePath: string | null;
}

export interface CashMovement {
  id: number;
  date: string;
  description: string;
  amountOre: number;
  kind: string;
}

export interface Balance {
  asOf: string;
  likviderOre: number;
  debitorerOre: number;
  kreditorerOre: number;
  skyldigeKreditnotaerOre: number;
  skyldigMomsOre: number;
  nettoOre: number;
  accruedVatOre: number;
  vatPaymentsOre: number;
  openingBalanceOre: number;
  openInvoices: number;
  unpaidExpenses: number;
  openCreditNotes: number;
  lastReconciliation: { at: string; date: string; actualOre: number; differenceOre: number; bookedMovementId: number | null } | null;
}

export interface CashflowMonth {
  month: string;
  kind: 'closed' | 'current' | 'forecast';
  inOre: number;
  outOre: number;
  netOre: number;
  positionOre: number;
  forecastInOre: number;
  forecastOutOre: number;
  projectedPositionOre: number;
}

export interface Cashflow {
  openingBalanceOre: number;
  openingBalanceDate: string;
  months: CashflowMonth[];
  forecast: {
    fromMonth: string;
    toMonth: string;
    items: { month: string; kind: string; label: string; detail: string; amountOre: number }[];
    invoicesInOre: number;
    expensesOutOre: number;
    creditNotesOutOre: number;
    vatOutOre: number;
    netOre: number;
    projectedPositionOre: number;
  };
  closingPositionOre: number;
}

export interface VatReport {
  year: number;
  quarter: number;
  from: string;
  to: string;
  salesVatOre: number;
  purchaseVatOre: number;
  netVatOre: number;
  salesExVatOre: number;
  purchasesExVatOre: number;
  salesRows: InvoiceRow[];
  purchaseRows: Expense[];
}

export interface Resultat {
  year: number;
  quarter: number | null;
  from: string;
  to: string;
  revenue: { account: Account; totalOre: number }[];
  costs: { account: Account; totalOre: number }[];
  revenueOre: number;
  costsOre: number;
  resultOre: number;
}

export interface ReconcileResult {
  date: string;
  likviderOre: number;
  actualOre: number;
  differenceOre: number;
  movement: CashMovement | null;
}

export class FakturaClient {
  constructor(private readonly config: Config) {}

  /** Refuses to call the app at all without a token: no request ever leaves with missing credentials. */
  private assertToken(): string {
    if (!this.config.token) {
      throw new FakturaError(401, 'FAKTURA_API_TOKEN is not set. Configure the token (the app\'s API_TOKEN) before using the tools.');
    }
    return this.config.token;
  }

  // Only GET and POST exist: there is no code path for PUT or DELETE, so nothing here can edit or remove records.
  private async request<T>(method: 'GET' | 'POST', path: string, body?: unknown): Promise<T> {
    const token = this.assertToken();
    const headers: Record<string, string> = { authorization: `Bearer ${token}`, accept: 'application/json' };
    const init: RequestInit = { method, headers, redirect: 'manual' };
    if (body !== undefined) {
      headers['content-type'] = 'application/json';
      init.body = JSON.stringify(body);
    }
    let res: Response;
    try {
      res = await fetch(this.config.baseUrl + path, init);
    } catch (e) {
      throw new FakturaError(0, `Could not reach the Faktura app at ${this.config.baseUrl}: ${(e as Error).message}`);
    }
    const text = await res.text();
    let data: unknown = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = null;
    }
    if (!res.ok) {
      const err = (data ?? {}) as { error?: string; fields?: Record<string, string> };
      const message = err.error ?? (res.status === 401 ? 'Unauthorized' : `HTTP ${res.status}`);
      throw new FakturaError(res.status, message, err.fields ?? {});
    }
    return data as T;
  }

  get<T>(path: string): Promise<T> {
    return this.request<T>('GET', path);
  }

  post<T>(path: string, body: unknown): Promise<T> {
    return this.request<T>('POST', path, body);
  }

  // ---- typed endpoints -------------------------------------------------------

  listInvoices(params: { year?: number } = {}): Promise<InvoiceRow[]> {
    const q = params.year ? `?year=${params.year}` : '';
    return this.get<InvoiceRow[]>(`/api/invoices${q}`);
  }

  getInvoiceByNumber(number: number): Promise<InvoiceDetail> {
    return this.get<InvoiceDetail>(`/api/invoices/number/${number}`);
  }

  listExpenses(params: { year?: number } = {}): Promise<Expense[]> {
    const q = params.year ? `?year=${params.year}` : '';
    return this.get<Expense[]>(`/api/expenses${q}`);
  }

  listAccounts(): Promise<Account[]> {
    return this.get<Account[]>('/api/accounts');
  }

  listCustomers(): Promise<Customer[]> {
    return this.get<Customer[]>('/api/customers');
  }

  balance(): Promise<Balance> {
    return this.get<Balance>('/api/finance?view=balance');
  }

  cashflow(): Promise<Cashflow> {
    return this.get<Cashflow>('/api/finance?view=cashflow');
  }

  vatReport(year: number, quarter: number): Promise<VatReport> {
    return this.get<VatReport>(`/api/vat?year=${year}&quarter=${quarter}`);
  }

  resultat(year: number, quarter?: number): Promise<Resultat> {
    return this.get<Resultat>(`/api/finance?view=resultat&year=${year}${quarter ? `&quarter=${quarter}` : ''}`);
  }

  markPaid(id: number, paidDate: string): Promise<InvoiceDetail> {
    return this.post<InvoiceDetail>(`/api/invoices/${id}/paid`, { paidDate });
  }

  createMovement(body: { date: string; description: string; amountOre: number; kind: string }): Promise<CashMovement> {
    return this.post<CashMovement>('/api/cash-movements', body);
  }

  reconcile(actualOre: number, date?: string): Promise<ReconcileResult> {
    return this.post<ReconcileResult>('/api/balance/reconcile', { actualOre, date });
  }

  createDraft(body: {
    customerId: number;
    lines: { description: string; quantity: number; unit: string; unitPriceOre: number; accountId?: number }[];
    issueDate?: string;
    dueDate?: string;
    paymentReference?: string;
    vatExemptReason?: string | null;
  }): Promise<InvoiceDetail> {
    return this.post<InvoiceDetail>('/api/invoices', body);
  }

  createExpense(body: {
    date: string;
    supplier: string;
    description: string;
    accountId: number;
    amountExVatOre: number;
    vatOre: number;
    paidDate?: string | null;
  }): Promise<Expense> {
    return this.post<Expense>('/api/expenses', body);
  }
}
