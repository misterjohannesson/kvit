# Spec review – Faktura

Scope: conformance to the SPEC only (not style, not general engineering quality).
Method: full read of `src/lib/server/**`, `src/routes/**`, `scripts/seed.ts`, `tests/**`, `Dockerfile`, `docker-compose.yml`, `README.md`, `drizzle/0000_clean_toxin.sql`; live exercise of the seeded instance at `http://127.0.0.1:3102` (password `review1234`, data dir `data-review/`) via a Node script using the JSON API, PDF text extraction (`pdf-parse`), zip inspection (`adm-zip`) and read-only SQLite inspection (`better-sqlite3`); plus a run of the project's own test suite (`npx vitest run`: 8 files, 35 tests, all pass).

## Summary

| Severity | Count |
|---|---|
| Blocker | 1 |
| Major | 1 |
| Minor | 8 |

The core numbering/immutability design is sound in the common path, but one race (blocker) lets an issued invoice's database rows diverge from its archived PDF, and the credit-note VAT computation (major) can fail to net out by 1 øre. The remaining findings are small screen/PDF/upload gaps.

## Findings

### 1. BLOCKER – Draft edit racing an issue produces an issued invoice whose DB rows do not match the archived PDF (and the edit is accepted with 200, not 409)

- Files: `src/lib/server/services/invoices.ts:181-226` (`updateDraft`, not under the issue lock), `src/lib/server/services/invoices.ts:263-300` (`issueInvoice`: renders PDF from a snapshot at line 265-276, then flips status at 280-293 re-checking only `status === 'draft'`, not that lines/totals are unchanged).
- Spec: Rule 1/2 "once issued, invoice and lines read-only … Enforce in API layer"; Rule 4 "issuing generates PDF"; overall goal "every row traceable to a stored PDF".
- What the code does: `issueInvoice` reads the draft, awaits Chromium PDF rendering (~100-200 ms, outside any DB transaction), then in a transaction sets `invoice_number/status/pdf_path`. `PUT /api/invoices/:id` (`updateDraft`) is not serialised by `withIssueLock`, so a PUT landing during the render window passes `assertDraft`, rewrites lines and totals, and then the issue transaction commits on top of them.
- Reproduced live: draft id 11 with line `ORIGINAL-LINE 1 × 100,00`; fired `POST /issue` and, 60 ms later, `PUT` with `RACED-LINE 1 × 999,00`. Result: issue → 200 (number 1010), PUT → **200**. DB now: `status=issued`, lines `[RACED-LINE]`, `subtotal 99900 / vat 24975 / total 124875`. Stored `files/invoices/1010.pdf` contains `ORIGINAL-LINE`, `1.000,00 / 250,00 / 1.250,00` and no `RACED-LINE`. The `audit_log` `issue` row (id 57) records `totalOre: 12500` while the invoice row says 124875; an `update` audit row (id 56) sits between `create` and `issue`.
- Consequence: a legally numbered invoice exists whose ledger amounts (and therefore the VAT report, export CSVs and dashboard) disagree with the legal PDF, and an issued invoice was mutated via the API without a 409.
- Suggested fix: run `updateDraft` and `deleteDraft` under `withIssueLock` (or a per-invoice mutex), and inside the issue transaction verify the row still equals the rendered snapshot (e.g. add a `version`/`updated_at` column bumped by `updateDraft` and compare, or compare subtotal/vat/total + line count/hash) and throw `conflict()` on mismatch. Also write `audit('issue')` from the fresh row, not the pre-render snapshot.

### 2. MAJOR – Credit-note VAT is recomputed from the negated subtotal, so it does not always negate the original's VAT (1 øre mismatch; VAT report does not net out)

- Files: `src/lib/server/services/invoices.ts:337-342` (`lines` negated, then `computeTotals(lines, …)`), `src/lib/server/services/invoices.ts:61-66` (`Math.round((subtotalOre * 2500) / 10000)`).
- Spec: Rule 2 "credit note = new invoice with negated line amounts"; Rule 5 "salgsmoms … credit notes netting out".
- What the code does: `Math.round` rounds `x.5` toward +∞, so for any subtotal with `subtotal % 4 === 2` øre (e.g. 4.999,50 kr.) the original VAT rounds up and the credit note VAT rounds toward zero.
- Reproduced live: invoice 1008 `subtotal 499950, vat 124988, total 624938`; credit note 1009 `subtotal -499950, vat -124987, total -624937`. Net VAT +1 øre, net total +1 øre. Visible in `GET /api/vat?year=2026&quarter=3` (`1008:124988`, `1009:-124987`).
- Suggested fix: build the credit note totals as the exact negation of the original row (`subtotalOre: -orig.subtotalOre, vatOre: -orig.vatOre, totalOre: -orig.totalOre, vatRateBp: orig.vatRateBp`) instead of calling `computeTotals`.

### 3. MINOR – Expense upload accepts non-PDF/JPG/PNG content when the filename has an allowed extension

- File: `src/lib/server/services/expenses.ts:47-53` (`extFor` falls back to the filename extension when the MIME type is not in `ALLOWED_UPLOAD_EXT`).
- Spec: Rule 4 "Expense uploads land in /data/files/expenses/{voucher_number}.{ext} (pdf/jpg/png)".
- Live: multipart create with `Blob('not a pdf', type text/plain)` named `fake.pdf` → **201**, stored as `data-review/files/expenses/9.pdf` whose bytes are `not a pdf`. (`x.txt` and `x.svg` were correctly rejected with 400.)
- Suggested fix: require the MIME type to be one of the three and/or sniff magic bytes (`%PDF-`, `FF D8 FF`, `89 50 4E 47`) before accepting.

