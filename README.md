# Kvit (Faktura) — developer README

Invoicing and bookkeeping for one Danish business, single user, DKK only: invoices and credit notes with an unbroken
number series, expenses with receipts, quarterly VAT, a small chart of accounts (groups and archiving optional, editable
as CSV) with P&L / cashflow / balance views, a full export for the accountant with a derived journal (posteringer.csv)
that also restores the data set, and an MCP server so an AI assistant can read the books and post routine entries.
Everything lives in one data folder (a SQLite file plus the PDFs and receipts).

This file is for developers: how to run, build, test and release. Other documents:

| Audience | Document |
|---|---|
| Users (Danish) | [GUIDE.md](GUIDE.md) — the user guide, with screenshots |
| Operators | [HOSTING.md](HOSTING.md) — VPN-only setup, public hosting with Caddy, backups, updating |
| Release readers | [release-template.md](release-template.md) — the plain-language release page |
| AI integration | [mcp/README.md](mcp/README.md) — the MCP server, tools, client config |
| Design authority | [style.md](style.md), [tokens.css](tokens.css), [example.html](example.html) |
| Reviews | [review/REVIEW.md](review/REVIEW.md) — every reviewer pass, zero open findings |

The UI is Danish and shows the product name **Kvit**; the repository, image and binaries are called *Faktura*.

## Stack

- SvelteKit 2 (Svelte 5 runes) on adapter-node, TypeScript throughout.
- SQLite via Drizzle ORM and better-sqlite3 (WAL). Migrations in `drizzle/`, applied at startup. There is no other
  database option by design: the data directory is the deployment unit.
- Server-side PDF rendering with Playwright/Chromium from an HTML template that uses the same design tokens as the UI.
- One Docker image (Playwright base) running both the app and the MCP server; standalone binaries built with Bun.

## Prerequisites

