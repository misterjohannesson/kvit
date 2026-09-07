# Design review — Faktura (Danish invoicing / bookkeeping app)

| | |
|---|---|
| Date | 2026-09-07 |
| Reviewer | Design reviewer (subagent) |
| App commit | `fac4e17` Add Dockerfile, compose file and README with run, backup, restore and number-series notes |
| Instance | http://127.0.0.1:3102 (seeded review instance) |
| Authority | `tokens.css`, `style.md`, `example.html` (repo root) |
| Viewport | 1440 × 900, DPR 1, headless Chromium (Playwright); one pass at 1152 px |

Method: read the three design files in full; ran `review/shots.ts` (screens 00–14) and an additional `review/shots-extra.ts` (screens 20–29: login error, filtered and empty lists, hover, 404, form validation error, credit-note confirm, paid invoice, 1152 px). Inspected every PNG. Audited `src/app.css`, every `<style>` block in `src/**/*.svelte`, and the PDF template CSS in `src/lib/server/invoice-template.ts` (plus `pdf.ts` for page geometry) for token violations and pattern drift.

Notes on the capture: the embedded PDF `<iframe>` on issued-invoice pages renders as a grey box in headless Chromium (04, 05, 27, 28) — this is a screenshot artefact, not a finding. The seeded database was being mutated by other test runs during capture (invoice count went 7 → 11 between the two scripts), so row contents differ between 02 and 24/29; this does not affect the review.

---

## Screenshots

| File | Screen |
|---|---|
| `shots/00-login.png` | Login |
| `shots/01-dashboard.png` | Overblik (dashboard): KPI strip, unpaid invoices, VAT / YTD panels |
| `shots/02-fakturaer.png` | Fakturaer list, all rows, all years |
| `shots/03-faktura-kladde.png` | Invoice draft editor (8/4 layout) |
| `shots/03b-faktura-udsted-bekraeft.png` | Draft editor with the "Udsted" confirm step open |
| `shots/04-faktura-udstedt.png` | Issued, paid invoice 1001 detail |
| `shots/05-kreditnota.png` | Credit note 1006 detail |
| `shots/06-udgifter.png` | Udgifter list + "Ny udgift" form |
| `shots/07-udgift-bilag.png` | Expense voucher 1 detail (file viewer + edit form) |
| `shots/08-moms.png` | Momsindberetning, 2026 Q3 |
| `shots/09-kunder.png` | Kunder list + "Ny kunde" form |
| `shots/10-kunde.png` | Customer detail (edit form + invoices) |
| `shots/11-indstillinger.png` | Indstillinger |
| `shots/12-eksport.png` | Eksport |
| `shots/13-pdf-faktura-1001.png` | PDF, invoice 1001, page 1 |
| `shots/14-pdf-kreditnota.png` | PDF, credit note 1006, page 1 |
| `shots/20-login-fejl.png` | Login with wrong password (field error state) |
| `shots/21-fakturaer-forfaldne.png` | Fakturaer filtered: Forfaldne |
| `shots/22-fakturaer-kladder.png` | Fakturaer filtered: Kladder — empty state |
| `shots/23-fakturaer-krediterede.png` | Fakturaer filtered: Krediterede (Krediteret + Kreditnota rows) |
| `shots/24-fakturaer-hover.png` | Fakturaer list, row hover (viewport only) |
| `shots/25-fejlside-404.png` | 404 error page |
| `shots/26-udgift-valideringsfejl.png` | "Ny udgift" after submitting an invalid amount |
| `shots/27-faktura-kreditnota-bekraeft.png` | Issued invoice with "Opret kreditnota" confirm open |
| `shots/28-faktura-betalt.png` | Issued, paid, VAT-exempt invoice 1003 detail |
| `shots/29-fakturaer-1152.png` | Fakturaer list at 1152 px (style.md §2 minimum) |

---

## What is fine

Stating this explicitly so the findings below are read in proportion.

- **Tokens.** No raw hex/rgb/oklch colour anywhere in `src/` (grep verified). Every `<style>` block references `--space-*`, `--text-*`, `--radius-*`, `--border-*`, `--control-*` tokens. The only literals are a handful of field widths (finding 13) and viewport-relative iframe heights (`100vh`, `80vh`), which are layout, not scale values.
- **`src/app.css`** is the `example.html` `<style>` block verbatim plus two token-only additions: `.segment > [aria-current="true"]` (so filter links can use `aria-current` instead of `aria-pressed`) and `.btn { white-space: nowrap }`. Diffed line-by-line.
- **Invoice table** (`InvoiceTable.svelte`): column order is exactly `Nr. · Kunde · Udstedt · Forfald · Status · Beløb ekskl. · Moms · Beløb i alt · actions`; horizontal hairlines only; no zebra; overdue rows are not tinted; numeric columns right-aligned mono with tabular figures; krediteret numbers struck through in `Nr.`; `Forfalden` day count is a separate `.badge-note` outside the badge; negative amounts carry U+2212 minus **and** `--text-negative`; totals row has the strong top rule and semibold, no fill; whole row is the click target; hover uses `--bg-row-hover` (24).
- **Badges**: five sanctioned classes present, text always present, sentence case, `--radius-xs`, no icons or pills. Never interactive.
- **One primary per screen**: verified on every screen. In the editor, the footer `Udsted` is hidden while the confirm box shows `Udsted nr. 1007` (03b), so the count stays at one. Issued/credit-note detail pages have no primary, which is correct — nothing on them is a commit action. Footer order (destructive left, secondary, primary right) is right in the editor (03).
- **Udsted confirm copy** follows style.md §6 ("Fakturaen får nummer 1007 og kan herefter kun annulleres med en kreditnota.") and the button is disabled until the draft validates (`canIssue`).
- **Forms**: label above field, `--text-xs` medium labels, hint text below, optional fields marked "(valgfri)" (CVR, EAN-equivalent, E-mail, Betalt, Bilag), amounts right-aligned mono, dates mono. Login error state (20) swaps hint for error and switches the border to `--status-overdue-ink` exactly as §4 prescribes.
- **Layout**: sidebar 224 px, topbar 52 px, content max 1280 px with `--layout-gutter`; only the sanctioned 12, 8/4 and 6/6 splits are used; panels have borders and no shadows; page header = eyebrow → title → right-aligned action. Still usable with no horizontal scroll at 1152 px (29).
- **Typography**: uppercase only on column heads, nav groups and KPI labels (all per example.html); page titles at `--text-2xl`; no bold-for-emphasis in body copy.
- **PDF (13, 14)**: A4 via `page.pdf({ format: 'A4' })` with margins read from `--print-margin-*`; print media emulated so tokens re-point to ink; base 9.5 pt, nothing below 8 pt (eyebrow, column heads, statutory note, footer and page number are all `--print-text-small`); sender block top-left with grouped CVR in mono; `Faktura` / `Kreditnota` at `--text-4xl` top-right with a mono key/value list; line table has the `--print-rule` above and below the header, hairline rows, `thead { display: table-header-group }`, `page-break-inside: avoid` on rows; totals block is right-aligned, 70 mm wide, `page-break-inside: avoid`, total has the rule above and is semibold; footer is `position: fixed; bottom: 0` with payment terms, bank reference and sender CVR, and Chromium's `footerTemplate` prints "Side X af Y" at 8 pt using values read from tokens.css; no backgrounds (`printBackground: false`), no colour — negatives print black with the minus sign; statutory content present (sender name/address/CVR, number, issue date, due date, buyer name/address, description, VAT rate and amount, totals ex./incl. VAT, payment terms, reverse-charge note at 8 pt via `.statutory`). Credit note omits the due date and prints "Kreditnotaen modregnes faktura nr. 1002." — correct.

---

## Findings

Severity: **blocker** (ship-stopping), **major** (visible defect against a mandatory rule), **minor** (rule drift, low impact).

### 1. major — Undefined `field--span-8 / -5 / -2` collapse fields to one grid column

**Evidence:** 06 (Leverandør field ~70 px wide), 09 and 10 (Navn, Adresse, By fields ~70 px; "Berlin S", "Friedricl" truncated), 11 (Firmanavn, Adresse, Postnr., By all ~70 px; "Mit Firm", "Eksemp", "Københ" truncated), 26 ("Test Ap" truncated).
`src/lib/components/CustomerFields.svelte:9,17` (`field--span-8`), `:29` (`field--span-5`); `src/routes/(app)/indstillinger/+page.svelte:24,32` (`span-8`), `:36,40,53` (`span-2`); `src/routes/(app)/udgifter/+page.svelte:100` (`span-5`).
`src/app.css` defines only `.field--span-3/-4/-6/-12` (as does `example.html`).

**Rule:** style.md §4 "Width follows content … names get wide ones"; §2 "Only three column splits are sanctioned"; example.html defines exactly four span classes. An undefined class means `grid-column: auto` = 1 of 12 columns, so name and address fields are the narrowest on the page while CVR and Land (which are defined spans) are wider — the inverse of the rule.

**Fix:** either add `.field--span-2/-5/-8 { grid-column: span N }` to `src/app.css` (pure grid, no token needed) or re-lay the forms using only 3/4/6/12. Suggested: Navn 8 → `span-6`+`span-6`? No — simplest is to add the three classes. Then re-check 09/10/11: Navn and Adresse should be the widest fields, Postnr./By/Land short.

### 2. major — Native `type="date"` inputs render in the browser's locale, not `DD.MM.YYYY`

**Evidence:** 03 (`09/07/2026`, `09/21/2026`), 06 (`09/07/2026`, placeholder `mm/dd/yyyy`), 07 (`04/02/2026`), 26.
`src/lib/components/InvoiceEditor.svelte:112,116`; `src/routes/(app)/udgifter/+page.svelte:98,126`; `src/routes/(app)/udgifter/[id]/+page.svelte:53,81`; `src/routes/(app)/fakturaer/[id]/+page.svelte:99`.

**Rule:** style.md §1.3 "Dates are `DD.MM.YYYY` in mono." example.html uses a text `input.input--date` with the value `07.09.2026`. The `<html lang="da">` in `app.html` does not influence Chromium's date-control format; it follows the browser UI locale, so the app cannot guarantee the mandated format. The native control also injects a calendar icon that the design system does not have. In a `da-DK` browser this will usually show `dd.mm.åååå`, so severity depends on the environment — but the rule is mandatory and the app has no control over it.

**Fix:** use `type="text" inputmode="numeric"` with the `.input.input--date` classes, display `formatDate(iso)` and parse `DD.MM.YYYY` (and ISO) server-side, as the other numeric fields already do with `parseKrToOre`. Keep the field at 130 px.

### 3. minor — Expense form validation is a panel-level message, not the §4 field error pattern

**Evidence:** 26. The message "Ugyldigt beløb i amountExVat: abc" appears at the top of the panel; the offending field keeps its default border and its hint. The message leaks the internal field name.
`src/routes/(app)/udgifter/+page.svelte:92–94`; message from `src/lib/server/expense-form.ts:16`.

**Rule:** style.md §4 "Error text replaces [helper text] in `--text-negative`, with the border switched to `--status-overdue-ink`." example.html `.field--error` + `.error` pattern (lines 782–786).

**Fix:** return per-field errors from the action (`{ errors: { amountExVat: 'Ugyldigt beløb' } }`), add `field--error` on the field and render `<span class="error">` in place of the hint. Use the Danish label ("Beløb ekskl. moms") in the message. The login page already does this correctly (20) — reuse that pattern.

### 4. minor — Sixth badge label `Kreditnota`: acceptable extension, but style.md §5 must be amended

**Evidence:** 02, 05, 23. `src/lib/format.ts` (`InvoiceStatusLabel` type and the `isCreditNote` branch of `invoiceStatus`, lines 97 and 105 at time of review — the file was being edited concurrently) returns `{ label: 'Kreditnota', cls: 'badge--krediteret' }` for the credit-note document itself.

**Judgement:** style.md §5 says "Five states" and lists `Krediteret` = "credit note issued" (a state of the *original* invoice). The credit note document needs its own status cell; showing it as `Åben`/`Betalt` would be wrong, and leaving it blank would break the "text label always present" rule. The app reuses the `--status-credited-*` tokens (no new colour), sentence case, one word, no icon — every construction rule in §5 is satisfied, and the `Kunde` cell-sub "Kreditnota til 1002" plus the negative amounts disambiguate it from `Krediteret`. **Verdict: an acceptable extension, not a violation of the badge construction rules** — but it is currently undocumented drift from the "five states" sentence. It is a document type sitting in a status column, which is worth a conscious decision rather than an accident.

**Fix:** add a sixth row to style.md §5 (`Kreditnota` · the credit-note document itself · `--status-credited-*`) and a `badge--kreditnota` alias (or keep `badge--krediteret`) in example.html/app.css so the pattern file and the app agree. If the team prefers strict five states, render credit notes with `Krediteret` and rely on the cell-sub — but the current label is clearer.

### 5. minor — Badge inherits monospace when placed inside `.panel__meta`

**Evidence:** 04, 05, 27, 28 — the `Betalt` / `Kreditnota` / `Åben` badge in the panel head renders in the mono font, unlike the same badge in tables. `src/routes/(app)/fakturaer/[id]/+page.svelte:40` wraps `<Badge>` in `<span class="panel__meta">`, whose `font-family: var(--font-numeric)` cascades into `.badge` (which sets no font-family).

**Rule:** style.md §1 — mono is for numbers, dates and IDs only; badges are UI text. example.html badges are always in UI font.