### 4. MINOR – Invoice table lacks the "paid" column

- File: `src/lib/components/InvoiceTable.svelte:37-47` (columns: Nr., Kunde, Udstedt, Forfald, Status, Beløb ekskl., Moms, Beløb i alt).
- Spec: "Invoices: table (number, date, customer, total, status, paid)".
- What the code does: paid state only appears as the "Betalt" status badge; `paidDate` is never shown in the list (only on the detail page).
- Suggested fix: add a `Betalt` column rendering `formatDate(r.paidDate)` (or `—`).

### 5. MINOR – The number stated in the confirm step is not the number guaranteed to be consumed

- Files: `src/lib/components/InvoiceEditor.svelte:208-211` and `src/routes/(app)/fakturaer/[id]/+page.svelte:88-90` (display `data.nextNumber` loaded with the page), `src/routes/(app)/fakturaer/[id]/+page.server.ts:64-70` (`issue` action passes no expected number), `src/lib/server/services/invoices.ts:263-271`.
- Spec: "Udsted button with confirm step stating the number about to be consumed".
- What the code does: the confirm text is correct at page-load time, but if next_invoice_number changes before the click (another tab issuing, or a settings bump – live I bumped 1011→1014 and the next issue took 1014) the invoice silently receives a different number than the one confirmed.
- Suggested fix: submit the displayed number as a hidden field (`expectedNumber`) and have `issueInvoice`/`creditInvoice` throw `conflict()` when it differs from `next_invoice_number`.

### 6. MINOR – Credit-note PDF omits due date / payment terms

- File: `src/lib/server/invoice-template.ts:114-116` (payment terms replaced by "Kreditnotaen modregnes faktura nr. …"), `:239` (Forfaldsdato row suppressed for credit notes).
- Spec: Rule 3 lists "payment terms/due date" among the legal fields for the document ("Faktura" or "Kreditnota").
- Live PDF 1006 text: has "Kreditnota", number, "Dato 07.09.2026", seller, buyer, lines, subtotal, "Moms 25 % −3.000,00", total, payment reference, reference to 1002 – but no due date/terms line.
- Suggested fix: print a settlement/terms line with a date on credit notes (e.g. "Forfaldsdato"/"Modregnes pr. dd.mm.yyyy") so every rule-3 field is present on both document types. Low legal risk, but the spec does not exempt credit notes.

### 7. MINOR – Paid date can be cleared again on an issued invoice (mutation not in spec)

- Files: `src/routes/api/invoices/[id]/paid/+server.ts:13` (`DELETE` → `setPaidDate(id, null)`), `src/routes/(app)/fakturaer/[id]/+page.svelte:95` ("Fortryd betaling"), `src/lib/server/services/invoices.ts:302-313`.
- Spec: Rule 2 issued invoices read-only; the only sanctioned mutation is "Markér som betalt sets paid_date".
- Live: `DELETE /api/invoices/7/paid` → 200, `paid_date` back to null (audit row `unmark_paid` is written, so it is traceable).
- Suggested fix: either drop the un-mark path or explicitly document it as an allowed, audited correction.

### 8. MINOR – "Today" is computed in UTC, not Europe/Copenhagen

- File: `src/lib/format.ts:426-428` (`new Date().toISOString().slice(0, 10)`), used for default `issue_date` on new drafts (`invoices.ts:159`), credit-note `issue_date` (`invoices.ts:336`), overdue detection and current-quarter selection (`+page.server.ts` loaders, `api/vat`).
- Spec: VAT report per calendar quarter by issue_date; dashboard overdue = due_date < today. `docker-compose.yml` sets `TZ: Europe/Copenhagen`, signalling local dates are intended.
- What the code does: between 00:00 and 02:00 local time the app uses yesterday's date; a credit note issued on 1 October 00:30 would be dated 30 September and land in Q3 instead of Q4.
- Suggested fix: derive the date via `Intl.DateTimeFormat('sv-SE', { timeZone: process.env.TZ ?? 'Europe/Copenhagen' })` or equivalent.

### 9. MINOR – VAT test only proves credit-note netting when run during Q3 2026

- File: `tests/api/vat.test.ts:42-45` (`creditNoteInQ3` computed from the wall clock), root cause in `scripts/seed.ts:123` / `invoices.ts:336` (credit note always dated today).
- Spec (DoD): "tests prove … VAT report equals hand-computed values incl. credit note".
- What the code does: on any other date the credit note falls outside Q3 and the assertion degrades to summing three documents; the netting property is then only checked indirectly (`credit.vatOre === -orig.vatOre` on the row, not in a quarter figure). It also would not catch finding 2 because the seed amounts do not hit the rounding case.
- Suggested fix: give the seed a fixed credit-note date (allow an optional `issueDate` in `creditInvoice` for seeding) and assert the quarter figure including the −3.000,00 unconditionally; add a rounding-case test.

### 10. MINOR – README claims the series "never gets gaps", but an upward edit of next_invoice_number creates one