Node 22.12 or newer and npm. For PDFs from source: `npx playwright install chromium` (Docker has Chromium built in).
For the standalone binaries: [Bun](https://bun.sh). For the installers and smoke tests: Docker with the compose plugin.

## Run from source

```bash
npm install
npx playwright install chromium
cp .env.example .env          # set APP_PASSWORD (and DATA_DIR, e.g. ./data)
npm run dev                   # http://localhost:3000
npm run seed                  # demo data into DATA_DIR (empty database only)
```

`.env` is read at startup when running from source (`src/lib/server/env.ts`, Node's `process.loadEnvFile`); variables
already in the shell win. The file is git- and docker-ignored.

Environment variables:

| Variable | Meaning | Default |
|---|---|---|
| `APP_PASSWORD` | the one login password (required) | – |
| `API_TOKEN` | bearer token for `/api/*` (used by the MCP server); at least 16 characters; unset = bearer auth off | unset |
| `DATA_DIR` | database, PDFs, receipts, `backups/` | `/data` |
| `PROJECT_ROOT` | where `tokens.css`, `style.md`, `example.html` and `drizzle/` live | working directory |
| `PORT`, `HOST` | adapter-node listen address | `3000`, `0.0.0.0` |
| `BODY_SIZE_LIMIT` | request body cap; bilag uploads are refused above 20 MB regardless, the cap exists for restoring an export zip | `512M` in Docker and the binaries |
| `ADDRESS_HEADER`, `XFF_DEPTH` | trusted proxy header for the login throttle (adapter-node) | unset |
| `TZ` | log timestamps only; business dates are always computed in Europe/Copenhagen | – |

Note for the build: SvelteKit's post-build analysis imports the server code, which opens the database at `DATA_DIR`
on import. On a machine where `/data` is not writable, set `DATA_DIR` to scratch space before `npm run build` (the CI
workflows do this).

## Run with Docker (as a developer)

```bash
export APP_PASSWORD='a-long-password'
docker compose up -d --build         # http://localhost:3000
docker compose exec app npm run seed # demo data
```

The repo's `docker-compose.yml` is the developer setup. End users get a generated compose file from the installer
(`install.sh` / `install.ps1`), which also runs the MCP server as a second service; see *Distribution* below. Never run
the seed from the host against a data directory a running container has open: Docker Desktop bind mounts do not share
SQLite's `-shm` file.

## Build

```bash
npm run build                 # SvelteKit -> build/ (node build to run it)
npm --prefix mcp run build    # MCP server -> mcp/dist
npm run check                 # svelte-kit sync + svelte-check
```

## Tests

```bash
npm test                      # builds, then unit + API tests (seeds a temp DATA_DIR and boots node build)
npm run test:unit             # unit only (format helpers, populated-database migration incl. the pre-migration copy, docs checks)
npm run test:docs             # documentation checks only (disclaimer verbatim, guide sections, screenshots, site, workflows)
npm run mcp:test              # builds the app, then the MCP integration tests against a seeded instance
npm run test:install          # Docker: installer smoke test (served script piped into bash, login, idempotent rerun, secret scan)
bash tests/install/binary-smoke.sh   # Docker: the linux-x64 binary on ubuntu:24.04 without Node
```

Test layout: `tests/unit/` runs in-process; `tests/api/` runs against the built server started by
`tests/global-setup.ts` (files run alphabetically so `00-finance` sees untouched seed data); `mcp/test/` drives a real
MCP client over an in-memory transport; `tests/install/` needs Docker and is run by CI, not by `npm test`.

## Project layout

```
src/lib/server/services/   business rules: invoices (numbering, issue, credit), expenses, finance, cash, accounts (+ CSV), attachments,
                           journal (derived posteringer.csv), export, restore (export zip -> data set, with data.bakNN copies)
src/lib/server/db.ts       database bootstrap, migrations, REQUIRED_TRIGGERS assertion, pre-migration copies
src/lib/server/audit.ts    append-only audit log with the request actor (ui | api)
src/lib/server/pdf.ts, invoice-template.ts   Playwright rendering, the invoice HTML template
src/routes/(app)/          screens (Danish); src/routes/api/  JSON API (form actions and API share the services)
src/lib/format.ts          shared client/server formatting (øre, dates, quarters)
drizzle/                   migrations + journal (drizzle-kit generate)
mcp/                       the MCP server package (own package.json, tests, README)
packaging/                 runtime staging, Bun binaries, release script
tests/                     unit, api, install
review/                    reviewer reports and screenshots
site/                      the product site (Danish), deployed to GitHub Pages
scripts/                   seed.ts, site-shots.ts
```

## Rules built into the code

- Invoice numbers are assigned only at issue, from `next_invoice_number` in `setting`, in the same transaction that
  flips the status and stores the PDF path; issues are serialised by an in-process lock, so the series never has a gap.
  The number can only be raised (audited) in Settings.
- Issued invoices and their lines are immutable and undeletable, enforced by SQLite triggers listed in
  `REQUIRED_TRIGGERS` (the app refuses to start if any is missing). The only correction is a credit note.
- The PDF written at issue (`files/invoices/{number}.pdf`, attachments merged behind it) is the legal document and is
  never regenerated. Drafts get an on-the-fly UDKAST preview instead.
- All money is integer øre. Accrual views (P&L, VAT) run on document dates; cash views run on payment dates.
- Every write is audit-logged; writes through the bearer token carry `actor = api`.
- Before any pending migration on a populated database, a consistent copy is written to `DATA_DIR/backups/`.

## Data and migrations

Everything persistent is under `DATA_DIR`: `app.db` (+ `-wal`, `-shm`), `files/invoices/{number}.pdf`,
`files/invoices/bilag/` (invoice attachments), `files/expenses/{voucher}.{pdf,jpg,png}`, `backups/`.

Schema changes: edit `src/lib/server/schema.ts`, run `npm run db:generate` (drizzle-kit; renames are ambiguous without a
TTY, so add-then-drop in two steps), and re-create any trigger a table rebuild drops (`REQUIRED_TRIGGERS` will tell
you). `tests/unit/migration.test.ts` migrates a populated version-0 database and checks the pre-migration copy.

## Design authority

`tokens.css`, `style.md` and `example.html` in the repo root are mandatory (the app halts without them) and are the only
place colours, type, spacing, radii and shadows are defined. `src/app.css` is the example's style block plus app
additions, documented in style.md. Fonts (Archivo, IBM Plex Mono) are self-hosted via `@fontsource` and embedded in PDFs.
The brand mark and favicon are in `static/`.

## MCP server

`mcp/` is a separate package: a thin HTTP client over the app's JSON API with a bearer token, exposing 15 tools over stdio
and streamable HTTP. It never opens the database. Issuing and crediting invoices are intentionally not possible through
it. `npm run mcp` starts it over stdio and reads `mcp/.env` (or falls back to `API_TOKEN` and `PORT` from the root
`.env`); see [mcp/README.md](mcp/README.md).

## Distribution

- `install.sh` / `install.ps1`: Docker-based installers (four questions, hidden secrets, `.env` + compose written into
  the chosen directory, app + MCP services, health check). An optional fifth answer adds HTTPS: `tailscale` runs
  `tailscale serve` for a tailnet-only address with a real certificate, `local` adds a Caddy service with its own CA for
  `kvit.localhost` (HOSTING.md, section 1). Idempotent; smoke-tested by `tests/install/run.sh`, including the local TLS
  path and the MCP handshake through the proxy.
- `packaging/`: Bun-compiled standalone binaries for linux-x64, darwin-arm64 and windows-x64. The binary carries the
  built app and its production dependencies, runs the same wizard, downloads Chromium on first start, and supervises the
  app and the MCP server as child processes. Only linux-x64 is executed in CI; Windows was verified by hand, macOS is
  built but untested.
- `npm run release`: `dist/` with the installers (repository and image filled in), the three binaries, `SHA256SUMS`,
  `VERSION` and release notes rendered from `release-template.md`. Version = git tag (`v1.2.3` → `1.2.3`), otherwise
  `0.0.0-dev.<sha>`.
- Workflows: `ci.yml` (lint, typecheck, all suites, Docker build, installer and binary smoke tests, docs checks),
  `release.yml` on `v*` tags (calls `npm run release`, pushes the amd64/arm64 image, creates the release),
  `pages.yml` (deploys `site/`). The workflows call the npm scripts; there is no second copy of the logic.

## Security notes

One shared password compared in constant time; the session is an HMAC of it in an `HttpOnly`, `SameSite=Lax` cookie
(30 days). Five failed logins from one address pause that address for 30 seconds, and failures are logged. CSRF is a
host-relative Origin check; a Content-Security-Policy is set. The cookie is not `Secure` because the app speaks plain
HTTP on a private network: put TLS in front (HOSTING.md) before exposing it. Faktura is built for one user on a private
network and has not been security audited.

## Licence and contributions

Commit small, working slices with imperative messages. Every slice gets tests, a manual run, and a reviewer pass
recorded in `review/REVIEW.md`.
