# Review record

Every slice of this project went through fresh-context reviewer passes before it was committed: a **spec reviewer**
(behaviour against the written specification), a **design reviewer** (screenshots of every screen and the invoice PDF
at 1440 px, judged against `tokens.css`, `style.md` and `example.html`), a **quality reviewer** (validation,
transaction boundaries, error handling, secrets, dependencies) and, for the distribution work, a **user-run reviewer**
who installed the product as a user would and checked both guides against the running app. Findings became fix tasks,
the relevant reviewer re-ran, and a slice was closed only at zero open findings.

## Passes and outcomes

| Slice | Reviewers | Findings raised | Open at close |
|---|---|---|---|
| App core (invoicing, expenses, VAT, export, audit spine) | spec, design, quality | 3 passes, all fixed (line-item table geometry, token literals, date inputs, CSRF, PDF archive atomicity, credit-note rounding) | 0 |
| Bookkeeping (kontoplan, cash movements, resultat / cashflow / balance, afstemning) | spec, design, quality | fixed (opening-balance cut-off, credit notes as liabilities, exact-øre finance tests) | 0 |
| Invoice editor: date pickers, payment terms per customer, payment reference | design | native date inputs recorded as an owner decision in `style.md` | 0 |
| Cashflow forecast, attachments, draft preview, sent status, loading indicator | design, quality | fixed (drizzle subquery qualification, forecast row styling) | 0 |
| Kvit "Kontor" design adoption | design | fonts self-hosted, brand mark, VAT deadline in the rail, one accent KPI per screen | 0 |
| MCP server + bearer API | spec, quality, two verification passes | 8 + 17 raised; fixed (atomic draft creation, DNS-rebinding protection, strict bearer handling, reconcile computed once, quarter parsing) | 0 |
| Distribution (installers, binaries, release, HOSTING, GUIDE, site, workflows) | spec, quality, user-run, two verification passes | 13 + 34 + 21 raised; fixed (compose-safe `.env` quoting, PowerShell 5.1 native calls, real repository URLs, `.env`-driven proxy settings, `backups/` from first start, launcher edges) | 0 |

## What is verified automatically

- `npm test`: unit tests (formatting, populated-database migration with the pre-migration copy, documentation
  checks) and API tests against a seeded, built server: strictly sequential numbering under 10 concurrent issues,
  409 on every mutation of an issued document, hand-computed VAT and finance figures in exact øre, export with six
  CSVs, PDF text, database guard triggers, bearer token and audit actor.
- `npm run mcp:test`: a real MCP client over an in-memory transport against the seeded app: tool surface and schemas,
  exact-øre reads, every write tool with `actor = api`, reconcile delta then nothing, wrong and missing tokens.
- `npm run test:install` and `tests/install/binary-smoke.sh` (Docker): the installer piped into bash, login, idempotent
  rerun, secret scan; the linux-x64 binary on a clean Ubuntu container without Node.
- `npm run test:docs`: the hosting disclaimer verbatim and first, guide sections and screenshots, release template,
  site, workflow YAML.

## Screenshots

`review/shots/` holds the screenshots the user guide embeds; `review/shots.ts` regenerates the full set from a seeded
instance (`BASE_URL=http://localhost:3101 APP_PASSWORD=… npx tsx review/shots.ts`). `scripts/site-shots.ts` produces
the product-site images.

Open findings: 0