- Files: `README.md:60-63` ("så serien aldrig får huller"), `src/lib/server/services/settings.ts:134-139`.
- Spec: "next invoice number editable only upward" (sanctioned) vs. Rule 1 "No gaps ever" – the spec itself carries the tension; the code follows the spec.
- Live: settings 1011 → 1014 was accepted (400 on downward, 200 on same, audit row written), next issue took 1014, leaving 1011-1013 unused (`DB numbers … gaps ["1010->1014"]`).
- Suggested fix: document in README and in the settings hint that raising the number is the one legal way a gap can arise and that the audit row is the auditor's explanation; optionally require a reason text stored in the audit detail.

## Verified compliant

Numbering and immutability
- Drafts are created without a number (`POST /api/invoices` → `invoiceNumber: null`, `status: draft`); DB query `status='draft' and invoice_number is not null` → 0 rows.
- Number assigned only in `issueInvoice`/`creditInvoice` inside `db.transaction` together with the status flip and `next_invoice_number` increment (`invoices.ts:280-293`, `366-411`); transaction re-checks status and that `next_invoice_number` is unchanged; PDF file is removed if the transaction fails.
- Live issue consumed exactly the advertised number (1007 expected, 1007 got); `next_invoice_number` advanced to 1008. Second issue of the same draft → 409. Series in DB: 1001-1010 contiguous (the 1010→1014 gap is the sanctioned settings bump).
- Project test "10 concurrent issues → consecutive numbers, no gap/duplicate" passes.
- `grep` for deletes: the only `db.delete(invoice)` is `deleteDraft` (`invoices.ts:235`) behind `assertDraft`; `invoice_line` deletes only in `updateDraft`/`deleteDraft`, both draft-only. No raw SQL deletes, no triggers, no cascade FKs. No `DELETE` handler on `/api/expenses/:id` (405).
- On an issued invoice: `PUT` → 409, `PATCH` → 409, `DELETE` → 409 (invoice still present), `POST /credit` on a draft/nonexistent → 404, on an already-credited → 409, on a credit note → 409, `POST /paid` on a credit note → 409, `DELETE` of a credit note → 409.
- Credit note: negated quantities and line totals, own number from the same series (1009 after 1008; seed 1006 after 1005), `credited_by_invoice_id` set on the original, original status → `credited`, `isCreditNote`/`creditsInvoiceNumber` exposed; credit note PDF says "Kreditnota" and "Vedrører faktura 1002".

PDF (rule 3) – extracted text of `files/invoices/1001.pdf`: "Faktura", "Fakturanr. 1001", "Fakturadato 14.04.2026", seller "Mit Firma ApS Eksempelvej 1 2100 København Ø CVR-nr. 12 34 56 78", buyer "Nordhavn Arkitekter ApS Sundkrogsgade 21 2100 København Ø CVR-nr. 38 41 22 07", line columns Beskrivelse/Antal/Enhed/Enhedspris ekskl. moms/Beløb ekskl. moms with values "42,00 time 950,00 39.900,00", "Subtotal ekskl. moms 46.800,00", "Moms 25 % 11.700,00" (rate and amount as separate figures), "I alt inkl. moms 58.500,00 DKK", "Betalingsbetingelser: netto 14 dage · Forfaldsdato 28.04.2026", "Betaling: Reg. 1234 Konto 1234567890". Invoice 1003 (VAT-exempt): "Moms 0 % 0,00" and "Momsfri: Omvendt betalingspligt, jf. momslovens § 46" printed, `vatOre 0`, `vatRateBp 0`; buyer without CVR prints no CVR line and prints country "DE".

PDF archival (rule 4)
- Every issued/credited row has `pdf_path = files/invoices/{number}.pdf` and the file exists (`DB issued without pdf_path` → 0; `fs.existsSync` true for 1007). `GET /api/invoices/:id/pdf` streams the stored file (`Content-Type: application/pdf`, `inline; filename="faktura-1007.pdf"`, `?download=1` → attachment); there is no regenerate endpoint or UI action; `renderInvoicePdf` is called only from `issueInvoice`/`creditInvoice`.
- Expense files: seed vouchers 1-8 at `files/expenses/{voucher}.{pdf|jpg|png}` all exist; `.txt` and `.svg` uploads → 400; file served inline with correct MIME.

VAT report (rule 5)
- `GET /api/vat?year=2026&quarter=2`: salgsmoms 14.700,00 (1001: 11.700,00 + 1002: 3.000,00), købsmoms 149,75 (74,75 + 0 + 75,00), momstilsvar 14.550,25 – matches hand computation from `scripts/seed.ts`. Q3 includes 1003 (0), 1004 (2.425,00), 1005 (3.125,00), credit note 1006 (−3.000,00) netting out the credited 1002, plus my test documents; købsmoms 1.304,80 from vouchers 4-8. Figures equal the sums of the drill-down rows; `quarter=5` → 400. Sales are by `issue_date`, purchases by expense `date`; drafts excluded; live computation (no stored aggregates).

Audit log (rule 6)
- `audit()` in `src/lib/server/audit.ts` is the only writer; the only other references to `auditLog` are `select` (export, counts). No `update`/`delete` on `audit_log` anywhere; no triggers.
- Live actions present: `customer.create`, `invoice.create/update/issue/issue_credit_note/credited/mark_paid/unmark_paid/delete_draft`, `expense.create/upload`, `setting.update` (with from/to per key, including `next_invoice_number` 1011→1014), `export.export`. Code also logs `customer.update/delete`, `expense.update`.

