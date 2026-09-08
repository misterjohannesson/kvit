# SPEC: Solo invoicing + bookkeeping app ("Faktura")

You are building a complete, working, single-user web app in one pass. Follow this spec literally. Where the spec is silent, choose the most boring option available.

## Context and goal

Owner runs a small Danish business. Today: invoices made in HurtigFaktura, bookkeeping in an Excel sheet (sales, purchases, quarterly VAT). This app replaces both. One user, self-hosted, reachable only on a private network (Tailscale). The output must be audit-defensible: unbroken invoice number series, immutable issued documents, every row traceable to a stored PDF, five-year retention.

## Non-goals (do not build)

Multi-user/auth beyond a single shared password. Payments, bank integration, NemHandel/OIOUBL e-invoicing, EAN. Multi-currency (DKK only). A double-entry posting engine (a flat mini-kontoplan and derived finance views ARE in scope — see Finance views). Email sending (PDFs are downloaded and sent manually). Mobile apps.

## Stack and deployment

TypeScript full-stack, SvelteKit (or Next.js if you judge it materially more reliable for one-pass generation, but pick one and commit). SQLite via Drizzle ORM, WAL mode, single file at `/data/app.db`. Uploaded and generated PDFs stored on disk under `/data/files/`, never in the DB. Server-side PDF generation of invoices from an HTML template via headless Chromium (Playwright). One Dockerfile producing a single container; `/data` is the only volume. `docker compose up` with the provided compose file must yield a working app on port 3000. A single env var `APP_PASSWORD` gates everything behind one login form with a session cookie. No external services, no telemetry, no CDN assets.

## Data model

- `customer`: id, name, address, zip, city, country (default DK), cvr (nullable), email, created_at.
- `invoice`: id, invoice_number (integer, unique, nullable until issued), status (`draft` | `issued` | `credited`), customer_id, issue_date, due_date, currency (fixed DKK), subtotal_ore, vat_ore, total_ore, vat_rate_bp (default 2500), vat_exempt_reason (nullable text), payment_reference (free text: bank reg/account), paid_date (nullable), pdf_path (nullable), credited_by_invoice_id (nullable), created_at.
- `invoice_line`: id, invoice_id, description, quantity (decimal), unit, unit_price_ore, line_total_ore.
- `expense`: id, voucher_number (integer, unique, assigned on create, sequential from 1), date, supplier, description, category (free text with autocomplete from prior values), amount_ex_vat_ore, vat_ore (manually entered, NOT derived — foreign purchases and repræsentation break the 25% assumption), amount_incl_ore (derived), paid_date (nullable), file_path (nullable), created_at.
- `account`: id, number (integer), name, type (`revenue` | `cost`). Seeded with a fixed mini-kontoplan: 1000 Konsulentydelser, 1100 Andet salg, 1200 Momsfrit salg, 2000 Software og hosting, 2100 Kontorhold, 2200 Repræsentation, 2300 Rejser og transport, 2400 Forsikring og kontingenter, 2500 Revisor og rådgivning, 2600 Markedsføring, 2900 Øvrige omkostninger. Accounts can be added and renamed, never deleted while referenced.
- `invoice_line` additionally carries account_id (revenue accounts only, default 1000).
- `expense.category` is replaced by account_id (cost accounts only); the free-text note stays.
- `cash_movement`: id, date, description, amount_ore (signed: positive = in), kind (`vat_payment` | `owner` | `tax` | `correction` | `other`), created_at. This covers every bank movement that is not an invoice payment or an expense: momsbetalinger, ejerudlæg/hævninger, indskud, corrections. Audit-logged like everything else.
- `budget_line`: id, year, month (1-12), account_id, amount_ore, unique(year, month, account_id). One budget per year, accrual basis, edited in place (audit-logged). No versioning, no reforecasts.
- `audit_log`: id, timestamp, entity, entity_id, action, detail_json. Append-only; no update or delete path exists in code.
- `setting`: key/value. Holds: company name, address, CVR, bank details, next_invoice_number (default 1001), moms registration flag, opening_balance_ore + opening_balance_date (the bank balance the cash view counts from).

All money is stored as integer øre. Rendering formats as `1.234,56 kr.`

## Core rules (these are the audit spine — get them exactly right)

