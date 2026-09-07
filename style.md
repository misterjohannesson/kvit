# Style guide — invoicing & bookkeeping

Single-user Danish invoicing app: invoices (fakturaer), expenses (udgifter), quarterly VAT report (momsindberetning). One person, at a desk, doing accounting they do not enjoy. The interface's job is to be legible, predictable, and quiet — and to be trustworthy about numbers.

**Design position:** Scandinavian administrative utility. Paper-white surfaces, hairline rules, ink-blue as the only accent, numbers in monospace. Structure comes from alignment and rules, never from shadows or coloured panels. Density is high but the page never feels busy, because there is exactly one accent, one red, and one strong button per screen.

Everything below references tokens from `tokens.css`. Component CSS must not contain raw colour, size, or spacing literals.

---

## 1. Typography

| Role | Token | Notes |
|---|---|---|
| UI text | `--font-ui` | Helvetica Neue / Helvetica, system fallback. Neutral grotesque, no personality tax. |
| Numbers, dates, IDs | `--font-numeric` (mono) | **Mandatory** for all amounts, dates, invoice numbers, CVR, VAT rates, account numbers. |

Base size is `--text-sm` (13px). This is the size of table cells, form fields, and most body copy — dense enough to see a quarter of invoices without scrolling, large enough to read all day.

**Scale usage**

- `--text-2xl` page title (one per screen, `--weight-semibold`, `--tracking-tight`)
- `--text-xl` section headings inside a page
- `--text-lg` card titles, sub-totals
- `--text-3xl` KPI figures and the invoice grand total — the only places large type is allowed
- `--text-sm` tables, forms, body
- `--text-xs` field labels, badges, helper text, column heads
- `--text-2xs` secondary metadata inside a cell (e.g. "sendt 12.03")

**Rules**

1. Amounts are right-aligned, `--font-numeric`, `font-variant-numeric: tabular-nums`, thousands separated with `.` and decimals with `,` (Danish): `12.450,00 kr.` Currency suffix is `--text-secondary`, never bold.
2. Negative amounts and credit notes: minus prefix **and** `--text-negative`. Never parentheses; never colour alone.
3. Dates are `DD.MM.YYYY` in mono. Relative dates are permitted only as secondary metadata ("om 4 dage") at `--text-2xs`.
4. Column heads are uppercase, `--text-xs`, `--weight-medium`, `--tracking-wide`, `--text-label`. Nothing else in the UI is uppercase.
5. Never bold body text for emphasis. Use `--text-primary` vs `--text-secondary` to create hierarchy.
6. Line length for prose is capped at `--layout-prose-max`.

---

## 2. Layout grid

Desktop-first, 1440px design target, usable from 1152px. No mobile layout — this is desk work.

```
┌────────────┬──────────────────────────────────────────────┐
│  sidebar   │  topbar  (--layout-topbar-height)            │
│  224px     ├──────────────────────────────────────────────┤
│  (--layout│  content: max --layout-content-max,           │
│  -sidebar-│  padded --layout-gutter, centred              │
│  width)    │                                              │
└────────────┴──────────────────────────────────────────────┘
```

- Content area is a 12-column grid (`--layout-columns`) with `--layout-column-gap`. Only three column splits are sanctioned: **12** (tables, full-width), **8 / 4** (form + summary sidebar), **6 / 6** (paired panels, e.g. VAT sales vs. purchases). An 8 / 4 that holds a line-item editor (`layout-8-4--lines`) stacks to one column below 1420px, and a 6 / 6 of paired data tables (`layout-6-6--tables`) stacks below 1280px; plain 8 / 4 detail pages stay side by side down to 1152px.
- Vertical rhythm is a multiple of `--space-2`. Section spacing: `--space-8` between major sections, `--space-6` between a heading and its content, `--space-4` inside a panel.
- Panels are `--bg-surface` on `--bg-canvas`, `--border-default-style`, `--radius-md`, **no shadow**. Shadows are reserved for things that float: dropdowns, modals, sticky bars.
- Page header pattern: eyebrow (`--text-xs`, `--text-secondary`) → title (`--text-2xl`) → the primary action, right-aligned on the same baseline as the title.
- Sticky elements (table head, save bar) use `--shadow-sticky` and `--z-sticky`.