Screens (all GET 200 with cookie, `<html` returned, Danish text, no external URLs in HTML)
- Dashboard `/`: unpaid list (issued, non-credit-note, no paid_date) with "Forfalden +N dage" badge when `due_date < today`; current-quarter Salgsmoms/Købsmoms/Momstilsvar; YTD omsætning/udgifter/resultat.
- `/fakturaer`: table with status filters (Alle/Kladder/Åbne/Forfaldne/Betalte/Krediterede) and year filter; "Ny faktura" → draft editor with live subtotal/moms/total, "Udsted" → confirm box "Fakturaen får nummer {n}" and button "Udsted nr. {n}"; after issue: "Download PDF", "Markér som betalt" with date, "Opret kreditnota" with a confirm stating the credit-note number and the original.
- `/udgifter`: table, create form with `type=file accept=application/pdf,image/jpeg,image/png`, category `<datalist>` from prior values (`/api/expenses/categories`), VAT entered manually, incl. amount derived server-side; row click → detail page showing PDF in `<iframe>` or image inline.
- `/moms`: year + quarter selectors, three KPI figures, drill-down tables for sales and purchases with per-row links.
- `/kunder`: list, create, edit, delete (409/blocked when the customer has invoices); customer edits touch only the `customer` table (PDFs untouched).
- `/indstillinger`: company, CVR (8-digit check), bank, payment terms, moms flag, next number with `min` = current; server enforces upward-only (400 on decrease) and audit-logs the change.
- `/eksport`: single button `GET /api/export` → `application/zip`, 26 entries: `invoices.csv`, `invoice_lines.csv`, `expenses.csv`, `audit_log.csv` + all 20 files under `data-review/files/` (none missing). CSVs: UTF-8 with BOM, `;` separated, amounts `46800,00`, quantities `42`, quoted JSON in `detaljer`.

Data model / money / stack
- Schema matches spec tables and columns (`drizzle/0000_clean_toxin.sql`): unique `invoice_number`, unique `voucher_number`, `currency default 'DKK'` (only DKK present), `vat_rate_bp default 2500`, `next_invoice_number` default 1001, `vat_registered` flag, append-only `audit_log`. `journal_mode` = `wal`, `foreign_keys = ON`.
- All amounts integer øre end to end; `formatOre(123456)` → `1.234,56 kr.`; negatives rendered with U+2212; Danish input parser accepts `1.000,00`.
- Design assets `tokens.css`, `style.md`, `example.html` exist; `assertDesignAssets()` runs at module load of `hooks.server.ts` (halts startup) and Dockerfile also asserts them.
- No component library in `package.json`; CSS is `app.css` + `tokens.css`, no `url()`/`@font-face`/CDN; no `<link>`/`<script src>` to external hosts.
- Auth: unauthenticated `/` → 303 `/login`, `/api/*` → 401; wrong password → no cookie; correct password → `faktura_session` HttpOnly SameSite=Lax cookie; `/logout` clears it. `APP_PASSWORD` is required at startup (`env.ts:361-367`).
- Docker: single image (`mcr.microsoft.com/playwright:v1.63.0-noble`), `VOLUME ["/data"]`, `EXPOSE 3000`, compose maps `3000:3000`, mounts only `./data:/data`, `APP_PASSWORD: ${APP_PASSWORD:?…}` fails fast if unset; `.dockerignore` excludes `data`, `node_modules`, `build`.
- Seed: settings, 3 customers, invoices 1001-1005 (1003 VAT-exempt with reason, 1002 credited by 1006), 8 expenses with generated PDF/PNG/JPG files; refuses to run on a non-empty DB.
- README covers run (`docker compose up`), where data and the number series live (`setting.next_invoice_number`), backup (online SQLite backup + tar), a cron example that rsyncs off-box, and restore steps.
- Non-goals not built: no email/SMTP, payments, bank, NemHandel/OIOUBL, multi-currency, kontoplan, or multi-user code found (grep).
- Project tests: `npx vitest run` → 35/35 pass (numbering under concurrency, 409s, VAT, export zip, PDF text, expenses, customers, auth, settings).

Throwaway data created during review in `data-review/`: customers unchanged; invoices 1007-1010 and 1014 (plus credit note 1009), expense voucher 9 (`fake.pdf`), settings `next_invoice_number` now 1015.

## Pass 2

Scope: re-verification of every pass-1 finding against commits `51dc7a8` and `7301efe` (current `HEAD`), plus a re-check of the whole SPEC for regressions introduced by the fixes. Method: read of the changed files (`src/lib/server/services/invoices.ts`, `expenses.ts`, `settings.ts`, `export.ts`, `src/lib/format.ts`, `src/hooks.server.ts`, `svelte.config.js`, `src/routes/density/+server.ts`, `src/routes/api/invoices/[id]/**`, `src/routes/(app)/fakturaer/[id]/+page.server.ts|.svelte`, `src/lib/components/InvoiceEditor.svelte|InvoiceTable.svelte`, `src/lib/server/invoice-form.ts|expense-form.ts|invoice-template.ts`, `drizzle/0001_indexes_and_guards.sql`, `README.md`, `scripts/seed.ts`, new tests); live exercise of the re-seeded instance at `http://127.0.0.1:3102` (`data-review/`) via Node scripts (JSON API, SvelteKit form actions with `x-sveltekit-action`, `pdf-parse` text extraction, `adm-zip`, read-only `better-sqlite3`); an off-line upgrade test of migration `0001` against a database at migration `0000` holding issued data; `npx vitest run --project unit` (2 files, 15 tests, pass). The data dir had been re-seeded since pass 1 (numbers 1001–1006 only at start).

### Pass-1 findings

