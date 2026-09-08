# Kvit — style guide

**Kvit** — from Danish *kvit og frit*: settled, square, nothing outstanding. That is the product's promise and the whole point of the tool: get to zero, four times a year, without drama.

Single-user Danish invoicing app: invoices (fakturaer), expenses (udgifter), quarterly VAT report (momsindberetning). One person, at a desk, doing accounting they do not enjoy. The interface's job is to be legible, predictable and quiet — and to be trustworthy about numbers.

**Design position — "Kontor".** Scandinavian administrative utility with a spine. A deep slate-navy navigation rail frames a warm-light work area: it gives the data an edge to sit against, cuts the glare of an all-white screen, and keeps every pixel of colour budget inside the chrome rather than on the numbers. Structure comes from alignment and hairline rules, never from shadows or coloured panels. Density is high but the page never feels busy, because there is exactly one warm colour, one red, and one strong button per screen.

**Brand elements**

- Wordmark: `Kvit` in Archivo 600, `--tracking-tight`, with `Bogholderi` beneath at `--text-2xs` uppercase in `--nav-muted`.
- Mark: a `26px` brass square (`--brand-mark-bg`, `--brand-mark-radius`) carrying a dark-ink **K**. It is the only brass surface outside the primary button — the mark and "Udsted" are visually the same material, which is the point: the brand *is* the act of issuing.
- Brass (`--brass-*`) is a budget, not a palette. If a screen has brass in three places, two of them are wrong.

Everything below references tokens from `tokens.css`. Component CSS must not contain raw colour, size or spacing literals.

---

## 1. Typography