**Fix:** render the badge directly in `.panel__head` (drop the `.panel__meta` wrapper) or add `font-family: var(--font-ui)` to `.badge` in app.css/example.html so it is immune to the cascade.

### 6. minor — IDs / rates / dates outside the mono font or in the wrong format

**Evidence & files:**
- 04: "CVR 38412207" in the customer cell-sub is UI font and ungrouped. `src/routes/(app)/fakturaer/[id]/+page.svelte:44`. (The PDF groups it "38 41 22 07" — the UI should match.)
- 04, 05, 28: VAT rate "25 %" in the facts list is UI font. `src/routes/(app)/fakturaer/[id]/+page.svelte:51`.
- 10: panel meta "Oprettet 2026-09-07" is ISO, not `DD.MM.YYYY`. `src/routes/(app)/kunder/[id]/+page.svelte:23` (`c.createdAt.slice(0, 10)`).

**Rule:** style.md §1 table: `--font-numeric` is **mandatory** for amounts, dates, invoice numbers, CVR, VAT rates; §1.3 dates `DD.MM.YYYY`.

**Fix:** wrap CVR and the rate in `<span class="mono">`, group CVR as `12 34 56 78`, and use `formatDate(c.createdAt.slice(0,10))`.

### 7. minor — `Eksportér alt (zip)` uses the primary style for a non-commit action

**Evidence:** 12. `src/routes/(app)/eksport/+page.svelte:13` — `btn btn--primary`.

**Rule:** style.md §6: primary is for the page's main *commit* action ("Udsted, Bogfør, Indberet moms") and "must read as gravity"; "Everything reversible" is secondary. Downloading a zip changes nothing and is fully reversible. The count is one per screen, so this is a semantics issue, not a count violation.