| # | Pass-1 finding | Status | Evidence |
|---|---|---|---|
| 1 | BLOCKER – draft edit racing issue diverges DB from PDF | **Fixed** | `updateDraft`/`deleteDraft` now run under `withIssueLock` (`invoices.ts:197,236`); the issue transaction re-reads the row and compares a content fingerprint (customer, dates, reason, reference, totals, every line) and `next_invoice_number` (`:317-333`); the PDF is written as `{n}.pdf.tmp` and renamed only after commit (`archivePdf`). Live: 7 runs firing `POST /issue` and a `PUT` with a 999,00 line after 0/30/60/90/120/160/220 ms – issue 200 every time, PUT **409** every time, DB lines `ORIGINAL-LINE`/total 12500 = PDF text (pdf-parse) in all 7. `DELETE` racing issue → 409, invoice 1014 issued with file present. Two concurrent issues → 200 + 409, one number. Issue racing a `PUT /api/settings` bump → issue took the confirmed 1016, bump applied afterwards. DB: 0 `issue` audit rows whose `totalOre` differs from the row, 0 `update` audit rows after an `issue` row for the same invoice. New project test `confirm step number › edits are serialised`. |
| 2 | MAJOR – credit-note VAT recomputed, 1 øre residue | **Fixed** | `creditInvoice` negates `subtotalOre/vatOre/totalOre` of the original exactly (`invoices.ts:388-393`). Live: 1 × 100,02 → 1021 `vat 2501`, credit 1022 `vat −2501`, net VAT 0, net total 0; 4.999,50 → `124988 / −124988`. `GET /api/vat?year=2026&quarter=3` rows `[1021: 2501], [1022: −2501]` sum 0; `salesVatOre` equals the drill-down sum. New test `credit note rounding`. |
| 3 | MINOR – non-PDF bytes accepted with `.pdf` name | **Fixed** | `sniffUploadExt` checks magic bytes; name and MIME are ignored (`expenses.ts:42-53`). Live: `fake.pdf` as `text/plain` → 400, `fake.pdf` as `application/pdf` → 400, GIF bytes named `fake.png` → 400; real PDF bytes named `bilag.txt` → 201 stored as `files/expenses/9.pdf`; PNG magic as `application/octet-stream` → `10.png`. New test in `expenses.test.ts`. |
| 4 | MINOR – invoice table lacks "paid" | **Fixed** | Paid date rendered in the list next to the `Betalt` badge (`InvoiceTable.svelte:83-86`); live `/fakturaer` HTML shows `badge-note` dates 27.04.2026, 20.07.2026, 01.09.2026, 05.09.2026 on the paid rows. Note: it sits in the `Status` cell rather than under its own header; all six spec data points (number, date, customer, total, status, paid) are present. |
| 5 | MINOR – confirmed number not the number consumed | **Fixed** for `Udsted` (residual on the credit path → new finding 12) | Editor posts hidden `expectedNumber` (`InvoiceEditor.svelte:100`); form action and API pass it to `issueInvoice`, which throws 409 when the series moved (`invoices.ts:314-316`). Live: stale `expectedNumber` → 409 "Næste fakturanummer er 1025, ikke 1024", draft unchanged, `next_invoice_number` unchanged, no `1025.pdf`/`.tmp` left; correct number → 200 and 1025 consumed. New test `confirm step number`. |
| 6 | MINOR – credit-note PDF omits due date/terms | **Fixed** | `invoice-template.ts:54-56,179` prints `Forfaldsdato` in the header and a `Betalingsbetingelser: … · Forfaldsdato dd.mm.yyyy` line on credit notes. Live PDF 1022 text: "Kreditnota", "Kreditnotanr. 1022", "Vedrører faktura 1021", "Dato 08.09.2026", "Forfaldsdato 08.09.2026", seller/buyer blocks, line, "Subtotal ekskl. moms −100,02", "Moms 25 % −25,01", "I alt inkl. moms, DKK −125,03", terms line, "Betaling: Reg. 1234 Konto 1234567890". (PDFs 1006/1009 from before the fix are unchanged – correctly, issued documents are immutable.) |
| 7 | MINOR – paid date could be cleared (`unpaid`) | **Fixed** | `DELETE /api/invoices/:id/paid` → 405, `?/unpaid` form action → 404, "Fortryd betaling" button gone; `PUT/PATCH/DELETE /api/invoices/:id` and `POST …/issue` on issued → 409; `POST …/paid` on a credit note → 409. Note (not a finding): `POST …/paid` on an already-paid invoice re-dates `paid_date` (200, audited `mark_paid`) – that is the spec's one sanctioned mutation. |
| 8 | MINOR – "today" computed in UTC | **Fixed** | `todayIso()` uses `Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Copenhagen' })` (`format.ts:104-106`); all loaders, `createDraft`, `creditInvoice`, `/api/vat` default and `invoiceStatus` use it. The only remaining `toISOString().slice(0,10)` on "now" is the export zip file name (`export.ts:103`), cosmetic. |
| 9 | MINOR – VAT test proves netting only in Q3 2026 | **Fixed** | `vat.test.ts` now asserts unconditionally that 1006 appears with −300.000 øre in the quarter of its own `issueDate`, that `credit.vatOre === -orig.vatOre`, and that figures equal the drill-down sums; a rounding-case test (100,02) was added. Residual (accepted): the seed still dates the credit note "today", so 1002 and 1006 only sum inside one quarter when the seed ran in Q2 – the negation itself is now asserted unconditionally. |
| 10 | MINOR – README "never gets gaps" vs. upward edit | **Fixed** | README "Hvor data ligger" states that raising the number is the only way a gap can arise and that the audit row documents it; the settings hint says the same (`indstillinger/+page.svelte:75`). Live: downward → 400 "kan kun sættes op"; the two upward bumps I made are audited (`{"next_invoice_number":{"from":"1017","to":"1021"}}`) and are the only gaps in 1001–1027. |