1. **Numbering.** Invoice numbers are assigned only at the moment of issuing, from `next_invoice_number`, inside the same transaction that flips status to `issued`. Drafts have no number. Deleting drafts is allowed; deleting issued invoices is impossible (no endpoint, no SQL path). Result: the issued series has no gaps, ever.
2. **Immutability.** Once issued, an invoice and its lines are read-only. The only correction mechanism is a credit note: a new invoice with negated line amounts, its own number from the same series, referencing the original; the original's status becomes `credited`. Enforce read-only in the API layer, not just the UI.
3. **Legal invoice fields.** The generated PDF must contain: the word "Faktura" (or "Kreditnota"), invoice number, issue date, seller name + address + CVR, buyer name + address (+ CVR if set), per line: description, quantity, unit, unit price ex VAT, line total; then subtotal ex VAT, VAT rate and VAT amount as separate figures, total incl. VAT, payment terms/due date, payment reference. If `vat_exempt_reason` is set, VAT is 0 and the reason text is printed on the invoice (e.g. "Omvendt betalingspligt, jf. momslovens § 46").
4. **PDF archival.** Issuing generates the PDF and writes it to `/data/files/invoices/{number}.pdf`. This file is the legal artifact; regeneration is not offered for issued invoices. Expense uploads land in `/data/files/expenses/{voucher_number}.{ext}` (accept pdf/jpg/png).
5. **VAT report.** Per calendar quarter, computed live from data: salgsmoms (sum of vat_ore on issued invoices by issue_date, credit notes netting out), købsmoms (sum of expense vat_ore by date), momstilsvar (difference). Shown per quarter with the three figures matching the fields on skat.dk's momsangivelse.
6. **Audit log.** Every create/issue/credit/edit/upload writes an audit_log row.

## Finance views (no double-entry — the rows ARE the journal)

There is no posting engine. Invoices, expenses, and cash movements are the source records; resultat, cashflow, and balance are queries over them. Two bases coexist deliberately: P&L and the VAT report run on accrual dates (issue_date / expense date), the cash views run on paid_date and movement date.

- **Resultat (P&L).** Per year with quarter filter: revenue per revenue account (issued invoices ex VAT, credit notes netting out), costs per cost account (expenses ex VAT), resultat før skat. Accrual basis.
- **Cashflow.** One row per month: ind (invoice totals incl. VAT by paid_date, plus positive movements), ud (expense totals incl. VAT by paid_date, plus negative movements), net, and a running bank position starting from the opening balance. Below it, "forventet": open issued invoices grouped by due month.
- **Balance (forenklet).** Computed live: Likvider (opening balance + all cash flows to date), Debitorer (open issued invoices incl. VAT); against that Kreditorer (unpaid expenses incl. VAT) and Skyldig moms (accrued momstilsvar for all quarters to date minus `vat_payment` movements); nettoposition at the bottom. A position statement, not an årsregnskab.
- **Budget.** Grid per year: accounts as rows, 12 months as columns, totals row showing budgeted resultat. Fill helpers: spread an annual figure flat across months, copy previous year's budget, or seed from previous year's actuals. Resultat gains budget and variance columns (actual, budget, difference) at month/quarter/YTD level, for any year with a budget — past years included.
- **Forecast blending.** For future months, Cashflow blends known data with budget: open issued invoices by due month where they exist, budgeted revenue and costs (incl. estimated VAT at 25%) for the rest, producing a running projected bank position through year-end. Balance shows projected Likvider at 31/12 from the same blend, and the VAT report shows estimated tilsvar for future quarters from budgeted figures, clearly marked as estimates. Simplifying assumption, stated in the UI: budgeted amounts are treated as paid in-month — no payment-lag modeling.
- **Afstemning.** On the balance screen, a reconcile action: the user types the actual bank balance from their bank; if it differs from Likvider, the app offers to book a `correction` movement for the difference, audit-logged with the entered figure. This monthly ritual is what keeps the cash views honest.

## Screens

- **Dashboard:** unpaid invoices (with overdue highlighted, due_date < today and no paid_date), current quarter VAT position, totals YTD.
- **Invoices:** table (number, date, customer, total, status, paid), filter by status/year. New draft → line editor with live totals → "Udsted" button with a confirm step stating the number about to be consumed → PDF download. "Markér som betalt" sets paid_date. "Opret kreditnota" on issued invoices.
- **Expenses:** table + create form with file upload; row click shows the stored file inline.
- **VAT report:** quarter selector, three figures, plus a drill-down list of the rows behind each figure.
- **Customers:** plain CRUD (edits do not touch issued invoice PDFs).
- **Resultat / Cashflow / Balance / Budget:** the four finance views above. Cash movements are created from the Cashflow screen (small inline form: date, description, amount, kind). The dashboard additionally shows YTD resultat vs budget when a budget exists for the current year.
- **Settings:** company details, bank details, opening balance, kontoplan management (add/rename accounts), next invoice number (editable only upward, change is audit-logged).
- **Export:** one button producing a zip: `invoices.csv`, `invoice_lines.csv`, `expenses.csv`, `cash_movements.csv`, `accounts.csv`, `budget.csv`, `audit_log.csv` (UTF-8, semicolon-separated, Danish decimal comma) plus all files under `/data/files/`. This is the "hand the auditor everything" artifact.