**Fix:** make it `class="btn"`. (Login's `Log ind`, Kunder's `Opret kunde`, Udgifter's `Bogfør udgift` and Indstillinger's `Gem indstillinger` are defensible as each page's single commit; see finding 8 for their height.)

### 8. minor — Every primary is rendered at `--control-height-lg`

**Evidence:** 00, 09, 10, 11 — `Log ind`, `Opret kunde`, `Gem`, `Gem indstillinger` are all 38 px. `src/app.css` `.btn--primary { height: var(--control-height-lg) }` (inherited verbatim from example.html, which only shows `Udsted`).

**Rule:** style.md §6: "`--control-height-lg` when it is the page's main commit action (`Udsted`, `Bogfør`, `Indberet moms`), otherwise `--control-height`." Saving a customer record or settings is not in that class; `Gem` on 10 is a plain save yet outweighs `Slet kunde`.

**Fix:** add a size modifier to example.html/app.css (e.g. `.btn--primary.btn--std { height: var(--control-height); padding: 0 var(--control-pad-x) }`) and apply it to `Log ind`, `Opret kunde`, `Gem`, `Gem indstillinger`. Keep `Udsted` and `Bogfør udgift` at lg.

### 9. minor — Dashboard panel sums use `--text-3xl`

**Evidence:** 01 — "Momstilsvar 1.245,20 kr." and "Resultat 78.855,80 kr." at 28 px, in addition to four 28 px KPI figures on the same screen. `src/routes/(app)/+page.svelte:70,85` reuse `.totals__row--sum`, whose `dd` is `--text-3xl` (intended for the invoice summary "I alt").

**Rule:** style.md §1: "`--text-3xl` KPI figures and the invoice grand total — the only places large type is allowed."

**Fix:** add a `.totals__row--sum.totals__row--sum-sm dd { font-size: var(--text-lg) }` variant (card sub-totals are `--text-lg` per §1) and use it on the dashboard panels; or drop the Momstilsvar panel since the KPI strip already shows the figure.

### 10. minor — Empty states lack the one secondary button

**Evidence:** 22 ("Ingen fakturaer." only). `src/lib/components/InvoiceTable.svelte:51`; also `src/routes/(app)/kunder/+page.svelte:33`, `src/routes/(app)/udgifter/+page.svelte:49`, `src/routes/(app)/moms/+page.svelte:71,110`.

**Rule:** style.md §3: "Empty state: single centred line at `--text-sm` / `--text-secondary` plus one secondary button."

**Fix:** accept an `emptyAction` slot/prop and render e.g. `<a class="btn btn--sm" href="/fakturaer">Vis alle</a>` (filtered lists) or "Ny faktura" / "Ny kunde" / "Ny udgift" (unfiltered lists). The centred line itself is correctly styled.

### 11. minor — No `Kompakt` density toggle

**Evidence:** 02 toolbar has status and year segments and a row count, but no Normal/Kompakt segment. `src/routes/(app)/fakturaer/+page.svelte:45–59`. The dense variant CSS exists (`table.data--dense`) and is used for line items.

**Rule:** style.md §3: "a per-user **Kompakt** toggle switches to `--table-row-height-dense`." example.html toolbar lines 624–627.

**Fix:** add the segment to the toolbar (persist in a cookie/localStorage) and toggle `data--dense` on `InvoiceTable`, `Udgifter` and `Kunder` tables.

### 12. minor — Credit-note confirm wraps and breaks footer button order

**Evidence:** 27 — the confirmation sentence, `Annullér` and `Opret kreditnota 1015` sit in one flex-wrap row inside `.panel__foot`; the destructive button wraps to a second line, bottom-left, under the text, with `Annullér` above-right of it. `src/routes/(app)/fakturaer/[id]/+page.svelte:87–91`, `.confirm` at `:146`.

**Rule:** style.md §6: "Order in a footer: destructive far left, then secondary, primary rightmost" and §2 vertical rhythm. Also inconsistent with the editor's `.confirmbox` pattern (03b), which handles the same situation cleanly.

**Fix:** reuse the `.confirmbox` block (title, hint, right-aligned actions) inside the panel body, or put the sentence on its own line above a right-aligned button row. Note that `Opret kreditnota` should stay a `btn--danger` (never red fill) — it does.

### 13. minor — Raw pixel widths in component CSS

**Evidence:** `src/lib/components/InvoiceEditor.svelte:235–237` (`.input--qty`, `.input--unit` 90px; `.input--price` 130px); `src/routes/(app)/udgifter/[id]/+page.svelte:95` (`.input--file` 260px).

**Rule:** style.md intro: "Component CSS must not contain raw colour, size, or spacing literals." Mitigating: example.html itself uses `max-width: 130px` for `.input--date` / `.input--short` and an inline `220px`, so 130 px has precedent; 90 px and 260 px are new literals.

**Fix:** add `--field-width-xs: 90px; --field-width-sm: 130px; --field-width-md: 260px` to tokens.css §5 and reference them (also from example.html's `.input--date/--short`). No visual change.

### 14. minor — PDF total digits are not on the shared right edge

**Evidence:** 13, 14 — "58.500,00 DKK": the digits end ~10 mm left of the right edge that every other amount (line items, subtotal, VAT) shares, because the currency suffix is appended inside the same `dd`. `src/lib/server/invoice-template.ts:210` (`${amount(inv.totalOre)}<span class="currency">DKK</span>`), `:142`.

**Rule:** style.md §7: "Amounts right-aligned to a shared edge with the line-item amounts." (§1.1 wants the currency suffix in `--text-secondary`, never bold — that part is correct.)

**Fix:** move the currency into the label ("I alt inkl. moms, DKK") or render the totals as a three-column grid (label · amount · unit) so the amount column keeps the shared edge. The same `.currency` treatment could then be applied to subtotal/VAT if wanted.

### 15. minor — First settings fieldset has no gap between legend and fields

**Evidence:** 11 — "Firmaoplysninger" sits directly on top of the "Firmanavn / CVR-nummer" labels. `src/routes/(app)/indstillinger/+page.svelte:87` `fieldset.first { border-top: 0; padding-top: 0; }` removes the `--space-6` that `fieldset` normally carries.

**Rule:** style.md §2: "`--space-6` between a heading and its content."

**Fix:** keep `border-top: 0` but restore `padding-top: var(--space-6)` (or `--space-4` if the panel padding already contributes), so the legend behaves like the other two fieldsets on the same page.

### 16. minor — Pattern CSS duplicated across route files instead of living in `app.css`

**Evidence:** `.layout-6-6` (dashboard `+page.svelte:92`, `moms/+page.svelte:135`), `.empty` (InvoiceTable, kunder, moms, udgifter), `.rowlink` (3 files), `.segment__link` (3 files), `.formerror` (3 files), `.input--wide` (2 files), `.input--file` (2 files).

**Rule:** example.html is "the pattern reference … copy blocks as needed"; app.css says it is that block "ported verbatim". Patterns that the app needs and the reference lacks (6/6 split — sanctioned by §2 — empty-state cell, link-segments, clickable rows) should be added once to example.html and app.css so the reference stays the single source of truth and the four copies cannot drift.

**Fix:** move the seven rules into `src/app.css` under "app additions (tokens only)" and mirror them in example.html; delete the per-file copies.

### 17. minor — PDF grand total size is unspecified by §7 and does not follow §1

**Evidence:** 13, 14 — "58.500,00" at `--text-lg` (16 px ≈ 12 pt). `src/lib/server/invoice-template.ts:141`.

**Rule tension:** style.md §1 says `--text-3xl` is for "KPI figures and the invoice grand total"; §7 only says the total "gets a `--print-rule` above and `--weight-semibold`". At 9.5 pt body, 28 px (21 pt) would dominate an A4 page, so the template's choice is sensible — but it is a deviation from the letter of §1.

**Fix:** resolve in style.md rather than in code: state in §7 that the printed total is `--text-lg` semibold (or add a `--print-text-total` token). No code change recommended.

---

## Observations (not counted as findings)

- The `Forfaldent` KPI is red without a minus sign (01). This matches example.html exactly (`kpi__value--neg` on a positive overdue total), so it is not a deviation; but note that §1.2 "never colour alone" is written for negative amounts, and this KPI is a positive amount coloured for urgency. If the team wants strict §1.2, the reference should change first.
- The `.select` in the page header of 02 ("Vælg kunde…") has no chevron because example.html sets `appearance: none; background-image: none`. It reads as a text input. This is a reference-level choice, not an app defect.
- style.md §7 asks for "delivery date if different". The data model has no delivery date, so the PDF cannot be non-compliant, but the field is absent from both editor and document.
- Row click handlers (`onclick` on `<tr>`) are mouse-only; keyboard users still reach the row via the "Vis" ghost link, which is acceptable.
- `styles` in `+error.svelte` use `--text-xl` for the h1 (25). Fine for an error card; not a page title.

---

## Open findings: 17

- blocker: 0
- major: 2 (findings 1, 2)
- minor: 15 (findings 3–17; finding 4 is a documentation decision, finding 17 is a style.md clarification)

---

# Pass 2

| | |
|---|---|
| Date | 2026-09-08 |
| App commit | `7301efe` Align PDF totals with line-item amounts by moving the currency into the total label (on top of `51dc7a8` Fix review findings …) |
| Authority | `tokens.css`, `style.md`, `example.html` as amended additively after pass 1 (`--field-width-xs/-sm/-md`; §4 spans 2/3/4/5/6/8/12; §5 sixth badge `Kreditnota`; §6 `btn--std`; §7 printed total at `--text-lg`, currency must not push digits off the shared edge; example.html gained `.field--span-2/-5/-8`, `.input--xs/--md/--wide`, `.badge--kreditnota`, `.btn--primary.btn--std`, `.layout-6-6`, `.totals__row--sum-sm`, `.empty`, `.rowlink`, link/form segments, `.confirmbox`, `.formerror`, and `.badge { font-family: var(--font-ui) }`) |
| Instance | http://127.0.0.1:3102 (seeded review instance) |
| Viewport | 1440 × 900, DPR 1, headless Chromium; one pass at 1152 px |

Method: re-read the three amended design files and `git diff fac4e17..HEAD` for them; regenerated **all** screenshots with `review/shots.ts` (00–14) and an updated `review/shots-extra.ts` (20–36; date inputs are now text inputs, the credit-note confirm is a `.confirmbox`, the expense form has per-field errors, a Normal/Kompakt segment exists), and inspected every PNG. Re-audited `src/app.css`, every `<style>` block in `src/**/*.svelte` and the PDF template CSS in `src/lib/server/invoice-template.ts`. Where a screenshot was ambiguous, computed styles were read with `review/measure.ts` (density-segment borders, `td.empty` alignment, line-item input widths at 1440/1152 px, badge font, disabled-primary colour after a failed save).

Capture notes: the grey PDF `<iframe>` box on 04/05/27/28 is still the headless-Chromium artefact. The seeded database was again mutated by concurrent test runs (sidebar counts 7 → 24 between 02 and 34); row contents differ between screenshots but nothing in this review depends on them. The tiny broken image in 36 is the seeded 1-px PNG voucher, not a rendering fault.

## New screenshots

| File | Screen |
|---|---|
| `shots/30-faktura-kladde-1152.png` | Draft editor at 1152 px |
| `shots/31-fakturaer-kompakt.png` | Fakturaer with the Kompakt density selected |
| `shots/32-udgifter-kompakt.png` | Udgifter with the Kompakt density selected |
| `shots/33-fakturaer-toolbar-zoom.png` | Toolbar crop: status/year link segments, Normal/Kompakt form segment |
| `shots/34-faktura-kladde-datofejl.png` | Editor after `Gem kladde` with an invalid Fakturadato (field error) |
| `shots/35-kunde-tom.png` | Customer without invoices: empty state with its secondary button |
| `shots/36-udgift-bilag-fejl.png` | Expense detail after `Gem` with an invalid amount (field error in the stacked form) |

All 00–29 files were regenerated as well and reflect commit `7301efe`.

## Status of the 17 pass-1 findings

| # | Sev. | Finding (short) | Status | Evidence |
|---|---|---|---|---|
| 1 | major | Undefined `field--span-8/-5/-2` collapsed fields | **Fixed** | 06 (Leverandør span-5), 09/10/35 (Navn, Adresse span-8 widest; CVR/Land span-4; Postnr. 3, By 5), 11 (Firmanavn/Adresse wide, Postnr./By span-2). Classes defined in example.html and app.css; no truncation anywhere. |
| 2 | major | Native `type="date"` in browser locale | **Fixed** | 03, 06, 07, 27, 28, 30: text inputs `input--date`, mono, `--field-width-sm`, values `07.09.2026`, placeholder `dd.mm.åååå`, `inputmode="numeric"`; parsed server-side by `parseDateInput` (`src/lib/format.ts:68`). Invalid input yields the §4 field error (26, 34). |
| 3 | minor | Expense validation was a panel-level message | **Fixed** | 26 (Dato: red border, "Ugyldig dato – brug dd.mm.åååå" replaces hint), 36 (Beløb: "Ugyldigt beløb – brug fx 1.234,56"). Danish labels, no internal field names. `expense-form.ts` returns `{ fields }`; both expense pages render `field--error` + `.error`. Residual: validators stop at the first error — see new finding N4. |
| 4 | minor | Sixth badge `Kreditnota` undocumented | **Accepted (rule amended)** | style.md §5 has the sixth row and the "document type in the status column" note; example.html/app.css define `.badge--kreditnota`; `format.ts:142` returns it. 02, 05, 23. |
| 5 | minor | Badge inherited mono inside `.panel__meta` | **Fixed** | 04, 05, 27, 28: badge in UI font. `.badge { font-family: var(--font-ui) }` in example.html and app.css; the wrapper was also dropped (`Badge` sits directly in `.panel__head`). Computed: `"Helvetica Neue", Helvetica, …`. |
| 6 | minor | CVR / VAT rate / created date outside mono or format | **Fixed** | 04: "CVR 38 41 22 07" grouped, mono (`formatCvr`); "25 %" mono (04, 05, 27); 10/35: "Oprettet 07.09.2026". |
| 7 | minor | `Eksportér alt (zip)` styled primary | **Fixed** | 12: plain `.btn`. Page now has no primary, which is correct (no commit action). |
| 8 | minor | Every primary at `--control-height-lg` | **Fixed** | 00/20 `Log ind`, 07/36 `Gem`, 09 `Opret kunde`, 10/35 `Gem`, 11 `Gem indstillinger` at 32 px via `btn--std`; `Udsted` (03) and `Bogfør udgift` (06) stay 38 px. style.md §6 documents the modifier. |
| 9 | minor | Dashboard panel sums at `--text-3xl` | **Fixed** | 01: Momstilsvar / Resultat at `--text-lg` via `.totals__row--sum-sm`; only the four KPI figures remain large. |
| 10 | minor | Empty states lacked the secondary button | **Fixed** | 22 ("Ingen fakturaer matcher filteret." + `Vis alle`), 35 ("Ingen fakturaer til denne kunde." + `Ny faktura`); kunder, udgifter, moms and dashboard empties carry a button in markup (`emptyAction` prop on `InvoiceTable`). The line itself is no longer centred — see new finding N2. |
| 11 | minor | No Kompakt density toggle | **Fixed** | 02/06 (Normal/Kompakt segment right of the toolbar spacer), 31/32 (30 px rows), cookie `faktura_density` via `/density`; also applied to the dashboard, customer and VAT tables. Segment construction drift — see N1. |
| 12 | minor | Credit-note confirm wrapped, broke footer order | **Fixed** | 27: `.confirmbox` (title, hint with mono numbers, right-aligned Annullér + `Opret kreditnota 1007` as `btn--danger`) in the summary panel; footer keeps the disabled destructive button far left and the paid-date form right. Same pattern as the editor's confirm (03b). |
| 13 | minor | Raw pixel widths in component CSS | **Fixed** | tokens.css `--field-width-xs/-sm/-md`; `.input--xs/--short/--date/--md` in example.html + app.css; the InvoiceEditor and udgifter `<style>` blocks contain no literals any more (grep: zero px/rem/pt literals in any Svelte `<style>`). 03: qty/unit 89 px, price 130 px measured. |
| 14 | minor | PDF total digits off the shared right edge | **Fixed** | 13, 14: label "I alt inkl. moms, DKK", `58.500,00` / `−15.000,00` end on the same edge as the line-item amounts and subtotal/VAT. (Wording note: §7 now says the currency "sits in its own column"; the template puts it in the label. Same effect; see observations.) |
| 15 | minor | First settings fieldset had no legend gap | **Fixed** | 11: "Firmaoplysninger" has `--space-6` above the first row; `fieldset.first` now only removes the top rule. |
| 16 | minor | Pattern CSS duplicated across route files | **Fixed** | `.layout-6-6`, `.empty`, `.rowlink`, segment link/form rules, `.formerror`, `.input--wide`, `.totals__row--sum-sm`, `.confirmbox` live once in example.html and app.css; per-file copies removed. Remaining `<style>` rules are page-specific (`.facts`, `.paidform`, `.pdfhint`, `.stack`, `.imgwrap`, `.input--file` padding, `.kpis--3`, `.prose`, `.wrap`, `.input--cell`, `.addline`, `.summaryhint`, `.problems`, `fieldset.first`, login/error shells). The move changed `.empty`'s specificity — see N2. |
| 17 | minor | PDF grand total size unspecified | **Accepted (rule amended)** | style.md §7 now states `--text-lg` semibold for the printed total; template `.totals .row--sum dd { font-size: var(--text-lg) }`. 13, 14. |

Tally: 15 fixed, 2 accepted with the rule amended, 0 not fixed.

## CSS source audit (pass 2)

- **Raw colour**: none in `src/` (`#hex`, `rgb()`, `oklch()`, `hsl()` grep is empty outside `tokens.css`).
- **Size literals**: none left in any Svelte `<style>` block (pass 1 had four). `src/app.css` still carries the four reference literals inherited verbatim from example.html (`.brand__mark` 10 px, `.check input` 14 px, `.col-status` 152 px, `@media (max-width: 1100px)`) plus `.textarea min-height: 64px` and `.badge line-height: 1.2` — reference-level choices, not app drift. The two "app additions" (`.btn { white-space: nowrap }`, `.pdfframe/.fileframe` with `100vh`/`80vh`) are unchanged and token-only apart from the viewport heights.
- **PDF template**: tokens only, plus `70mm` (the §7 maximum) and two layout percentages (`.sender max-width: 50%`, `td.desc width: 46%`). Footer template values are read from tokens.css.
- **Undefined classes**: every class used in `src/**/*.svelte` resolves to app.css or the component's own `<style>`; the dynamic badge classes from `format.ts` (`badge--kladde/aaben/forfalden/betalt/krediteret/kreditnota`) all exist. `aria-current` (link segments) and `aria-pressed` (form segment) are both styled.
- **app.css vs example.html**: the shared block is identical (diffed); no new deviations.

## New findings (pass 2)

Severity scale as in pass 1. All six are minor; four are side effects of pass-1 fixes.

### N1. minor — Density segment: first visible button carries a hairline left border

**Evidence:** 33 (toolbar crop; the extra hairline is `--grey-100`, so it reads as a slightly heavier left edge on `Normal` than on `Alle`), computed style: `button[value=normal]` `border-left: 1px oklch(0.936 0.005 250)`, whereas the first link in the status segment has `0px`. `src/lib/components/DensityToggle.svelte:8–10` — the `<input type="hidden" name="back">` is the segment's first child, so `.segment > *:first-child { border-left: 0 }` lands on the hidden input and the first button keeps its hairline.

**Rule:** example.html segment construction (one outer `--border-default-style`, hairlines only *between* items).

**Fix:** move the hidden input after the buttons, or add `.segment > input[type=hidden] + * { border-left: 0 }` to example.html/app.css. Token-free, no visual change elsewhere.

### N2. minor — Empty-state line is left-aligned with cell padding (regression from finding 16's fix)

**Evidence:** 22, 35: "Ingen fakturaer matcher filteret. Vis alle" and "Ingen fakturaer til denne kunde. Ny faktura" sit at the left edge of the table with 8 px vertical padding. Computed on `td.empty`: `text-align: left; padding: 8px 12px`. In pass 1 `.empty` was Svelte-scoped (`.empty.svelte-xxxx`, specificity 0,2,0) and won; in app.css `.empty` (0,1,0) loses to `table.data th, table.data td` (0,1,2), which sets `text-align: left` and the cell padding.

**Rule:** style.md §3 "Empty state: single centred line at `--text-sm` / `--text-secondary` plus one secondary button."

**Fix:** in example.html and app.css write the rule as `table.data td.empty { text-align: center; padding: var(--space-6) var(--table-cell-pad-x); }` (or `.empty` with `text-align: center !important` — the former is cleaner). Affects InvoiceTable, kunder, udgifter and both moms tables.

### N3. minor — Line-item quantity input clipped at 1152 px

**Evidence:** 30: the Antal cell shows `1,0` with the last digit cut. Measured widths at 1152 px: Antal 41 px (`scrollWidth` 45 > `clientWidth` 39), Enhed 49 px, Pris 115 px; at 1440 px they are 89 / 89 / 130 px as designed. `src/lib/components/InvoiceEditor.svelte` `.input--cell` is `width: 100%` inside an auto-layout table, so the percentage-width inputs have no min-content width and the Beskrivelse column takes the slack.

**Rule:** style.md §2 "usable from 1152px"; §4 quantities and units get `--field-width-xs`, amounts `--field-width-sm`.

**Fix:** give the three numeric `<td>`s a width (e.g. `table.lines td.col-xs { width: var(--field-width-xs) } td.col-sm { width: var(--field-width-sm) }`) or set `min-width: var(--field-width-xs)` on `.input--xs` and `min-width: var(--field-width-sm)` on `.input--short` in example.html/app.css. Token-only.

### N4. minor — Validators fail fast, so only one field error shows per submit

**Evidence:** 26: Dato `31.02.2026` is flagged but Beløb `abc` in the same submission keeps its default border; the amount error appears only after the date is corrected and the form resubmitted. `src/lib/server/expense-form.ts:24–49` and `src/lib/server/invoice-form.ts:53` `throw` on the first invalid field.

**Rule:** style.md §4 error pattern is per field ("Error text replaces [helper text] … the message is always present"); a fail-fast validator makes the user submit once per mistake.

**Fix:** collect `{ field: message }` for every field, then throw one `badRequest` with the full `fields` map; the pages already render every key in `form.fields`.

### N5. minor — Editor shows the same error twice (form-level line and field error)

**Evidence:** 34: `.formerror` "Fakturadato: ugyldig dato – brug dd.mm.åååå" above the grid **and** "Ugyldig dato – brug dd.mm.åååå" under the field (computed: two `.error` elements with the same message). `src/lib/components/InvoiceEditor.svelte` renders `{#if error}` unconditionally; the udgifter pages already guard with `form?.error && !form?.fields`.

**Rule:** style.md §4 — the field message replaces the helper text; a second copy above the grid is noise (and the form-level copy carries the label prefix the field message does not need).

**Fix:** `{#if error && Object.keys(fieldErrors).length === 0}` around the `.formerror` in InvoiceEditor. Keep the top line for line-item problems, which have no field of their own.

### N6. minor — PDF footer breaks the sender CVR across two lines on the credit note

**Evidence:** 14: right footer block reads "Mit Firma ApS · CVR 12 34 56" / "78" / "Kreditnota 1006" — the mono CVR wraps mid-number because the credit note's longer payment-terms sentence on the left squeezes the right block. 13 (invoice) is fine. `src/lib/server/invoice-template.ts` `.foot { display: flex; justify-content: space-between; gap: var(--space-6) }` with no `flex-shrink: 0` / `white-space: nowrap` on the right block.

**Rule:** style.md §7 statutory content (CVR-nummer) "never clipped"; §1 grouped IDs are a single unit.

**Fix:** `.foot > div:last-child { flex-shrink: 0; white-space: nowrap; }` and/or `.foot .mono { white-space: nowrap }`; let the left block wrap. Token-free.

## Observations (not counted)

- 34 was first captured with `Udsted` in a mid-grey state; computed style after 500 ms is the normal `--grey-900` primary — it was the 80 ms `background`/`border-color` transition from disabled to enabled caught mid-flight. The shot was retaken with a settle wait.
- style.md §7 now says the currency "sits in its own column so it never pushes digits off that edge"; the template puts `DKK` in the total's label instead. The intent (shared right edge) is met (13, 14). Suggest rewording the sentence to "sits in the label or its own column" so the reference and the template agree literally.
- `.confirmbox__actions` place the committing button rightmost even when it is destructive (`Opret kreditnota 1007`, 27). §6's "destructive far left" is a footer rule; inside a confirm box the destructive action *is* the commit, and the pattern is consistent with 03b. Acceptable.
- The credit-note PDF (14) now lists `Forfaldsdato` (equal to the issue date) in the key/value list; pass 1 noted it was omitted. §7 asks for the due date in that list, so this is in line with the rule.
- After a failed save the editor's `Udsted` is enabled although the date field is invalid, because `canIssue` only knows the server's `problems` for the last *saved* draft; the issue action would fail with the same field error. Logic, not design.
- Only Fakturaer and Udgifter carry the Normal/Kompakt segment; the dashboard, customer and VAT tables follow the same cookie without their own control. Reasonable for a per-user setting.
- Density state uses `aria-pressed` on buttons and the filters use `aria-current` on links; both are styled identically in app.css. Fine.
- The pass-1 observations (red `Forfaldent` KPI without minus, chevron-less `.select`, no delivery date field, mouse-only row click, `--text-xl` error h1) are unchanged and still not counted.

## Open findings: 6

- blocker: 0
- major: 0
- minor: 6 (N1–N6; N1, N2, N3 and N5 are side effects of pass-1 fixes, N2 is the only visible regression against a pass-1 "fine" item)
- All 17 pass-1 findings are closed: 15 fixed, 2 accepted with the rule amended.

---

# Pass 3 (final)

| | |
|---|---|
| Date | 2026-09-08 |
| App commit | `0e9c08e` Fix design pass-2 minors: segment border, centred empty states, fixed line-item input widths, all field errors at once, single error line in editor, non-wrapping PDF footer |
| Authority | `tokens.css`, `style.md`, `example.html` — unchanged since pass 2 apart from the §7 currency sentence and the `td.empty` selector (`git diff 7301efe..HEAD` on the three files: 2 lines) |
| Instance | http://127.0.0.1:3102 (freshly seeded review instance running the current build) |
| Viewport | 1440 × 900, DPR 1, headless Chromium; passes at 1280 and 1152 px |

Method: read the pass-2 diff (`git show 0e9c08e`) for all eight touched files; regenerated **all** screenshots 00–36 with `review/shots.ts` and `review/shots-extra.ts` and inspected every PNG; re-ran `review/measure.ts` (computed styles for the density segment, `td.empty`, line-item input widths at 1440/1152, editor error state, badge/CVR fonts) and two new probes in `review/p3tmp/measure3.ts` / `measure4.ts` (line-item table geometry vs. its panel at 1440/1280/1152, with and without candidate fixes injected via `addStyleTag`). Re-audited `src/app.css`, every Svelte `<style>` block and the PDF template CSS for literals, and diffed `src/app.css` against the `example.html` `<style>` block again.

Capture notes: the grey PDF `<iframe>` on 04/05/27/28 and the 1-px voucher image on 36 are the known headless artefacts. The seed was stable this time (7 invoices, 8 vouchers, 3 customers throughout).

## New screenshot

| File | Screen |
|---|---|
| `shots/37-faktura-kladde-1280.png` | Draft editor at 1280 px (one populated line) — shows the line-item table overflowing the panel |

All 00–36 files were regenerated and reflect commit `0e9c08e`.

## Status of the six pass-2 findings

| # | Sev. | Finding (short) | Status | Evidence |
|---|---|---|---|---|
| N1 | minor | Density segment: first visible button had a hairline left border | **Fixed** | 33: `Normal` and `Alle` have identical left edges. Computed: `form[action="/density"]` first child is now the `BUTTON`; `button[value=normal]` `border-left: 0px`; link-segment first item `0px`. `DensityToggle.svelte` puts the hidden `back` input last. |
| N2 | minor | Empty-state line left-aligned with cell padding | **Fixed** | 22 ("Ingen fakturaer matcher filteret. Vis alle") and 35 ("Ingen fakturaer til denne kunde. Ny faktura") centred with `--space-6` above/below. Computed on `td.empty`: `text-align: center; padding: 24px 12px`; colour = `--text-secondary`, 13 px. Selector `table.data td.empty, .empty` identical in example.html and app.css. |
| N3 | minor | Line-item quantity input clipped at 1152 px | **Fixed as stated — but the fix introduced a worse defect (see P1)** | 30 and `measure.ts`: Antal/Enhed 90 px, Pris 130 px at both 1440 and 1152 (`scrollWidth` = `clientWidth` = 88); no digit is clipped any more. However `table.lines` no longer fits its panel at any supported width — P1 below. |
| N4 | minor | Validators failed fast; one field error per submit | **Fixed** | 26: Dato `31.02.2026` **and** Beløb `abc` both carry the red border and their message after a single submit ("Ugyldig dato – brug dd.mm.åååå", "Ugyldigt beløb – brug fx 1.234,56"). `expense-form.ts` collects a `fields` map and throws once; `invoice-form.ts` does the same for the header fields. |
| N5 | minor | Editor showed the same error twice | **Fixed** | 34: only the field message under Fakturadato; no `.formerror` line above the grid. Computed: exactly one `.error` element on the page. `InvoiceEditor.svelte:110` guards with `Object.keys(fieldErrors).length === 0`. |
| N6 | minor | PDF footer broke the CVR across two lines on the credit note | **Fixed** | 14: right block reads "Mit Firma ApS · CVR 12 34 56 78" / "Kreditnota 1006" on two intact lines; the long payment-terms sentence on the left wraps instead ("… Forfaldsdato" / "08.09.2026"). 13 unchanged. `.foot > div:last-child { flex-shrink: 0; white-space: nowrap }`. |

Tally: 6 of 6 addressed as described; N3's remedy is the cause of the one new major finding.

## CSS source audit (pass 3)

- **Raw colour**: none in `src/` (`#hex`, `rgb()`, `oklch()`, `hsl()` grep empty outside `tokens.css`).
- **Size literals in Svelte `<style>` blocks**: none (the only `px` hit is inside a comment in `InvoiceEditor.svelte:251`). The five new N3 rules use `--field-width-xs/-sm/-md` only.
- **`src/app.css`**: the shared block is still identical to the `example.html` `<style>` block (line-set diff: only the two header comments differ, plus the three known app additions `@import`, `.btn { white-space: nowrap }`, `.pdfframe/.fileframe`). Reference literals unchanged (`.brand__mark` 10 px, `.check input` 14 px, `.col-status` 152 px, `.textarea` 64 px, swatch demo sizes, `@media (max-width: 1100px)`).
- **PDF template**: tokens only plus `70mm` and the one new token-free layout rule for N6.
- **style.md §7** now says the currency "belongs in the total's label ('I alt inkl. moms, DKK'), never after the digits" — matches the template literally; the pass-2 wording observation is closed.

## New findings (pass 3)

### P1. major — Line-item table overflows the editor panel at every supported width (regression from N3's fix)

**Evidence:** 03 (1440 px): the `table.lines` header band and the `Fjern` column run ~60 px past the right border of the Fakturaoplysninger panel into the gutter. 03b: the overflowing header band covers the first line of the "Udsted faktura?" confirm box ("Fakturaen får nummer 1007 og kan herefter kun …" is partly hidden). 37 (1280 px): "PRIS EKSKL. MOMS / BELØB / Fjern" sit outside the panel, under the Opsummering panel. 30 (1152 px): the table extends ~250 px past the panel and paints over the Opsummering panel's validation bullet ("Udfyld mindst én linje med beskrivelse …"). 34 shows the same at 1440 in the error state.

Measured (`review/p3tmp/measure4.ts`, one populated line): `table.lines` is a constant **824 px** (columns 284 / 114 / 114 / 154 / 88 / 69) while the panel body's inner width is 718 px at 1440, 611 px at 1280 and 526 px at 1152 — overflow **89 / 195 / 281 px**. `.panel__body` has `overflow: visible`, so nothing clips it. Cause: `src/lib/components/InvoiceEditor.svelte:252–255` — `min-width: var(--field-width-xs|-sm)` on the three numeric inputs plus `min-width: var(--field-width-md)` (260 px) on the description input and `td:first-child { width: 100% }`. In an auto-layout table the sum of those minimums (plus 6 × 24 px cell padding and the Beløb/Fjern columns) is the table's min-content width, and it is larger than an 8/12 panel at every width down to the §2 minimum.

**Rule:** style.md §2 "usable from 1152px"; panels are the layout boundary (nothing may overlap a neighbouring panel); §4 quantities/units get `--field-width-xs`, amounts `--field-width-sm` (that part is now right).

**Fix (each step measured with injected CSS in the same probe):**
1. Delete `table.lines td:first-child { width: 100% }` and `table.lines td:first-child .input--cell { min-width: var(--field-width-md) }` — the description should flex, not carry a 260 px floor. Result: 718 px at 1440 (fits; description input 154 px), but still **+23 px at 1280** and **+109 px at 1152**.
2. Tighter cell padding in the lines table (`table.lines th, table.lines td { padding-left/right: var(--space-2) }`) additionally fits 1280 (description 96 px — cramped) but still overflows **+61 px at 1152**.
3. Therefore the editor's 8/4 split must collapse to a single column below ~1280 px: raise the breakpoint of the existing `@media (max-width: 1100px) { .layout-8-4 { grid-template-columns: minmax(0, 1fr) } }` in example.html/app.css to 1280 px (the reference's 1100 px breakpoint sits *below* the 1152 px minimum, so it never fires within the supported range), or add an editor-only `.layout-8-4--stack` modifier at that breakpoint if the issued-invoice detail pages (04/05/28, which fit at 1152) should keep the side-by-side layout. With 1 + 3 the description input is ≥ 154 px at every width and the summary panel moves below the lines. Adding a `--field-width-2xs` (≈ 64 px) for Antal/Enhed alone does not reach 1152 either (saves 52 px of a 109 px gap).

Whichever option is chosen, add an editor-at-1152 assertion to `review/measure.ts` (`table.lines` right edge ≤ `.panel` right edge) so the two successive regressions in this table (clipped inputs → overflowing table) cannot come back.

### P2. minor — Kunder list renders CVR ungrouped

**Evidence:** 09: CVR column shows `38412207`; the customer cell on the invoice detail (04, "CVR 38 41 22 07") and both PDFs (13, 14) group it. `src/routes/(app)/kunder/+page.svelte:38` — `<td class="mono">{c.cvr ?? '—'}</td>` bypasses `formatCvr`. This is the one remaining raw CVR rendering in the UI (grep: every other rendering goes through `formatCvr` / the template's `cvr()`).

**Rule:** style.md §1 grouped IDs (`12 34 56 78`); pass-1 finding 6 (closed in pass 2 on the detail page only).

**Fix:** `{c.cvr ? formatCvr(c.cvr) : '—'}`. Inputs (Kunde/Indstillinger forms) may stay raw — they are editable fields.

## Observations (not counted)

- The `Ugyldig dato – brug dd.mm.åååå` message wraps to two lines under the 130 px Fakturadato field (34). Acceptable: the error replaces the hint and wraps within the field's grid cell.
- At 1152 (29) the `Kladde` row shows `0,00` amounts because the probe draft had no lines at that moment; data, not design.
- 03b: while the confirm box is open the footer keeps `Slet kladde` far left and `Gem kladde` right with no primary — still one primary per screen (`Udsted nr. 1007` inside the confirm box).
- Pass 2's N3 verification measured only the input widths, not the table against its container; that is why the overflow was not caught then. `review/p3tmp/measure3.ts`/`measure4.ts` measure the table geometry and should be folded into `review/measure.ts`.
- All earlier observations (red `Forfaldent` KPI without minus, chevron-less `.select`, no delivery-date field, mouse-only row click, `--text-xl` error h1, `Udsted` enabled after a failed save, density control only on Fakturaer/Udgifter) are unchanged and still not counted.

## Open findings: 2

- blocker: 0
- major: 1 (P1 — line-item table overflows the editor panel at 1440/1280/1152; a visible regression introduced by the N3 fix, covering the Udsted confirm box and the summary panel's validation list)
- minor: 1 (P2 — ungrouped CVR in the Kunder list)
- All six pass-2 findings (N1–N6) are closed as described; N3's remedy must be reworked per P1.

---

# Pass 4 (final)

| | |
|---|---|
| Date | 2026-09-08 |
| App commit | `7872f86` Keep the line editor inside its panel: clamp fieldset width, collapse the 8/4 split below the 1440 target, tighter line-table padding (on top of `b8d288f`, which dropped the description column's `--field-width-md` floor and routed the Kunder CVR through `formatCvr`) |
| Authority | `tokens.css`, `style.md` unchanged since pass 3; `example.html` gained `fieldset { min-width: 0 }` and the `.layout-8-4` breakpoint moved to `max-width: 1419px` (`git diff 0e9c08e..HEAD -- example.html`: 4 lines, mirrored 1:1 in `src/app.css`) |
| Instance | http://127.0.0.1:3108 (freshly seeded review instance running the current build) |
| Viewport | 1440 × 900, DPR 1, headless Chromium; geometry probes at 1440 / 1420 / 1419 / 1280 / 1152 px |

Method: read `git show 7872f86` and the pass-3-relevant hunks of `b8d288f`; regenerated **all** screenshots 00–36 with `review/shots.ts` and `review/shots-extra.ts` against 3108 and inspected the editor, confirm, customer, settings, expense, detail and dashboard shots plus every width variant; wrote `review/measure-p4.ts` (kept in the repo), which creates a one-line draft and reads computed geometry for `table.lines`, its `.table-wrap`, `fieldset`, `.panel__body` and both `.layout-8-4` panels at each width, with and without the `Udsted` confirm open, then probes the three other `.layout-8-4` pages and the Kunder CVR cells. It also takes the new shots 37 (editor at 1280), 38 (confirm open at 1152) and 39 (issued invoice at 1280). Re-audited `src/app.css`, every Svelte `<style>` block and the PDF template CSS for literals, and diffed `src/app.css` against the `example.html` `<style>` block.

Capture notes: grey PDF `<iframe>` on 04/05/27/28/39 and the 1-px voucher image on 36 remain the known headless artefacts. The seed is 6 invoices; the sidebar reads `Fakturaer 7` in shots taken while a script's temporary draft exists (03, 30, 34, 37) and `6` otherwise (27, 39) — data, not design. At the end of the pass the working tree carried uncommitted builder changes on top of `7872f86` (15 files: `lineTotalOre` helper in `format.ts` used by `InvoiceEditor.svelte`'s script, API/DB guards, tests, README) — logic only, no CSS, markup or design-file changes, so this pass's conclusions hold for both `7872f86` and that tree.

## New screenshots

| File | Screen |
|---|---|
| `shots/37-faktura-kladde-1280.png` | Draft editor at 1280 px — single column, summary panel below the lines |
| `shots/38-faktura-udsted-bekraeft-1152.png` | Draft editor at 1152 px with the `Udsted` confirm open — confirm box inside the stacked summary panel, nothing covered |
| `shots/39-faktura-udstedt-1280.png` | Issued invoice 1001 at 1280 px — the 8/4 detail page now stacks too (see observations) |

All 00–36 files were regenerated and reflect commit `7872f86`.

## Status of the two pass-3 findings

| # | Sev. | Finding (short) | Status | Evidence |
|---|---|---|---|---|
| P1 | major | Line-item table overflowed the editor panel at 1440/1280/1152 | **Fixed** | `measure-p4.ts`, one populated line: `table.lines` width = `.panel__body` inner width at every probe — **718 px @1440**, 705 @1420, 1097 @1419, **958 @1280**, **830 @1152**; table right edge is 17 px *inside* the panel border (`tableExceedsPanel: -17`, i.e. the body padding) and flush with the body's content edge (`tableExceedsBody: 0`) at all five widths, confirm open or closed. `.table-wrap` `scrollWidth === clientWidth` everywhere, so the table does not even scroll internally; `fieldset` computed `min-width: 0px`. `document.scrollWidth === innerWidth` at each width (no page-level horizontal scroll). Split: `grid-template-columns` `752px 376px` at 1440 and `738.66px 369.34px` at 1420 (side by side), single column `1131px / 992px / 864px` at 1419 / 1280 / 1152 (`stacked: true`). Inputs: Antal/Enhed 90, Pris 130 px at every width (no clipping); Beskrivelse 202 @1440, 189 @1420, 360 @1280, 314 @1152. Cell padding computed `4px 8px` (`--space-1 --space-2`) on both `th` and `td`. Visual: 03 (table ends at the panel's inner edge, `Fjern` inside), 03b (confirm text "Fakturaen får nummer 1007 og kan herefter kun annulleres …" fully visible, no band across it), 34 (same in the error state), 37/30 (single column, table well inside), 38 (confirm box sits under `I alt` in the stacked summary, entirely visible). |
| P2 | minor | Kunder list rendered CVR ungrouped | **Fixed** | 09: CVR column `38 41 22 07`; computed cells `["—", "38 41 22 07", "—"]` all in `ui-monospace, "SF Mono", …`. `src/routes/(app)/kunder/+page.svelte:39` `{c.cvr ? formatCvr(c.cvr) : '—'}`. Detail (04/39) and PDFs (13/14) still grouped, so every rendering of a CVR in the UI now goes through `formatCvr`. |

Tally: 2 of 2 fixed. P1's mechanism is the one the pass-3 probe suggested (drop the description floor, tighten padding, collapse the split within the supported range) plus a belt-and-braces `fieldset { min-width: 0 }` that keeps the grid item from ever adopting the table's min-content width — so a future wider line table would scroll inside `.table-wrap` rather than escape the panel.

## Side-effect check of the two shared-CSS changes

- `fieldset { min-width: 0 }` touches every fieldset: 06 (Ny udgift), 07/36 (expense detail), 09/10/35 (customer forms), 11 (all three settings fieldsets), 03 (Fakturalinjer, Moms). All render exactly as in pass 3 — legends, hairlines, `--space-6` gap, span widths unchanged.
- `.layout-8-4` at ≤ 1419 px touches four pages: the editor (intended) and the issued-invoice detail, expense detail and export pages. Measured at 1280 and 1152: all four stack (`992px` / `864px` single column, second panel below the first). At 1440 all are still `752px 376px`. No overlap, no clipping, no horizontal scroll on any of them. See observation 1 for the design consequence.

## CSS source audit (pass 4)

- **Raw colour**: none in `src/` (`#hex`, `rgb()`, `oklch()`, `hsl()` grep empty outside `tokens.css`).
- **Size literals in Svelte `<style>` blocks**: none. Only `100%` / `100vh` layout percentages (`table.lines td:first-child { width: 100% }`, `max-width: 100%` on the voucher image, login/error shells) and the pass-3 comment mentioning "1152px".
- **`src/app.css`**: the shared block is identical to the `example.html` `<style>` block — the line-set diff shows only the two header comments, the `@import`, and the three known app additions (`.btn { white-space: nowrap }`, `.pdfframe`, `.fileframe`). Both files carry `fieldset { min-width: 0 }` and the `1419px` breakpoint with the same comment. Reference literals unchanged (`.brand__mark` 10 px, `.check input` 14 px, `.col-status` 152 px, `.textarea` 64 px, `@media (max-width: 1100px)` for `.kpis`).
- **PDF template**: tokens only plus `70mm` (§7 maximum), `50%` / `46%` layout percentages and the pass-2 footer rule — unchanged since pass 3.
- **`style.md` / `tokens.css`**: unchanged since pass 3; the 1440 target / 1152 minimum sentence in §2 still describes the behaviour (the editor holds the 8/4 split at the target and stacks below it).

## New findings (pass 4)

None.

## Observations (not counted)

1. **The 8/4 split now exists only at ≥ 1420 px, on every page that uses it.** Because the breakpoint lives on the shared `.layout-8-4` class, the issued-invoice detail (39, and 04/28 at 1280/1152), expense detail and export pages stack from 1419 px down even though their content fitted side by side at 1152 in pass 3. At 1280 the invoice summary becomes a full-width panel whose `I alt` figure sits ~950 px from its label. This is consistent with the reference (example.html carries the same rule) and violates no mandatory rule, so it is not a finding — but it is a broader design change than P1 required. If the team prefers the detail pages to keep the split, an editor-only modifier (e.g. `.layout-8-4--stack-below-target`) at 1419 px and the original 1100 px rule for the rest would do it; otherwise document in style.md §2 that the 8/4 split is a ≥ 1420 px layout.
2. `@media (max-width: 1100px) { .kpis … }` still sits below the 1152 px minimum and therefore never fires within the supported range (four KPIs stay in one row at 1152; they fit — 29/30). Harmless reference dead code.
3. `table.lines td:first-child { width: 100% }` in `InvoiceEditor.svelte` is retained; with the fieldset clamp it now does what it always meant to — hand the slack to the description column (218 / 458 / 330 px at 1440 / 1280 / 1152).
4. `review/measure-p4.ts` is the regression probe pass 3 asked for (table right edge vs panel right edge at 1440/1280/1152, plus the split state); it reports rather than asserts. Fold it into `review/measure.ts` with a hard `tableExceedsBody <= 0` check if the review scripts are kept.
5. At 1420–1439 px the split is still side by side and the description input narrows to 189 px (1420). Fine — that band is above the design target and everything fits without scrolling.
6. All earlier observations (red `Forfaldent` KPI without minus, chevron-less `.select`, no delivery-date field, mouse-only row click, `--text-xl` error h1, `Udsted` enabled after a failed save, density control only on Fakturaer/Udgifter, `confirmbox` placing the destructive commit rightmost) are unchanged and still not counted.

## Open findings: 0

- blocker: 0
- major: 0
- minor: 0
- All 17 pass-1, 6 pass-2 and 2 pass-3 findings are closed (23 fixed, 2 accepted with the rule amended). The app is consistent with `tokens.css`, `style.md` and `example.html` at 1440 and usable without overflow at 1280 and 1152.

---

# Pass 5 (final)

| | |
|---|---|
| Date | 2026-09-08 |
| App commit | `64f3e22` … scope the 8/4 collapse to the line editor (working tree clean apart from the untracked `review/` directory) |
| Authority | `tokens.css`, `style.md` unchanged since pass 3; `example.html` changed in one place — the `@media (max-width: 1419px)` rule now targets `.layout-8-4--lines` instead of `.layout-8-4` (`git diff 7872f86..HEAD -- example.html`: 5 lines, mirrored 1:1 in `src/app.css`) |
| Instance | http://127.0.0.1:3108 (freshly seeded review instance running the current build) |
| Viewport | 1440 × 900, DPR 1, headless Chromium; geometry probes at 1440 / 1420 / 1419 / 1280 / 1152 px |

Method: read `git show 64f3e22` (only `example.html`, `src/app.css` and `InvoiceEditor.svelte` touch design — the class `layout-8-4 layout-8-4--lines` on the editor form and a `lineTotalOre` import; the rest is DB/API/tests). Re-ran `review/measure-p4.ts` unchanged (editor geometry at 1440/1420/1419/1280/1152 with and without the confirm open; other 8/4 pages at 1440/1280/1152; Kunder CVR) and wrote `review/measure-p5.ts` (kept), which probes the editor **and** the issued-invoice detail, expense detail and export pages at 1440 / 1419 / 1280 / 1152 for grid columns, side-by-side vs stacked, elements escaping their panel and page-level horizontal scroll, then checks the content of the pages that now stay side by side below 1420 (export table vs its `.table-wrap`, grouped CVR line boxes in the detail page's Kunde cell) and writes shots 40–43. Regenerated **all** screenshots 00–36 with `review/shots.ts` and `review/shots-extra.ts` against 3108; inspected 03, 03b, 04, 07, 12, 27, 30, 34, 37, 38, 39 and the new 40–43. Re-audited `src/app.css` against the `example.html` `<style>` block (line-set diff) and every Svelte `<style>` block plus the PDF template for literals.

Capture notes: the probes and the two shot scripts ran concurrently, so the sidebar reads `Fakturaer 7` where a script's temporary draft existed (03, 03b, 30, 34, 37, 38) and `6` elsewhere — data, not design; no two scripts write the same file (37–39 were written before `shots.ts` started). Grey PDF `<iframe>` on 04/05/27/28/39/40 and the 1-px voucher image on 36 remain the known headless artefacts. The tree was clean at `64f3e22` when the pass started; by its end the builder had uncommitted changes in six files (`drizzle/meta/_journal.json`, a new `drizzle/0005_credited_by_unique.sql` + snapshot, `src/lib/server/invoice-form.ts`, `src/lib/server/schema.ts`, `src/routes/api/invoices/[id]/paid/+server.ts`, two API tests) — no `.css`, `.svelte`, `.html`, `style.md` or `tokens.css` among them, so this pass's conclusions hold for both the commit and that tree.

## New and changed screenshots

| File | Screen |
|---|---|
| `shots/39-faktura-udstedt-1280.png` | Issued invoice 1001 at 1280 px — **now side by side again** (was stacked in pass 4) |
| `shots/40-faktura-udstedt-1152.png` | Issued invoice 1001 at 1152 px — side by side, 560 / 280 px panels |
| `shots/40b-faktura-udstedt-1152-kunde-zoom.png` | Crop of the Kunde cell at 1152 px — grouped CVR broken across two lines (E2) |
| `shots/41-udgift-bilag-1152.png` | Expense voucher 1 at 1152 px — side by side, form fits its 280 px panel |
| `shots/42-eksport-1152.png` | Eksport at 1152 px — `Rækker` column clipped inside the table wrap (E1) |
| `shots/42b-eksport-1152-tabel-zoom.png` | Crop of that table |
| `shots/43-eksport-1280.png` | Eksport at 1280 px — same clipping, 85 px hidden |

37 and 38 (editor at 1280, confirm open at 1152) were regenerated and are unchanged in substance from pass 4. All 00–36 files reflect commit `64f3e22`.

## Status of the pass-4 observation (the reason for this pass)

**Acted on and verified.** The collapse is now scoped to the editor only. Measured with `measure-p5.ts` (`grid-template-columns` / state):

| Page | 1440 | 1420 | 1419 | 1280 | 1152 |
|---|---|---|---|---|---|
| Editor (`layout-8-4 layout-8-4--lines`) | `752px 376px` side by side | `738.66px 369.34px` side by side | `1131px` stacked | `992px` stacked | `864px` stacked |
| Issued-invoice detail (`layout-8-4`) | `752px 376px` | — | `738px 369px` side by side | `645.33px 322.66px` side by side | `560px 280px` side by side |
| Expense detail (`layout-8-4`) | `752px 376px` | — | `738px 369px` | `645.33px 322.66px` | `560px 280px` |
| Eksport (`layout-8-4`) | `752px 376px` | — | `738px 369px` | `645.33px 322.66px` | `560px 280px` |

- Editor: `table.lines` right edge is flush with the panel body's content edge (`tableExceedsBody: 0`, `tableExceedsPanel: −17`) at all five widths, confirm open or closed; table width = body inner width (718 / 705 / 1097 / 958 / 830). Antal/Enhed 90 px, Pris 130 px everywhere, nothing clipped; Beskrivelse 202 / 189 / 360 / 360 / 314 px. Cell padding `4px 8px`. `document.scrollWidth === innerWidth` at every width. Visual: 03, 03b, 34 (1440, split held, confirm box fully visible), 37 (1280, stacked), 30 and 38 (1152, stacked, confirm box under `I alt`). Identical to pass 4 — P1 stays fixed.
- The three plain 8/4 pages are side by side from 1440 down to 1152 with no page-level horizontal scroll and no element escaping its panel (the `escapingPanel` probe is empty at 1419 / 1280 / 1152 on all three, excluding the deliberately scrolling `.table-wrap`). 04 / 07 / 12 at 1440 are the pass-4 layout unchanged; 39 / 40 / 41 show the split held at 1280 and 1152.
- The 1420–1439 band still holds the editor split with a 189 px description input (pass-4 observation 5), unchanged.

So the scoping does exactly what the observation asked for. What it also does is re-expose the content of those three pages at widths they had not been captured at before (pass 3 and earlier only shot them at 1440; pass 4 stacked them), and two of the three have a content problem below 1420 — E1 and E2 below.

## Side-effect check

- Pages that do not use `.layout-8-4` cannot be affected by the commit's CSS (the only rule that changed is the one media query); their shots (00–02, 05, 06, 08–11, 13–14, 20–29, 31–36) were regenerated and spot-checked (27, 34) — no change.
- `InvoiceEditor.svelte`'s markup change is the added class only; its `<style>` block is unchanged since pass 4.

## CSS source audit (pass 5)

- **Raw colour**: none in `src/` (`#hex`, `rgb()`, `oklch()`, `hsl()` grep empty outside `tokens.css`).
- **Size literals in Svelte `<style>` blocks**: none (the only `px` hit is the pass-3 comment in `InvoiceEditor.svelte:250`).
- **`src/app.css` vs `example.html` `<style>`**: line-set diff shows only the two header comments, the `@import`, and the three known app additions (`.btn { white-space: nowrap }`, `.pdfframe`, `.fileframe`). Both carry the scoped rule with the same two-line comment. Reference literals unchanged (`.brand__mark` 10 px, `.check input` 14 px, `.col-status` 152 px, `@media (max-width: 1100px)` for `.kpis`).
- **PDF template**: unchanged since pass 3 (`70mm`, two layout percentages, the N6 footer rule).
- **Class resolution**: `layout-8-4--lines` is defined in both files and used once (`InvoiceEditor.svelte:88`); the three other `.layout-8-4` usages (`eksport`, `fakturaer/[id]`, `udgifter/[id]`) correctly omit it.

## New findings (pass 5)

All three are minor. E1 and E2 are not regressions of anything that was ever verified working — they are what the pass-4 observation's fix reveals on pages that were never captured below 1440 before pass 4 and were stacked in pass 4. E3 is a reference/documentation gap created by the fix itself.

### E1. minor — Eksport: the `Indhold` table's `Rækker` column is hidden below 1420 px

**Evidence:** 42, 42b (1152), 43 (1280). Measured: `table.data` in the left panel is a constant **696 px** (columns Fil 146 / Indhold 484 / Rækker 66, every cell `white-space: nowrap` from `table.data th, table.data td` in app.css:437) while `.table-wrap` is 611 px at 1280 and 526 px at 1152 — **85 / 170 px hidden**; `th.num` right edge 969 vs wrap right edge 884 / 799. `.table-wrap { overflow-x: auto }` clips it, so nothing escapes the panel, but the whole `Rækker` column and the tail of two `Indhold` sentences ("…og PDF-st", "…ændrin") are off-screen, and with overlay scrollbars (`offsetHeight − clientHeight = 0`) there is no visible affordance that the table scrolls. At 1440 the table is 718 px and fits (12). `src/routes/(app)/eksport/+page.svelte:23–38`.

**Rule:** style.md §2 "usable from 1152px" — the only data in the table (row counts) is not visible in the supported range below the target; §3 tables (numeric column must be readable, right-aligned mono).

**Fix (token-free, either):** (a) let the prose column wrap — add `table.data td.wrap { white-space: normal }` to example.html and app.css and put `class="wrap"` on the five `Indhold` cells; the table then fits 526 px with the mono file names and the numeric column intact. Or (b) give the export page the `layout-8-4--lines` modifier too, so it stacks below 1420 like the editor — but the right panel is a three-line hint, so (a) is the better layout. Re-measure with `measure-p5.ts` (`hiddenPx` must be 0 at 1280 and 1152).

### E2. minor — Grouped CVR breaks across two lines in the invoice detail's Kunde cell at 1152 px

**Evidence:** 40, 40b. Computed at 1152: the `<span class="mono">38 41 22 07</span>` has **two line boxes** (`38` at x 500 w 12 on the first line, `41 22 07` at x 273 w 48 on the second); the `.cell-sub` is 251 px wide inside the 6/6 `.facts` grid of the 560 px panel. At 1440 and 1280 it is one line box (67 px). `src/routes/(app)/fakturaer/[id]/+page.svelte:44`; `formatCvr` (`src/lib/format.ts:87`) joins the groups with ordinary spaces, and neither `.mono` nor `.cell-sub` sets `white-space`.

**Rule:** style.md §1 — CVR is a single mono ID; a grouped ID split over two lines no longer reads as one number (the same defect was fixed in the PDF footer as N6 in pass 3).

**Fix:** `white-space: nowrap` on grouped IDs — e.g. add `.mono--id { white-space: nowrap }` (or `.nowrap`) to example.html/app.css and use it on the CVR span here, so the line breaks before "· CVR" instead. Alternatively have `formatCvr` join with U+00A0; the PDF and Kunder list (`td` already nowrap) are unaffected either way. Token-free.

### E3. minor — The reference's own editor demo and style.md do not carry the new modifier

**Evidence:** `example.html:791` — the "Ny faktura" section's `<div class="layout-8-4">` contains the `Fakturalinjer` fieldset with the line-item table (`:846`) but not `layout-8-4--lines`, so the pattern file's editor no longer stacks below 1420 while the app's does (and would overflow its panel at 1152 exactly as P1 described, since the reference demo has the same table). The rule and its comment exist in the reference `<style>` (`:568–572`) but nothing in the markup uses it. style.md §2 still describes only "1440px design target, usable from 1152px" and does not say that the 8/4 split collapses below 1420 for line-item editors (pass-4 observation 1 asked for this sentence).

**Rule:** style.md intro / pass-1 finding 16 — example.html is the pattern reference to copy blocks from and must agree with the app; a developer copying the "Ny faktura" block today gets the un-scoped class.

**Fix:** add `layout-8-4--lines` to the demo's `<div class="layout-8-4">` at `example.html:791`, and one sentence in style.md §2, e.g. "The 8/4 split holds down to 1152 px; a panel that contains a line-item table (`.layout-8-4--lines`) stacks below 1420 px." No app change.

## Observations (not counted)

1. 39 (detail at 1280): "Åbn PDF" wraps to a second line under "PDF gemt som `files/invoices/1001.pdf`." in the 323 px summary panel — ordinary text wrap within its panel, fine.
2. `review/measure-p5.ts` reports the E1/E2 measurements (`hiddenPx`, `lineBoxes`) alongside the layout matrix; like `measure-p4.ts` it reports rather than asserts. If the review scripts are kept, the hard checks to add are `lines.exceedsBody <= 0` (editor) and `hiddenPx === 0` / `lineBoxes === 1` (export, detail) at 1152.
3. `@media (max-width: 1100px) { .kpis … }` still never fires within the supported range (pass-4 observation 2).
4. All earlier observations (red `Forfaldent` KPI without minus, chevron-less `.select`, no delivery-date field, mouse-only row click, `--text-xl` error h1, `Udsted` enabled after a failed save, density control only on Fakturaer/Udgifter, `confirmbox` placing the destructive commit rightmost, 1420–1439 band) are unchanged and still not counted.

## Open findings: 3

- blocker: 0
- major: 0
- minor: 3 (E1 — `Rækker` column hidden on Eksport at 1280/1152; E2 — grouped CVR wraps in the detail Kunde cell at 1152; E3 — example.html demo markup and style.md §2 lack the `layout-8-4--lines` modifier/sentence). E1 and E2 are token-free one-rule fixes plus a class; E3 is a reference edit.
- The pass-4 observation is resolved as intended: the editor holds the 8/4 split at ≥ 1420 and stacks below; the issued-invoice detail, expense detail and export pages are side by side from 1440 to 1152 with no overflow, no page-level scroll and no element escaping a panel. P1 and P2 remain fixed; all 17 pass-1, 6 pass-2 and 2 pass-3 findings remain closed.

---

# Pass 6 (final)

| | |
|---|---|
| Date | 2026-09-08 |
| App commit | `841fa27` … wrap the export table prose column and keep grouped CVR numbers on one line (working tree clean apart from the untracked `review/` directory) |
| Authority | `tokens.css` unchanged since pass 3; `example.html` gained two rules (`.nowrap { white-space: nowrap }`, `table.data td.wrap { white-space: normal }`) and the "Ny faktura" demo grid now reads `layout-8-4 layout-8-4--lines` (`git show 841fa27 -- example.html`: 4 lines, the two rules mirrored 1:1 in `src/app.css`); `style.md` §2 gained one sentence on the collapse |
| Instance | http://127.0.0.1:3108 (freshly seeded review instance running the current build) |
| Viewport | 1440 × 900, DPR 1, headless Chromium; geometry probes at 1440 / 1420 / 1419 / 1280 / 1152 px |

Method: read `git show 841fa27` (design-relevant hunks: `example.html`, `src/app.css`, `style.md`, `eksport/+page.svelte` — `class="wrap"` on the five `Indhold` cells, `fakturaer/[id]/+page.svelte` and `kunder/+page.svelte` — `mono nowrap` on the CVR span/cell, `moms/+page.svelte` — its local `table.data td.wrap` rule removed now that app.css carries it; the rest is DB/API/tests). Regenerated **all** screenshots 00–43 sequentially with `review/shots.ts`, `review/shots-extra.ts`, `review/measure-p4.ts` and `review/measure-p5.ts` against 3108 (no concurrent scripts this time, so only `shots.ts`'s own temporary draft shows as `Fakturaer 7` in 03/03b/12/34; `6` elsewhere). Wrote `review/measure-p6.ts` (kept, read-only — creates no data), which measures the export table against its `.table-wrap` including every `Rækker` cell's right edge and the wrapped prose cells' line counts at 1440 / 1280 / 1152; the grouped CVR's line boxes, white-space and parent text in the detail Kunde cell and the Kunder list at the same widths; both moms tables (the page that lost its local rule) at 1440 / 1280 / 1152; and `example.html` opened from disk at 1440 / 1419 / 1152 for the demo grid's columns, its line table vs its panel and the resolution of the two new rules. It writes shots 44–46. Re-audited `src/app.css` against the `example.html` `<style>` block (line-set diff), every Svelte `<style>` block and the PDF template for literals, and the class resolution of `wrap` / `nowrap` / `layout-8-4--lines` across `src/`.

Capture notes: grey PDF `<iframe>` on 04/05/27/28/39/40 and the 1-px voucher image on 36 remain the known headless artefacts. Row counts in 12 vs 43 (7/10/42 vs 6/8/53) differ because 12 was taken while `shots.ts`'s draft existed and after its audit writes — data, not design. The tree was clean at `841fa27` when the pass started; by its end the builder had uncommitted changes in three files (`InvoiceEditor.svelte` and two API tests). The Svelte change is markup only: the `Fakturalinjer` fieldset gains `field--error` and an inline `<p class="error formerror">` when the lines-level validator fails — all three classes already exist in `app.css` / `example.html` (393–394, 551) and are used by the kunder and udgifter forms, so no undefined class and no CSS change; not exercised by any shot in this pass (34 is a date error). One thing to eyeball when it lands: `.field--error .input` colours every `.input` inside the fieldset, so a lines-level error will outline all line inputs, not just the offending one — acceptable if intended, otherwise scope the class to the row.

## New and changed screenshots

| File | Screen |
|---|---|
| `shots/42-eksport-1152.png`, `42b-eksport-1152-tabel-zoom.png` | Eksport at 1152 px — table now fits its wrap, `Rækker` column visible, two `Indhold` sentences wrap to two lines (E1 fixed) |
| `shots/43-eksport-1280.png` | Eksport at 1280 px — same, one sentence wraps (E1 fixed) |
| `shots/40-faktura-udstedt-1152.png`, `40b-faktura-udstedt-1152-kunde-zoom.png` | Issued invoice 1001 at 1152 px — CVR `38 41 22 07` on one line, the break now falls before it (E2 fixed; but see F2) |
| `shots/44-kunder-1152.png` | **New.** Kunder list at 1152 px — CVR cell one line, mono |
| `shots/45-moms-1152.png` | **New.** Momsindberetning at 1152 px — both 6/6 tables clip their last `Moms` column (F1) |
| `shots/46-example-ny-faktura-1152.png` | **New.** The reference's own "Ny faktura" demo rendered from `example.html` at 1152 px — stacked, table inside the panel (E3 fixed) |

All 00–41 files were regenerated and reflect commit `841fa27`; 03, 08, 09, 12 and 37/38/39 were inspected against pass 5 and are unchanged apart from data.

## Status of the three pass-5 findings

| # | Sev. | Finding (short) | Status | Evidence |
|---|---|---|---|---|
| E1 | minor | Eksport `Rækker` column hidden below 1420 px | **Fixed** | `measure-p5.ts` / `measure-p6.ts`: `table.data` width = `.table-wrap` client width at every probe — **718 @1440, 611 @1280, 526 @1152**; `hiddenPx: 0` (was 85 / 170); `th.num` right edge = wrap right edge (991 / 884 / 799); all five `Rækker` cells `insideWrap: true` at all three widths; `document.scrollWidth === innerWidth`. Columns 146 / 399 / 66 at 1280 and 146 / 314 / 66 at 1152 — the file names (mono, `nowrap` inherited) and the numeric column are intact, the prose column computes `white-space: normal` and wraps: one cell to two lines at 1280 (`audit_log.csv`), two at 1152 (`invoices.csv`, `audit_log.csv`). Visual 42, 42b, 43. Source: `eksport/+page.svelte:33–37` `class="wrap"`, `app.css:469` / `example.html:478` `table.data td.wrap { white-space: normal }`. |
| E2 | minor | Grouped CVR broke across two lines in the detail Kunde cell at 1152 px | **Fixed** | `.facts .cell-sub .mono` computes `white-space: nowrap`, **one line box** at 1440 / 1280 / 1152 (67 px wide; at 1152 it sits at x 273 on the second line of the 251 px `.cell-sub`, which is now 34 px tall — the wrap point moved to before "· CVR", as the pass-5 fix suggested). Visual 40b. Kunder list: all three CVR cells `nowrap`, one line box, `ui-monospace`, at all three widths (44). Source: `fakturaer/[id]/+page.svelte:44` and `kunder/+page.svelte:39` `mono nowrap`; `app.css:468` / `example.html:477` `.nowrap`. |
| E3 | minor | Reference demo and style.md lacked the modifier | **Fixed** | `example.html:793` `<div class="layout-8-4 layout-8-4--lines">`; rendered from disk the demo is `752px 376px` side by side at 1440 and `1131px` / `864px` stacked at 1419 / 1152, its `table.data.data--dense` line table 718 / 1097 / 830 px wide with `tableExceedsBody: 0`, `tableExceedsPanel: −17`, `fieldset min-width: 0px` — the same numbers as the app's editor (`measure-p4.ts`/`p5.ts`, unchanged). In the same document `.nowrap` resolves to `nowrap` and `table.data td.wrap` to `normal`. `style.md:55` now ends: "An 8 / 4 that holds a line-item editor (`layout-8-4--lines`) stacks to one column below 1420px; plain 8 / 4 detail pages stay side by side down to 1152px." — matching the measured matrix. |

Tally: 3 of 3 fixed, each by the token-free mechanism the pass-5 finding proposed (option (a) for E1). P1 and P2 remain fixed: `measure-p4.ts` re-run unchanged — editor `tableExceedsBody: 0` / `tableExceedsPanel: −17` at 1440 / 1420 / 1419 / 1280 / 1152, confirm open or closed; inputs 90 / 90 / 130 px, no clipping; cell padding `4px 8px`; the 8/4 matrix (`752px 376px` → `738.66px 369.34px` → stacked `1131px` / `992px` / `864px` for the editor, side by side down to `560px 280px` for the three plain pages) is identical to pass 5.

## Side-effect check

The commit's CSS surface is two additive class rules, so it can only affect elements that carry `wrap` or `nowrap`. Every such element in `src/` was measured:

- `td.wrap`: the five export cells (above) and the two moms tables, which previously got the identical rule from the page's own `<style>`. Moms at 1440: both tables 562 px = wrap, `hiddenPx: 0`, `Kunde` / `Leverandør` cells `normal`, one line each — 08 is pixel-equivalent to pass 5. At 1280: 482 px = wrap, `hiddenPx: 0`, prose cells wrap to two lines where needed. At 1152: see F1 — the same 14 / 37 px overflow the page had before the move (the rule computes identically; the panel is simply too narrow), so not a regression, but newly captured.
- `.nowrap`: the detail CVR span and the three Kunder CVR cells (above). No other element in `src/` carries either class (`grep 'class="[^"]*\b(wrap|nowrap)\b'`); `.table-wrap` is a different class and unaffected.
- Markup: `eksport`, `fakturaer/[id]`, `kunder` gained only the classes; `moms` lost only the duplicated rule; `InvoiceEditor.svelte` is untouched since pass 5.
- Pages without any of these classes (00–02, 05–07, 10, 11, 13, 14, 20–39, 41) were regenerated; 03, 37, 38, 39 spot-checked — no change.

## CSS source audit (pass 6)

- **Raw colour**: none in `src/` (`#hex`, `rgb()`, `oklch()`, `hsl()` grep empty outside `tokens.css`).
- **Size literals in Svelte `<style>` blocks**: none — the `px|rem|em` sweep over every `<style>` block hits only the pass-3 comment in `InvoiceEditor.svelte:251` ("…at 1152px"), as in pass 5; `100%` / `100vh` percentages only otherwise.
- **`src/app.css` vs `example.html` `<style>`**: line-set diff shows only the two header comments, the `@import`, and the three known app additions (`.btn { white-space: nowrap }`, `.pdfframe`, `.fileframe`). The two new rules and their comments are byte-identical in both files. Reference literals unchanged (`.brand__mark` 10 px, `.check input` 14 px, `.col-status` 152 px, `.textarea` 64 px, `@media (max-width: 1100px)` for `.kpis`, `1419px` breakpoint).
- **Class resolution**: `wrap` used 7× (5 export + 2 moms), `nowrap` 2×, `layout-8-4--lines` 1× in `src/` and 1× in the `example.html` demo — every use has a definition, every definition has a use. Pattern CSS is no longer duplicated in any route file (pass-1 finding 16 stays closed; the moms duplicate is gone).
- **PDF template**: unchanged since pass 3.
- **`style.md`**: only the §2 sentence changed; `tokens.css` unchanged.

## New findings (pass 6)

Both are minor, both pre-date `841fa27` (neither is touched by the commit's CSS or markup), and both surfaced only because the pass-6 probe measured surfaces no earlier pass had: the moms page below 1440, and the DOM text of the Kunde cell.

### F1. minor — Momsindberetning: the `Moms` column of both 6/6 tables is clipped at 1152 px

**Evidence:** 45 (1152). Measured (`measure-p6.ts`): the `.layout-6-6` panels are 418 px of `.table-wrap` at 1152, but the sales table's min-content width is **432 px** (Nr. 53 + Dato 95 + Kunde 94 + Ekskl. moms 102 + Moms 88) and the purchases table's **455 px** (Bilag 62 + Dato 95 + Leverandør 115 + Ekskl. moms 102 + Moms 81) — `hiddenPx` **14 / 37**. The `Moms` cells' right edge is 689 / 1156 against wrap edges of 675 / 1119, so every `Moms` amount (`insideWrap: false` for all 9 cells and the two footer totals) loses its last digits: "−3.000,0", "2.425,0", "80,0", "625,", "599,8", footer "1.304". `overflow-x: auto` with overlay scrollbars gives no visible affordance. At 1280 (`482 px` wrap) and 1440 (`562 px`) both tables fit exactly (`hiddenPx: 0`, 08). The `Kunde` / `Leverandør` prose already wraps (three lines at 1152) — what cannot shrink is the sum of the four `nowrap` columns plus the longest unbreakable word in the prose column.

**Rule:** style.md §2 "usable from 1152px"; §3 numeric column right-aligned mono must be readable — the same rule as E1, on the page's most important figures (the VAT amounts the report exists to show).

**Fix (token-free, one of):** (a) let the 6/6 pair stack below a threshold the way the editor does — a `.layout-6-6--tables` modifier following the `layout-8-4--lines` pattern in `example.html` and `app.css` (the `1419px` breakpoint, or a lower one: at 1280 both tables fit exactly, so `max-width: 1279px` would do), so each table gets the full 12-column width where the pair no longer fits; this is the design-consistent option and also stops `Kunde` wrapping to three lines at 1152. (b) Reduce horizontal cell padding in the two report tables with a `data--tight` variant using `--space-1` — the existing `data--dense` variant is vertical-only (`example.html:496–497`) and does not help here. (c) `overflow-wrap: anywhere` on `td.wrap` plus un-`nowrap`ping the `Dato` column — measurably ugly. Re-measure with `measure-p6.ts` (`hiddenPx === 0` and every `numCells[].insideWrap === true` at 1152).

### F2. minor — Detail Kunde cell: no space before the `·` separator ("København Ø· CVR")

**Evidence:** 40b (1152) and the DOM at all three widths — `.cell-sub` `textContent` is `"Sundkrogsgade 21, 2100 København Ø· CVR 38 41 22 07"`. The source (`fakturaer/[id]/+page.svelte:44`) is `{inv.customer.city}{#if inv.customer.cvr} · CVR <span …>`; Svelte trims the whitespace at the start of the `{#if}` block, so the leading space before `·` is dropped while the one after it survives. Every other `·` separator in the app has a space on both sides (`Kladde · intet nummer endnu`, `Regnskabsår 2026 · 3. kvartal`, `4 udstedte dokumenter · omsætning`), and the pass-5 E2 fix moved the line break to exactly this spot, so at 1152 the first line now ends in "Ø· CVR". Pre-existing (visible in 04 since pass 1 at `--text-2xs`), not a regression.

**Rule:** style.md §1 typography / consistency of the `·` metadata separator; not a token matter.

**Fix:** keep the space inside the expression so Svelte cannot trim it — `{#if inv.customer.cvr}{' · CVR '}<span class="mono nowrap">…</span>{/if}` — or move `·` outside the block guard. One-line markup change; `measure-p6.ts` prints the cell's `parentText`, which must start `"… København Ø · CVR "`.

## Observations (not counted)

1. `review/measure-p6.ts` joins `measure-p4.ts` / `measure-p5.ts` as a report-only probe. If the review scripts are kept, the hard checks are now: editor `lines.exceedsBody <= 0`; export and moms `hiddenPx === 0` and `numCells[].insideWrap` all true; CVR `lineBoxes === 1`; `parentText` starts with a spaced separator — each at 1152.
2. `.nowrap` is a utility rather than a semantic class (`mono--id` was the alternative); acceptable, and the comment in both stylesheets ties it to grouped IDs. `formatCvr` still joins with ordinary spaces, so any future rendering of a grouped CVR needs the class too (the PDF footer has its own rule from N6).
3. `th` in `table.data` remain `nowrap` (correct — the wrap rule is deliberately `td`-only), so a very narrow export panel would still be bounded by the header widths (146 + `Indhold` header + 66); at 1152 there is 314 px of slack, fine.
4. `@media (max-width: 1100px) { .kpis … }` still never fires within the supported range (pass-4 observation 2).
5. All earlier observations (red `Forfaldent` KPI without minus, chevron-less `.select`, no delivery-date field, mouse-only row click, `--text-xl` error h1, `Udsted` enabled after a failed save, density control only on Fakturaer/Udgifter, `confirmbox` placing the destructive commit rightmost, 1420–1439 band with a 189 px description input, `Åbn PDF` wrapping at 1280) are unchanged and still not counted.

## Open findings: 2

- blocker: 0
- major: 0
- minor: 2 (F1 — `Moms` column clipped on Momsindberetning at 1152; F2 — missing space before the `·` separator in the detail Kunde cell). Both pre-date this commit and were exposed by measuring surfaces no earlier pass had reached; both are token-free, one-place fixes.
- E1, E2 and E3 are fixed and verified with geometry at 1440 / 1280 / 1152; the commit introduced no regression — its two shared rules were checked on every element that carries them, and P1 / P2 plus all 17 pass-1, 6 pass-2 and 2 pass-3 findings remain closed. `src/app.css` and `example.html` are in parity, `src/` carries no raw colours or size literals, and `style.md` §2 now describes the measured collapse behaviour.

---

# Pass 7 (final)

| | |
|---|---|
| Date | 2026-09-08 |
| App commit | `d897fab` Show line validation errors in the editor, prove the credit-note uniqueness guard in tests, stack paired VAT tables below 1280px and fix the CVR separator spacing (working tree clean apart from the untracked `review/` directory) |
| Authority | `tokens.css` unchanged since pass 3; `example.html` gained one rule (`@media (max-width: 1279px) { .layout-6-6--tables { grid-template-columns: minmax(0, 1fr); } }` plus its comment, mirrored 1:1 in `src/app.css`); `style.md` §2 gained the clause "and a 6 / 6 of paired data tables (`layout-6-6--tables`) stacks below 1280px" |
| Instance | http://127.0.0.1:3108 (freshly seeded review instance running the current build) |
| Viewport | 1440 × 900, DPR 1, headless Chromium; geometry probes at 1440 / 1420 / 1419 / 1280 / 1279 / 1152 px |

Method: read `git show d897fab` (design-relevant hunks: `example.html`, `src/app.css`, `style.md`, `moms/+page.svelte` — `layout-6-6 layout-6-6--tables` on the section, `fakturaer/[id]/+page.svelte` — `{' · CVR '}` inside the `{#if}` block, `InvoiceEditor.svelte` — one added `<p class="error formerror">` under the `Fakturalinjer` legend, keyed `fields.lines`; the rest is tests). Regenerated **all** screenshots 00–46 sequentially with `review/shots.ts`, `review/shots-extra.ts`, `review/measure-p4.ts`, `review/measure-p5.ts` and `review/measure-p6.ts` against 3108 (all five exited 0; no concurrent scripts). Wrote `review/measure-p7.ts` (kept), which measures the Momsindberetning 6/6 grid and both tables against their `.table-wrap` at 1440 / 1280 / 1279 / 1152 (grid columns, side-by-side vs stacked, hidden px, every `Moms` body and footer cell's right edge vs the wrap's right edge, prose line counts, page h-scroll); the detail Kunde cell's `.cell-sub` text and CVR line boxes at 1440 / 1280 / 1152; the editor after saving a line with quantity `abc` through the UI (`Gem kladde`, `use:enhance`) — the fieldset's class list, the error paragraph's text and computed colour/size/margin, the legend → error → table vertical order, and the computed border colour of every line input against a probe `.input` and a probe `.field--error .input`; and `example.html` from disk at 1440 / 1279 for the new rule's resolution. It creates one draft and deletes it again, and writes shots 45 (refreshed), 47, 48, 49 and 49b. Re-audited `src/app.css` against the `example.html` `<style>` block (unified diff), every Svelte `<style>` block, `src/app.css` and the PDF template for literals, and the resolution of every `field--error` / `formerror` use in `src/`.

Capture notes: grey PDF `<iframe>` on 04/05/27/28/39/40 and the 1-px voucher image on 36 remain the known headless artefacts. The sidebar reads `Fakturaer 7` in shots taken while a script's temporary draft exists (03, 03b, 30, 34, 37, 38, 49) and `6` otherwise — data, not design. The `Kunde` / `Leverandør` column widths in 08 (1440) differ by a few px from pass 6 because `Berlin Software GmbH` now fits on one line; same rule, same data.

## New and changed screenshots

| File | Screen |
|---|---|
| `shots/45-moms-1152.png` | Momsindberetning at 1152 px — the pair now **stacks**, both tables full width, every `Moms` amount complete (F1 fixed) |
| `shots/47-moms-1280.png` | **New.** Momsindberetning at 1280 px — side by side, both tables fit their wraps exactly |
| `shots/48-moms-1279.png` | **New.** Momsindberetning at 1279 px — the first stacked width; both tables full width |
| `shots/49-faktura-kladde-linjefejl.png`, `49b-faktura-kladde-linjefejl-zoom.png` | **New.** Draft editor after `Gem kladde` with quantity `abc` — "Linje 1: Ugyldigt antal: abc" under the `Fakturalinjer` legend in `--text-negative`; all four line inputs keep the normal border |
| `shots/40b-faktura-udstedt-1152-kunde-zoom.png` | Issued invoice 1001 at 1152 px, Kunde cell — first line now ends "København Ø · CVR", the grouped number on the second line (F2 fixed) |
| `shots/04-faktura-udstedt.png` | Issued invoice 1001 at 1440 px — Kunde cell on one line, spaced separator (F2 fixed) |

All 00–46 files were regenerated and reflect commit `d897fab`; 03, 08, 12, 37/38/39, 42/43, 44, 46 were inspected against pass 6 and are unchanged apart from data.

## Status of the two pass-6 findings

| # | Sev. | Finding (short) | Status | Evidence |
|---|---|---|---|---|
| F1 | minor | Momsindberetning: `Moms` column of both 6/6 tables clipped at 1152 px | **Fixed** | `measure-p7.ts`: the section computes `layout-6-6 layout-6-6--tables`; grid columns **`564px 564px` @1440, `484px 484px` @1280** (side by side, panel tops equal), **`991px` @1279, `864px` @1152** (stacked, second panel top 781 ≥ first panel bottom). Both tables equal their `.table-wrap` client width at every probe — Salg / Køb **562 / 562 @1440, 482 / 482 @1280, 989 / 989 @1279, 862 / 862 @1152** — `hiddenPx: 0` everywhere (was 14 / 37 at 1152); `numCellsOutside: []` for all 10 + 12 `Moms` / `Ekskl. moms` body and footer cells at all four widths; `document.scrollWidth === innerWidth`. Side effect the pass-6 fix predicted: the `Kunde` / `Leverandør` prose cells are one line each at 1279 and 1152 (were three at 1152), two lines at 1280 where the pair still shares the width. Visual 45, 47, 48; 08 unchanged. The same rule opened from `example.html` on disk resolves `layout-6-6 layout-6-6--tables` to `708px 708px` @1440 and `1279px` @1279 while plain `layout-6-6` stays two columns (`627.5px 627.5px`) — so the dashboard's plain 6/6 (`+page.svelte:60`) is unaffected. Source: `moms/+page.svelte:53`, `app.css:566–569` / `example.html:575–578`, `style.md:55`. |
| F2 | minor | Detail Kunde cell: no space before the `·` separator | **Fixed** | `.cell-sub` `textContent` is **`"Sundkrogsgade 21, 2100 København Ø · CVR 38 41 22 07"`** at 1440 / 1280 / 1152 (`spacedSeparator: true`); the CVR span is still one line box, `white-space: nowrap`. At 1440 the whole sub-line is one line (347 × 18 px); at 1280 and 1152 it breaks before the `nowrap` number (294 / 251 × 34 px), so the first line ends "Ø · CVR". Visual 04, 40b. Source: `fakturaer/[id]/+page.svelte:44` `{' · CVR '}`. |

Tally: 2 of 2 fixed, each by the token-free mechanism the pass-6 finding proposed (option (a) with the `1279px` threshold for F1). E1–E3 and P1–P2 remain fixed: `measure-p4.ts` / `p5.ts` / `p6.ts` re-run unchanged — editor `tableExceedsBody: 0` / `tableExceedsPanel: −17` at 1440 / 1420 / 1419 / 1280 / 1152, confirm open or closed, inputs 90 / 90 / 130 px, no clipping; the 8/4 matrix (`752px 376px` → `738.66px 369.34px` → stacked `1131px` / `992px` / `864px` for the editor, side by side down to `560px 280px` for the three plain pages) identical to passes 5 and 6; export table 718 / 611 / 526 px = wrap, `hiddenPx: 0`; Kunder CVR cells one line, mono, `nowrap` at all widths; the reference demo `752px 376px` / `1131px` / `864px` with `tableExceedsBody: 0`.

## The new line-error markup (the pass-6 "eyeball when it lands" note)

The committed markup does **not** put `field--error` on the fieldset — `fieldsetClass: "field--span-12"` after the failed save, `fieldErrorElements: []` anywhere on the page — so `.field--error .input` never matches a line input. Measured: every line input (`Beskrivelse`, `Antal`, `Enhed`, `Pris`, linje 1) computes `border-color: oklch(0.89 0.006 250)`, identical to a probe `.input` (`normalBorder`) and different from the probe `.field--error .input` (`oklch(0.48 0.15 25)` = `--status-overdue-ink`); `outlinedInputs: 0`. The error paragraph reads **"Linje 1: Ugyldigt antal: abc"**, computes `color: oklch(0.48 0.15 25)` (= `--text-negative`), `font-size: 12px` (`--text-xs`), `margin-bottom: 16px` (`--space-4` from `.formerror`), and sits between the legend and the table (legend bottom 434 → error 458–476 → table top 492), i.e. `--space-6` under the legend from the fieldset's padding and `--space-4` above the table. No panel-level `formerror` is shown for this case (`panelError: []`), so the message appears once, next to the lines it describes. Visual 49, 49b. Verdict: a correct application of the §4 error pattern to a table of inputs, where a per-cell `field--error` wrapper does not exist in the pattern file; the message names the line and the Danish field label ("antal"), consistent with the pass-1 finding-3 fix for the expense form. The `Beløb` cell shows `—` for the unparsable line and the summary panel keeps its "Udfyld mindst én linje …" problem bullet — both pre-existing behaviour, not new.

## Side-effect check

The commit's CSS surface is one additive media-query rule scoped to `.layout-6-6--tables`, which only `moms/+page.svelte:53` carries; the dashboard's plain `.layout-6-6` measured two columns in the reference probe and 01 is unchanged. The Svelte hunks are markup only: one text-expression change in the detail page (measured above), one conditional paragraph in the editor using classes that already exist in `app.css` / `example.html` (`error` 393, `formerror` 551) and were already used by the same component (`InvoiceEditor.svelte:110`). Pages that carry none of the changed classes (00–02, 05–07, 09–14, 20–39, 41–44, 46) were regenerated; 03, 12, 37, 38, 39, 42, 43 spot-checked — no change.

## CSS source audit (pass 7)

- **Raw colour**: none in `src/` (`#hex`, `rgb()`, `oklch()`, `hsl()` grep empty outside `tokens.css`).
- **Size literals in Svelte `<style>` blocks**: none — the `px|rem|em` sweep over every `<style>` block hits only the pass-3 comment in `InvoiceEditor.svelte:251`, as in passes 5 and 6.
- **`src/app.css` vs `example.html` `<style>`**: unified diff is exactly the two header comments, the `@import '../tokens.css'`, and the three known app additions (`.btn { white-space: nowrap }`, `.pdfframe`, `.fileframe`). The new media query and its comment are byte-identical in both files (`app.css:565–569`, `example.html:574–578`). Reference literals unchanged (`.brand__mark` 10 px, `.check input` 14 px, `.col-status` 152 px, `.textarea` 64 px, `@media (max-width: 1100px)` for `.kpis`, `1419px` and now `1279px` breakpoints — breakpoints are layout thresholds, not scale values, and both are documented in `style.md` §2).
- **Class resolution**: `layout-6-6--tables` 1× in `src/`, defined in both stylesheets; `field--error` is applied only to `.field` wrappers (14 places across login, udgifter, udgifter/[id], InvoiceEditor), never to a fieldset; `formerror` 5× on `<p class="error formerror">`. Every use has a definition, every definition has a use.
- **PDF template**: unchanged since pass 3. **`tokens.css`**: unchanged since pass 3. **`style.md`**: only the §2 clause changed, and it matches the measured `1279px` / `1280px` behaviour.

## New findings (pass 7)

None.

## Observations (not counted)

1. `review/measure-p7.ts` joins the earlier probes as a report-only script (it creates and deletes one draft). If the review scripts are kept, its hard checks are: moms `tables[].hiddenPx === 0` and `numCellsOutside` empty at 1440 / 1280 / 1279 / 1152, `stacked === true` below 1280; CVR `spacedSeparator === true`; editor `outlinedInputs === 0` and `errorText` non-null after a bad quantity.
2. `example.html` has no 6/6 demo, so the `--tables` modifier is exercised in the reference only by rule, not by markup (the probe injected an element). Adding a small paired-table demo would let the reference render what §2 now describes; optional.
3. Below 1280 the Momsindberetning page becomes long (two full-width tables); at 1152 the `Køb` panel starts at y 781. Acceptable — style.md §2 sanctions the stack for the 8/4 case for the same reason, and both tables are complete, which is the point of the report.
4. The line error names the offending line ("Linje 1") but not the cell; with several bad lines the message is a `;`-joined list (`invoice-form.ts:44`). Fine at `--text-xs` for one or two lines; a per-row indicator would be the next step if the pattern file ever gains one.
5. All earlier observations (red `Forfaldent` KPI without minus, chevron-less `.select`, no delivery-date field, mouse-only row click, `--text-xl` error h1, `Udsted` enabled after a failed save, density control only on Fakturaer/Udgifter, `confirmbox` placing the destructive commit rightmost, 1420–1439 band with a 189 px description input, `Åbn PDF` wrapping at 1280, `.kpis` query never firing) are unchanged and still not counted.

## Open findings: 0

- blocker: 0
- major: 0
- minor: 0
- F1 and F2 are fixed and verified with geometry at 1440 / 1280 / 1279 / 1152 and DOM text at 1440 / 1280 / 1152; the new line-error markup shows the message once, in the §4 error colour, without outlining any line input. The commit introduced no regression: its single shared rule was checked on the one element that carries it and on the reference from disk, and E1–E3, P1–P2 plus all 17 pass-1, 6 pass-2 and 2 pass-3 findings remain closed. `src/app.css` and `example.html` are in parity, `src/` carries no raw colours or size literals, `tokens.css` is unchanged, and `style.md` §2 describes the measured collapse behaviour for both the 8/4 line editor and the 6/6 paired tables.

Open findings: 0

---

# Final status (all three reviewers)

Recorded by the builder after the last confirmation passes. Each reviewer worked in a fresh context and
wrote its own report; this block only collects their closing lines.

| Reviewer | Report | Passes | Last pass reviewed | Open findings |
|---|---|---|---|---|
| Spec reviewer | `review/spec-review.md` | 3 | `370a5f3` (fixes confirmed; no spec change since) | **0** |
| Design reviewer | this file | 7 | `d897fab` (`108ff67` is test-only) | **0** |
| Quality reviewer | `review/quality-review.md` | 8 | `108ff67` | **0** |

Screenshots: `review/shots/` (49 PNGs at 1440px plus 1280/1152px probes, the issued-invoice PDF 1001 and
credit note 1006 rendered to PNG), regenerated against the final build by the design reviewer.

Verification on the final commit: `npm test` (11 files, 62 tests, unit + API incl. 10 concurrent issues,
409 on every mutation verb, VAT hand-computed values, export contents, PDF text, DB guard triggers,
migration of a populated database); `docker compose up --build` from the checkout, login, all screens on an
empty database, `npm run seed` inside the container, container destroyed and recreated with the same `/data`
volume and all data intact; `git remote -v` empty.

Open findings: 0