### New findings (introduced by the fix commits)

#### 11. MAJOR – Migration `0001` cannot be applied to a database that already holds invoice lines; the app then fails at startup on every existing data volume

- Files: `drizzle/0001_indexes_and_guards.sql:3-29` (`PRAGMA foreign_keys=OFF; CREATE TABLE __new_invoice …; INSERT … SELECT; DROP TABLE invoice; ALTER TABLE … RENAME; PRAGMA foreign_keys=ON`), `src/lib/server/db.ts:16,21` (`foreign_keys = ON` before `migrate()` at module load), `node_modules/drizzle-orm/sqlite-core/dialect.js:657` (the migrator wraps each migration in `BEGIN … COMMIT`).
- Spec: DoD "data survives container recreation"; five-year retention; the Rule 1/2 enforcement the migration is meant to add (triggers) never lands.
- What happens: `PRAGMA foreign_keys` is a no-op inside a transaction, so FK enforcement stays ON while `DROP TABLE invoice` performs its implicit `DELETE FROM invoice`; every `invoice_line` row then violates its FK. Reproduced off-line: created a DB at migration `0000` (opened the way `db.ts` does), inserted 1 customer, invoices 1001 (credited) / 1002 (issued) / 1 draft, 2 lines, 1 audit row, then ran `migrate()` with the full `drizzle/` folder → `DrizzleError: Failed to run the query 'DROP TABLE invoice;' | cause: FOREIGN KEY constraint failed code=SQLITE_CONSTRAINT_FOREIGNKEY`. The transaction rolled back (rows intact, `__drizzle_migrations` still at 1, **no triggers created**), and because `migrate()` runs at import of `db.ts`/`hooks.server.ts` the server cannot start. It succeeds only on an empty `invoice_line` table – which is why the re-seeded review instance and the test suite (fresh DB) did not surface it.
- Consequence: any installation that issued invoices before commit `51dc7a8` cannot boot the new image; the audit/immutability triggers are absent on exactly the databases that hold real data.
- Suggested fix: drop the table rebuild from `0001` (the self-referencing FK on `credited_by_invoice_id` is not required by the spec; keep the indexes and triggers), or perform the rebuild with `foreign_keys` genuinely OFF outside the migrator's transaction (a hand-written step in `db.ts` before `migrate()`), then regenerate `drizzle/meta/0001_snapshot.json`. Add an upgrade test that applies all migrations to a DB seeded at `0000`.

#### 12. MINOR – The credit-note confirm step states `next_invoice_number` from page load, but the number is not verified when the note is created

- Files: `src/routes/(app)/fakturaer/[id]/+page.svelte:115-118` ("Der oprettes en kreditnota med nummer {data.nextNumber}" / button "Opret kreditnota {data.nextNumber}"), `+page.server.ts:87-91` (`credit` action passes nothing), `invoices.ts:364` (`creditInvoice(id)` has no `expectedNumber`).
- Spec: strictly only "Udsted … confirm step stating the number about to be consumed" is required, but the app now makes the same promise in the credit dialog and, unlike `Udsted`, does not keep it. Residual of pass-1 finding 5.
- Live: loaded the detail page of 1025 (next number 1026), bumped the series to 1027 via `PUT /api/settings`, then submitted `?/credit` → 200; the credit note received **1027** while the dialog would have said 1026.
- Suggested fix: post a hidden `expectedNumber` from the credit dialog and add the same 409 check to `creditInvoice`.

### Regression sweep of the fixes (no violation found)

- SQLite triggers (`0001`): `audit_log` UPDATE/DELETE aborted; DELETE of non-draft invoices aborted; UPDATE of any content column, `invoice_number`, `pdf_path`, `created_at` or back to `draft` aborted on issued rows, while `paid_date`, `status→credited` and `credited_by_invoice_id` stay allowed – exactly the sanctioned mutations (`setPaidDate`, `creditInvoice`). `creditInvoice` inserts the note as `draft`, adds lines, then flips it, so the line triggers do not fire on the legal path; live: 4 credit notes created without error. Unit tests `db-guards` pass (15/15 together with the format tests). All 7 triggers present in `data-review/app.db` (fresh DB, see finding 11 for upgraded DBs).
- Async `updateDraft`/`deleteDraft`: every caller awaits (`+page.server.ts:52,60,68`, `api/invoices/[id]/+server.ts:9,16`, `scripts/seed.ts:111`, `db-guards.test.ts:34`). Validation and the first `assertDraft` run before taking the lock; both are repeated inside the transaction.
- Danish date inputs: `?/save` with `08.09.2026`/`22.09.2026` → stored `2026-09-08`/`2026-09-22`; ISO input still accepted; `31.02.2026` → `failure` with field error "Fakturadato: ugyldig dato – brug dd.mm.åååå"; expense `?/create` with `07.09.2026`, `1.000,00`, `250,00` → `2026-09-07`, 100000/25000/125000 øre; `?/paid` with `05.09.2026` → `paid_date 2026-09-05`. JSON API unchanged (ISO).
- CSRF host check (`hooks.server.ts:28-42`): mutating request with `Origin: http://evil.example` → 403, GET with the same Origin → 200, `Origin: http://127.0.0.1:3102` → 201, no Origin → allowed. SvelteKit's own check is disabled via `trustedOrigins: ['*']` with the replacement in place. CSP present on every page (`default-src 'self'`, no external hosts); HTML contains 0 external `src/href`.
- `/density` (`POST`, cookie `faktura_density`, 303 back to a same-site path; unauthenticated → 303 `/login`): no spec impact; UI text Danish (`Kompakt`).
- `Kreditnota` badge: `invoiceStatus` returns `Kreditnota` for credit notes; rendered in `/fakturaer`. Design assets `tokens.css` (+3 field-width tokens), `style.md` (badge row, print-totals note), `example.html` exist and are asserted at startup; the amendments are additive.
- Export: zip has the 4 CSVs and all 32 files under `data-review/files/` (0 missing, no `.tmp` files on disk); audit row `export.export` still written (now on stream end).
- Invariants after all probes: numbers 1001–1027 (22 documents) contiguous except the two audited settings bumps; 0 issued rows without number/PDF; 0 drafts with a number; every `pdf_path` exists; customer edit (`PUT /api/customers/3`) → 200 with `1001.pdf` mtime unchanged.
- PDF (`7301efe`): total row now reads "I alt inkl. moms, DKK 125,03" – all rule-3 fields still present in both document types.