| Role | Token | Notes |
|---|---|---|
| UI text | `--font-ui` | **Archivo** 400/500, Helvetica fallback. Grotesque with slightly narrow, squared-off forms — it holds up at 11–13px in dense tables and gives the brand a Danish-signage character without becoming decorative. |
| Headings, wordmark | `--font-display` (= Archivo, `--display-weight` 600) | Same family, heavier weight, `--tracking-tight`. One family only; hierarchy comes from weight and size. |
| Numbers, dates, IDs | `--font-numeric` (**IBM Plex Mono**) | **Mandatory** for all amounts, dates, invoice numbers, CVR, VAT rates, account numbers. |

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
│ NAVY RAIL  │  topbar  (--layout-topbar-height)            │
│ --nav-bg   ├──────────────────────────────────────────────┤
│ 224px      │  content: max --layout-content-max,          │
│            │  padded --layout-gutter, on --bg-canvas      │
│            │                                              │
└────────────┴──────────────────────────────────────────────┘
```

**The rail** is `--nav-bg` full-height, with its own token set (`--nav-text`, `--nav-muted`, `--nav-hover`, `--nav-active-bg`). The active item gets `--nav-active-bg` plus a `--border-width-thick` left edge in `--nav-active-edge` (brass) — the only brass in the rail besides the mark. Group labels are `--text-2xs` uppercase `--tracking-wider` in `--nav-muted`. The rail's footer pins the current VAT deadline: this app exists because of that date.

Never place data, tables or amounts on the dark rail; it is navigation and status only. The work area never goes dark.

- Content area is a 12-column grid (`--layout-columns`) with `--layout-column-gap`. Only three column splits are sanctioned: **12** (tables, full-width), **8 / 4** (form + summary sidebar), **6 / 6** (paired panels, e.g. VAT sales vs. purchases).
- Vertical rhythm is a multiple of `--space-2`. Section spacing: `--space-8` between major sections, `--space-6` between a heading and its content, `--space-4` inside a panel.
- Panels are `--bg-surface` on `--bg-canvas`, `--border-default-style`, `--radius-md`, **no shadow**. Shadows are reserved for things that float: dropdowns, modals, sticky bars.
- Panel headers and footers use `--bg-panel-head`; table heads `--bg-thead`, totals rows `--bg-tfoot`. These three faint slate tints are what replace white-on-white — the panel reads as a stack of bands rather than one flat sheet.
- One KPI card per screen may use `.kpi--accent` (`--brass-100` / `--brass-200`) — the number the user came to see. Never two.
- Page header pattern: eyebrow (`--text-xs`, `--text-secondary`) → title (`--text-2xl`) → the primary action, right-aligned on the same baseline as the title.
- Sticky elements (table head, save bar) use `--shadow-sticky` and `--z-sticky`.

---

## 3. Table density

Tables are the product. They get the most attention.

- Row height `--table-row-height` (36px) by default; a per-user **Kompakt** toggle switches to `--table-row-height-dense` (30px). Both keep `--table-cell-pad-x` horizontally.
- Cell padding: `--table-cell-pad-y` / `--table-cell-pad-x`. Line height `--leading-snug`.
- **Horizontal hairlines only** (`--table-rule`). No vertical rules, no zebra striping by default — alignment separates columns. `--bg-row-alt` zebra is allowed only for tables wider than 8 columns (e.g. the VAT ledger).
- Head: `--bg-thead`, sticky, bottom border `--border-strong-style`. Head text per §1.5.
- Hover `--bg-row-hover`; selected `--bg-row-selected` plus a `--border-width-thick` left edge in `--focus-ring`. Whole row is the click target for the detail view.
- Column order for the invoice list, fixed: `Nr.` · `Kunde` · `Udstedt` · `Forfald` · `Status` · `Beløb ekskl.` · `Moms` · `Beløb i alt` · row actions.
- Numeric columns right-aligned, text left-aligned, status centre-left in a fixed-width column so badges form a clean vertical band. Never centre numbers.
- Totals row: top border `--border-strong-style`, `--weight-semibold`, `--bg-tfoot`.
- Overdue rows are **not** tinted red. The badge carries the state; tinting a row makes a healthy quarter look like a crisis.
- Empty state: single centred line at `--text-sm` / `--text-secondary` plus one secondary button. No illustrations.

---

## 4. Forms

- One column. Label above field, always: `--text-xs`, `--weight-medium`, `--text-label`, `--space-1` below.
- Field height `--control-height`, `--radius-sm`, `--border-default-style`, `--bg-surface`, padding `--control-pad-x`, text `--text-sm`.
- Width follows content, capped at `--field-max-width`: amounts and dates get short fields (~120px), names get wide ones. Never stretch a date field across the panel.
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

Construction: `--text-xs`, `--weight-medium`, `--radius-xs`, padding `--space-1` / `--space-2`, `1px` border in `*-border`, fill `*-surface`, text `*-ink`. Sentence case, one word. No dots, no icons, no pills.

- All four ramps share lightness and chroma budgets, so no single status dominates a scanned column.
- `Forfalden` may add a mono day count as separate secondary text next to the badge (`+12 dage`), not inside it.
- `Krediteret` additionally renders the invoice number with a strikethrough in the `Nr.` column.
- Badges are never interactive. Status changes happen through actions ("Registrér betaling"), never by clicking a badge.

---

## 6. Buttons and the one primary action

**"Udsted"** (issue invoice) is the app's single most consequential action: it assigns a sequential invoice number and makes the document legally binding for Danish bookkeeping. It is the only place the strongest visual weight in the system is used.

- **Primary** — brass: `--primary-bg` fill, `--primary-ink` (dark) text, `--primary-shadow`, `--radius-sm`, `--control-height-lg` when it is the page's main commit action (`Udsted`, `Bogfør`, `Indberet moms`), otherwise `--control-height`. `--weight-medium`. **Exactly one per screen.** Brass is the only warm surface in the UI, so the eye finds it instantly without the button having to be large or loud — and because the label sits in dark ink on a light-warm fill, it reads as a physical key, not a marketing CTA.
- **Secondary** — `--bg-surface`, `--border-default-style`, `--text-primary`. Everything reversible: `Gem kladde`, `Forhåndsvis`, `Annullér`.
- **Tertiary / link** — text only in `--text-link`, no border. Row actions and inline navigation.
- **Destructive** — secondary shell with `--status-overdue-ink` text and border on hover. Never a red fill. `Slet kladde`, `Krediter faktura` — both behind confirmation.
- Heights from `--control-height*`; padding `--control-pad-x` (×2 for the primary commit action). Icon-only buttons are square at the same height.
- Focus: same ring as fields (`--focus-ring`, the informational blue — never brass, so focus is never confused with primacy). Disabled: `--bg-disabled` / `--text-disabled`, no border change; a disabled `Udsted` loses its brass entirely.
- Segmented controls mark the active segment with `--nav-bg` and `--nav-active-ink` — the rail's own colour, reused so filters read as navigation rather than as data.
- `Udsted` is disabled until the invoice validates, and always confirms: *"Fakturaen får nummer 2026-0043 og kan herefter kun annulleres med en kreditnota."*
- Order in a footer: destructive far left, then secondary, primary rightmost.

---

## 7. Print rules — invoice template

The printed/PDF invoice is a legal document, not a screenshot of the UI. `tokens.css` re-points colour tokens to ink values under `@media print`, so component CSS needs no colour overrides.

- A4 portrait, `--print-page-width` × `--print-page-height`; margins `--print-margin-top` / `--print-margin-side` / `--print-margin-bottom`.
- Base size `--print-text-size` (9.5pt), leading `--print-leading`. Nothing below `--print-text-small` (8pt). Amounts stay mono.
- Hide: the navy rail, topbar, all buttons, filters, row actions, hover affordances, badges' fills. **Neither the rail nor brass ever prints** — `@media print` in `tokens.css` re-points `--nav-*` and `--primary-*` to white/black.
- The wordmark prints as text (`Kvit`, `--font-display`), not as the brass mark: the invoice is a legal document, not a brand surface.
- Header block: sender identity (name, address, CVR) top-left; document title `Faktura` and, on a credit note, `Kreditnota` at `--text-4xl` top-right, with number, issue date and due date in a mono key/value list beneath.
- Line-item table: header row with a `--print-rule` above and below; rows separated by `--border-hairline`; no fill. `page-break-inside: avoid` on each row; `thead { display: table-header-group }` so headers repeat.
- Totals block bottom-right, max 70mm wide: subtotal, VAT (`Moms 25%`), total. Total gets a `--print-rule` above and `--weight-semibold`. Amounts right-aligned to a shared edge with the line-item amounts.
- Footer repeats on every page (`position: fixed; bottom: 0` inside the print root): payment details (bank/konto, betalingsbetingelser), and `Side X af Y`.
- Required Danish statutory content must be present and never clipped: sender name & address, CVR-nummer, invoice number, issue date, delivery date if different, buyer name & address, description, VAT rate and amount per rate, total ex. and incl. VAT, payment terms. Reverse-charge or exempt lines print their statutory note at `--print-text-small`.
- No background images, no logos larger than 30mm wide, no colour beyond black/greys — the file must print correctly on a monochrome office printer.
- `orphans: 3; widows: 3` on prose; never break the totals block or the footer across pages.