UI text in Danish. No component library.

## Design assets (mandatory)

The repo root contains three files: `tokens.css`, `style.md`, `example.html`. Before writing any UI, assert all three exist and halt with an error if not. They are the design authority:

- `tokens.css` is loaded globally and is the only place colors, type scale, spacing, radii, borders, and shadows are defined. Every stylesheet you write references these custom properties; no hardcoded hex values, px spacing outside the scale, or ad hoc font sizes anywhere.
- `style.md` governs layout, table density, forms, status badges, the primary "Udsted" action, and the print rules for the invoice PDF template. Where this spec and style.md both speak, style.md wins on visuals, this spec wins on behavior.
- `example.html` is the reference implementation of the patterns. Copy its markup structure and class conventions for tables, forms, badges, and buttons rather than inventing parallel ones.

The invoice PDF template uses the same tokens under the print rules from style.md.

## Process (how you work, not just what you build)

**Version control.** `git init` immediately. Work in small vertical slices (schema → invoicing → expenses → VAT → export → polish), and commit after each slice passes its own tests: small, working commits with imperative messages stating what now works. Never commit broken state, never squash the history, and never push — no remote gets configured at all.

**Build/test/verify loop.** Each slice follows the same loop: implement, write or extend the tests that cover it, run the full suite, run the app and exercise the slice by hand (curl or Playwright), then commit. A slice is not done because it compiles; it is done because its behavior was observed.

**Subagents.** Use separate subagents with fresh context for review, so the reviewer does not inherit the builder's assumptions:

1. **Spec reviewer** — reads the diff and the running behavior against this SPEC only, and reports violations with file/line references. Runs after the invoicing slice (the audit spine) and again before final.
2. **Design reviewer** — after seeding, uses Playwright to screenshot every screen at 1440px width plus the issued-invoice PDF (rendered to image), saves them under `/review/shots/`, and judges them against `tokens.css`, `style.md`, and `example.html`: token violations, off-scale spacing, pattern drift from example.html, print-rule breaks. Writes findings to `/review/REVIEW.md`.
3. **Quality reviewer** — checks general engineering practice: input validation, transaction boundaries around numbering, error handling, no secrets in code, dependency sanity.

Findings become fix tasks for the builder; re-run the relevant reviewer after fixing. The loop ends only when a full review pass produces zero findings, and that final REVIEW.md (with the passing shots) is committed.

## Definition of done (all falsifiable — verify each before declaring done)

1. `docker compose up` from a clean checkout starts the app; login with `APP_PASSWORD` works; all screens render with an empty DB.
2. A seed script (`npm run seed`) creates the owner's settings incl. opening balance, 3 customers, 5 issued invoices (one VAT-exempt with reason, one credited), 8 expenses with dummy files, 4 cash movements incl. one `vat_payment` and one `owner` draw, and a full-year budget for the current year.
3. Automated tests (run in CI-less `npm test`) prove: (a) issuing assigns strictly sequential numbers under 10 concurrent issue requests — no gap, no duplicate; (b) any mutation attempt on an issued invoice via the API returns 409; (c) VAT report on the seed data equals hand-computed expected øre values, credit note included; (d) export zip contains the seven CSVs and every file in `/data/files/`; (e) on seed data, Likvider equals opening balance plus the signed sum of all paid flows and movements, Debitorer equals the sum of open issued invoice totals, Skyldig moms equals accrued tilsvar minus vat_payment movements, and Resultat per account matches hand-computed figures — all as exact øre values; (f) budget variance per account for a past month equals actual minus budget in exact øre, and the projected year-end bank position on seed data matches a hand-computed blend of actuals, open invoices, and remaining budget.
4. An issued invoice PDF from the seed data contains every field in rule 3, verified by extracting the PDF text in a test.
5. Deleting the container and re-running compose with the same `/data` volume shows all data intact.
6. README covers: run, backup (copy `/data`, and a cron example doing an off-box copy — the bookkeeping law expects backups held with a third party), restore, and where the number series lives.
7. `git log` shows one working commit per slice minimum, `git remote -v` is empty, and every commit's message matches what it changed.
8. `/review/REVIEW.md` and `/review/shots/` exist in the final commit, and the last review pass in REVIEW.md records zero open findings from all three reviewers.

If a requirement conflicts with a framework default, the requirement wins. Do not add features beyond this spec.