Throwaway data created in `data-review/` during pass 2: invoices 1007–1027 (credit notes 1022, 1024, 1027), expense vouchers 9–11, `next_invoice_number` now 1028, customer 3's address edited and restored.

Open findings: 2

## Pass 3

Scope: final re-verification of the two findings left open after pass 2 (#11, #12) against commit `370a5f3` (`HEAD`), plus a regression sweep of everything else that commit touched (`drizzle/0002_status_guard.sql`, integer line math, removed exports, `repairArchivedPdfs`, CSRF `Origin: null`, CSP `object-src`). No source files were modified.

Method: read of the full commit diff; off-line probes run with `npx tsx` against a `git archive HEAD` export of `src/` + `drizzle/` (so the results reflect `HEAD`, not the working tree – see the note under Observations); `npx vitest run --project unit` (2 files, 11 tests, pass – `tests/unit/migration.test.ts` runs); live exercise of the current build via Node scripts (JSON API, SvelteKit form actions with `x-sveltekit-action`, read-only `better-sqlite3`, `pdf-parse`) and the browser (credit dialog end to end).

Instance note: the provided instance at `http://127.0.0.1:3105` (`data-review2/`) answered **500** to every request, including `GET /login`, throughout pass 3. Cause: its process (`node build`, started 00:24:25) had `build/` rewritten underneath it at 00:27:51 by another `npm run build`/`npm test`, so lazily imported route chunks no longer exist – an environment problem, not an app finding. I therefore verified against my own instance of the same `build/` (checked to contain `expectedNumber` in the credit handler, `foreign_key_check` in the db chunk and the 0002 trigger text) on `http://127.0.0.1:3106`, seeded with `scripts/seed.ts` into a throwaway `review/p3tmp/data-live` (removed afterwards, together with the scripts).

### Pass-2 findings

| # | Pass-2 finding | Status | Evidence |
|---|---|---|---|
| 11 | MAJOR – migration `0001` fails on a populated database; app cannot start on existing volumes | **Fixed** | `db.ts` now sets `foreign_keys = OFF` before `migrate()`, runs `PRAGMA foreign_key_check` (throws on any row) and sets `foreign_keys = ON` afterwards. Reproduced my pass-2 probe against `HEAD`: 0000-schema DB with 1 customer, invoices 1001 (credited → 1002), 1002 (issued, negative totals), 1003 (issued, paid), 1 draft, 4 lines, 1 expense, 1 audit row, `next_invoice_number` 1004, journal row for `0000` inserted the way the migrator does. Booting `src/lib/server/db.ts` → **no error**; `__drizzle_migrations` has 3 rows; all 4 invoices / 4 lines / expense / audit row intact (`credited_by_invoice_id`, `paid_date`, `pdf_path` preserved); `foreign_key_check` empty; `PRAGMA foreign_keys` = 1 afterwards; all 9 triggers and the 4 invoice indexes present. Guards live on the migrated data: delete issued → aborted; update total, issued→draft, credited→issued, issued→credited without `credited_by`, issued→bogus, draft→credited, insert with bogus status → aborted; `audit_log` update/delete → aborted; line insert on issued → aborted; `paid_date` update and draft-line delete allowed; FK enforcement active again (insert with `invoice_id` 999 → `FOREIGN KEY constraint failed`). Project test `tests/unit/migration.test.ts` covers the same scenario and passes. |
| 12 | MINOR – credit-note confirm number not verified server-side | **Fixed** | `creditInvoice(id, expectedNumber?)` throws 409 when `expectedNumber !== next_invoice_number` (`invoices.ts:395-397`, checked before the PDF is rendered; the existing series re-check inside the transaction still applies); the dialog posts a hidden `expectedNumber` (`+page.svelte:117`); `?/credit` and `POST /api/invoices/:id/credit` pass it through. Live API: issued 1007, `POST …/credit {expectedNumber: 1013}` (next was 1008) → **409** "Næste nummer er 1008, ikke 1013", original still `issued`, `next_invoice_number` unchanged, no `1008.pdf`/`.tmp`/`1013.pdf` on disk. Live form (pass-2 scenario): detail page loaded, series bumped 1008→1010 via `PUT /api/settings`, `?/credit` with `expectedNumber=1008` → `failure` **409**, nothing consumed; with `1010` → 303 to the note; note 1010 = exact negation of 1007 (`−10002 / −2501 / −12503`, line `−1 × 100,02`), original `credited`, `1010.pdf` present. Browser end to end on 1001: clicking "Opret kreditnota" renders "Der oprettes en kreditnota med nummer 1015", hidden `expectedNumber=1015`, button "Opret kreditnota 1015"; bumped the series to 1017 behind the page and clicked → page shows "Næste nummer er 1017, ikke 1015. Genindlæs siden og bekræft igen.", 1001 still issued/paid, 1015–1017 unconsumed. Without `expectedNumber` the API still credits (201; 1012 = −VAT of 1011); crediting an already-credited invoice → 409. New project test `refuses to credit with a stale confirmed number (409) and consumes nothing`. |

### Regression sweep of commit `370a5f3` (no violation found)

- `0002_status_guard.sql` vs. the credit-note flow: the note is inserted as `draft` (`invoice_status_values_insert` ok), lines added while draft, then flipped `draft→issued` with number + `pdf_path` in one statement (the immutability trigger only fires for `OLD.status <> 'draft'`), and the original goes `issued→credited` with `credited_by_invoice_id` set in the same `UPDATE` – exactly the transition the tightened trigger permits. Live: 4 credit notes created without error (1010, 1012, 1014 plus seed 1006); `setPaidDate` still allowed. The tightened trigger now also blocks `credited→issued`, `issued→credited` without a back-reference and unknown status values (all confirmed off-line, see #11). Fresh DB on 3106 has all 9 triggers and 3 migration rows.
- Integer line math: `computeLineTotalOre` = `roundOre(round(q×100) × øre / 100)`; live `0,29 × 0,50 kr` → **15** øre (float math gave 14), `1,1 × 0,01` → 1, `±0,5 × 0,01` → ±1, `42 × 950,00` → 3.990.000; subtotal = sum of lines, VAT 25 % of subtotal; `subtotal_ore = Σ line_total_ore` holds for every row in the DB. JSON API: 3-decimal quantity → 400 "Antal kan højst have to decimaler", fractional øre → 400. Form path (`?/save`, `lines` JSON): `0,29`/`0,50` → 15 øre; `1.234,56` → 123456 øre; `0,005` kr → 400. The client editor uses the same formula (`InvoiceEditor.svelte:49-56`), so the live preview equals the saved total. Credit notes still negate the original's stored figures, never recompute (VAT rows `[1007: 2501], [1010: −2501]` in `GET /api/vat?year=2026&quarter=3`).
- Removed exports (`getInvoiceByNumber`, `getSetting`, `DESIGN_ASSETS`, `CustomerInput`, `ExpenseInput`, `DraftInput`, `SettingsInput`; `EXPENSE_FILES_DIR` import dropped from `expenses.ts`): grep over `src/`, `scripts/`, `tests/` finds no remaining references; `assertDesignAssets()` still checks the three design files at startup (`assets.ts:5-9`).
- `repairArchivedPdfs()` (new startup step in `hooks.server.ts`): off-line against `HEAD` with a row whose `pdf_path` exists only as `1001.pdf.tmp` and another with both `1002.pdf` and a stale `1002.pdf.tmp` → returns 1, `1001.pdf.tmp` renamed to `1001.pdf`, `1002.pdf` untouched (content intact). It only renames, never regenerates – rule 4 preserved.
- CSRF: `Origin: null` on a mutating request → **403** (was allowed), `Origin: http://evil.example` → 403; same-origin form posts and header-less script calls → allowed. CSP `object-src 'none'` (was `'self'`) – tighter, no spec impact. Login lockout map is now pruned – no behaviour change for a correct password.
- Invariants on the 3106 data set after all probes: numbers 1001–1014 contiguous except the audited bump `1007→1010` (`setting.update {"next_invoice_number":{"from":"1008","to":"1010"}}`), 0 drafts with a number, 0 issued rows without number/PDF, every `pdf_path` exists, no `.tmp` files, `foreign_key_check` empty, audit rows `issue` 8 / `issue_credit_note` 4 / `credited` 4.

### Observations (not findings)

- `expectedNumber` is opt-in on the API: a non-integer value (`"abc"`) is treated as absent and the credit proceeds (201). The UI always sends the displayed integer, so the confirm-step guarantee holds; a strict 400 would be marginally safer for scripted callers.
- The draft form rounds a 3-decimal quantity (`1,005` → `1,01`) silently, while the JSON API rejects it with 400. Totals are consistent either way; UI/API asymmetry only.
- The working tree at review time carries **uncommitted** changes beyond `HEAD` (`db.ts` with a `REQUIRED_TRIGGERS` startup assertion, `schema.ts`, `api.ts`, several page servers, tests, and a new `drizzle/0003_credited_by_guard.sql` which at 00:34 contained only the drizzle placeholder comment). That empty migration makes `migrate()` throw `The supplied SQL string contains no statements` at startup – a work-in-progress state I ran into while probing, not part of `370a5f3`; the builder should give `0003` a body (or remove it together with its journal entry and snapshot) before committing.

Throwaway data: `review/p3tmp/` (own instance, off-line DBs, scripts) deleted after the pass; `data-review2/` untouched (its instance never answered).

Open findings: 0