---

## 3. Table density

Tables are the product. They get the most attention.

- Row height `--table-row-height` (36px) by default; a per-user **Kompakt** toggle switches to `--table-row-height-dense` (30px). Both keep `--table-cell-pad-x` horizontally.
- Cell padding: `--table-cell-pad-y` / `--table-cell-pad-x`. Line height `--leading-snug`.
- **Horizontal hairlines only** (`--table-rule`). No vertical rules, no zebra striping by default — alignment separates columns. `--bg-row-alt` zebra is allowed only for tables wider than 8 columns (e.g. the VAT ledger).
- Head: `--bg-header`, sticky, bottom border `--border-strong-style`. Head text per §1.5.
- Hover `--bg-row-hover`; selected `--bg-row-selected` plus a `--border-width-thick` left edge in `--focus-ring`. Whole row is the click target for the detail view.
- Column order for the invoice list, fixed: `Nr.` · `Kunde` · `Udstedt` · `Forfald` · `Status` · `Beløb ekskl.` · `Moms` · `Beløb i alt` · row actions.
- Numeric columns right-aligned, text left-aligned, status centre-left in a fixed-width column so badges form a clean vertical band. Never centre numbers.
- Totals row: top border `--border-strong-style`, `--weight-semibold`, no fill.
- Overdue rows are **not** tinted red. The badge carries the state; tinting a row makes a healthy quarter look like a crisis.
- Empty state: single centred line at `--text-sm` / `--text-secondary` plus one secondary button. No illustrations.

---

## 4. Forms

- One column. Label above field, always: `--text-xs`, `--weight-medium`, `--text-label`, `--space-1` below.
- Field height `--control-height`, `--radius-sm`, `--border-default-style`, `--bg-surface`, padding `--control-pad-x`, text `--text-sm`.
- Width follows content, capped at `--field-max-width`: amounts and dates get short fields (`--field-width-sm`), quantities and units the narrowest (`--field-width-xs`), file pickers `--field-width-md`, names get wide ones. Grid spans 2/3/4/5/6/8/12 are available so a name can be wider than the CVR next to it. Never stretch a date field across the panel.
- Amount and date inputs use `--font-numeric` and `text-align: right` for amounts.
- Hover `--border-strong`; focus `--focus-ring-width` outline in `--focus-ring` at `--focus-ring-offset`, border becomes `--accent-500`. Focus is always visible — keyboard entry is the primary input method for bookkeeping.
- Disabled/read-only: `--bg-disabled`, `--text-disabled`, border `--border-default`.
- Helper text `--text-xs` / `--text-secondary` below the field. Error text replaces it in `--text-negative`, with the border switched to `--status-overdue-ink`. Colour is never the only error signal — the message is always present.
- Required fields are unmarked; **optional** ones are marked "(valgfri)". In this app nearly everything is required.
- Grouping: related fields sit in a fieldset with an `--text-xs` uppercase-free legend and `--border-hairline-style` top rule. Line-item editors are tables, not stacks of fields.
- Form footer actions are right-aligned, primary rightmost, `--space-2` gap, above them a `--border-hairline-style` rule with `--space-6` breathing room.

---

## 5. Status badges

Five states. Text label always present; hue is a reinforcement, never the message.

| State | Meaning | Tokens |
|---|---|---|
| `Kladde` | not yet issued | `--status-draft-*` |
| `Åben` | issued, not due | `--status-open-*` |
| `Forfalden` | past due | `--status-overdue-*` |
| `Betalt` | settled | `--status-paid-*` |
| `Krediteret` | credit note issued | `--status-credited-*` |
| `Kreditnota` | the credit-note document itself (it is neither open nor paid) | `--status-credited-*` |

`Kreditnota` is a document type sitting in the status column: it reuses the credited tokens, never gets a paid date, and its `Kunde` cell names the invoice it credits.

Construction: `--text-xs`, `--weight-medium`, `--radius-xs`, padding `--space-1` / `--space-2`, `1px` border in `*-border`, fill `*-surface`, text `*-ink`. Sentence case, one word. No dots, no icons, no pills.

- All four ramps share lightness and chroma budgets, so no single status dominates a scanned column.
- `Forfalden` may add a mono day count as separate secondary text next to the badge (`+12 dage`), not inside it.
- `Krediteret` additionally renders the invoice number with a strikethrough in the `Nr.` column.
- Badges are never interactive. Status changes happen through actions ("Registrér betaling"), never by clicking a badge.

---

## 6. Buttons and the one primary action

**"Udsted"** (issue invoice) is the app's single most consequential action: it assigns a sequential invoice number and makes the document legally binding for Danish bookkeeping. It is the only place the strongest visual weight in the system is used.

- **Primary** — `--grey-900` fill, `--text-inverse`, `--radius-sm`, `--control-height-lg` when it is the page's main commit action (`Udsted`, `Bogfør`, `Indberet moms`), otherwise `--control-height`. `--weight-medium`. **Exactly one per screen.** Ink, not accent: it must read as gravity, not as marketing.
- **Secondary** — `--bg-surface`, `--border-default-style`, `--text-primary`. Everything reversible: `Gem kladde`, `Forhåndsvis`, `Annullér`.
- **Tertiary / link** — text only in `--text-link`, no border. Row actions and inline navigation.
- **Destructive** — secondary shell with `--status-overdue-ink` text and border on hover. Never a red fill. `Slet kladde`, `Krediter faktura` — both behind confirmation.
- Heights from `--control-height*`; padding `--control-pad-x` (×2 for the primary commit action). Icon-only buttons are square at the same height. A primary that is merely the page's single save (`Gem`, `Opret kunde`, `Log ind`) takes the `btn--std` modifier: `--control-height`, normal padding.
- Focus: same ring as fields. Disabled: `--bg-disabled` / `--text-disabled`, no border change.
- `Udsted` is disabled until the invoice validates, and always confirms: *"Fakturaen får nummer 2026-0043 og kan herefter kun annulleres med en kreditnota."*
- Order in a footer: destructive far left, then secondary, primary rightmost.

---

## 7. Print rules — invoice template

The printed/PDF invoice is a legal document, not a screenshot of the UI. `tokens.css` re-points colour tokens to ink values under `@media print`, so component CSS needs no colour overrides.

- A4 portrait, `--print-page-width` × `--print-page-height`; margins `--print-margin-top` / `--print-margin-side` / `--print-margin-bottom`.
- Base size `--print-text-size` (9.5pt), leading `--print-leading`. Nothing below `--print-text-small` (8pt). Amounts stay mono.
- Hide: sidebar, topbar, all buttons, filters, row actions, hover affordances, badges' fills.
- Header block: sender identity (name, address, CVR) top-left; document title `Faktura` and, on a credit note, `Kreditnota` at `--text-4xl` top-right, with number, issue date and due date in a mono key/value list beneath.
- Line-item table: header row with a `--print-rule` above and below; rows separated by `--border-hairline`; no fill. `page-break-inside: avoid` on each row; `thead { display: table-header-group }` so headers repeat.
- Totals block bottom-right, max 70mm wide: subtotal, VAT (`Moms 25%`), total. Total gets a `--print-rule` above and `--weight-semibold` at `--text-lg` (the `--text-3xl` rule in §1 is for screen KPIs; at 9.5pt body copy the printed total stays at `--text-lg`). Amounts right-aligned to a shared edge with the line-item amounts; the currency belongs in the total's label ("I alt inkl. moms, DKK"), never after the digits, so it cannot push them off that edge.
- Footer repeats on every page (`position: fixed; bottom: 0` inside the print root): payment details (bank/konto, betalingsbetingelser), and `Side X af Y`.
- Required Danish statutory content must be present and never clipped: sender name & address, CVR-nummer, invoice number, issue date, delivery date if different, buyer name & address, description, VAT rate and amount per rate, total ex. and incl. VAT, payment terms. Reverse-charge or exempt lines print their statutory note at `--print-text-small`.
- No background images, no logos larger than 30mm wide, no colour beyond black/greys — the file must print correctly on a monochrome office printer.
- `orphans: 3; widows: 3` on prose; never break the totals block or the footer across pages.
