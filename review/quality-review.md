# Quality review – engineering practice

Scope: input validation, transaction boundaries, error handling, auth/session, dependencies, tests, Docker/README, duplication, SQL safety, concurrency, dates, money rounding. Visual/design and spec conformance are out of scope.

Method: read every file under `src/`, `tests/`, `scripts/`, `drizzle/`, the Dockerfile/compose/README, and the relevant SvelteKit/adapter-node runtime code in `node_modules` to verify assumptions. Ran `npm run check` (0 errors, 0 warnings), `npm audit`, and `npx vitest run tests/unit` (6/6 pass – note that this run also executed `tests/global-setup.ts`, i.e. seeded a temp DB and started/stopped the built server, see finding 10). Verified the rounding and timezone claims with small Node one-liners.

## Summary

| Severity | Count |
|---|---|
| blocker | 0 |
| major | 7 |
| minor | 17 |
| nit | 12 |

The core invariants (sequential numbering under a lock, immutability of issued documents, integer øre, parameterised SQL) are implemented carefully and mostly hold. The majors are: a real accounting bug in credit-note VAT rounding, invoice dates computed in UTC rather than Danish time, a crash window that leaves the number series permanently blocked, a backup/restore procedure in the README that does not restore the consistent copy it made, CSRF protection switched off globally, `.env` baked into the Docker image, and the fact that the form-action (UI) code paths have zero test coverage.

---

## Findings

### 1. [major] Credit note VAT is recomputed with `Math.round`, so it does not always net the original to zero

`src/lib/server/services/invoices.ts:64` and `:337-342`

`computeTotals` rounds `subtotal / 4` half-up towards +∞. `creditInvoice` negates the line totals and calls `computeTotals` again on the negative subtotal, so `Math.round(-x.5)` gives `-x` while the original had `x+1`. Verified: subtotal 10 002 øre → original VAT 2 501, credit note VAT −2 500. This happens whenever `subtotalOre % 4 == 2`, and produces a 1-øre residual in the VAT report and in "credit note nets to zero" reasoning that an auditor will notice. `tests/api/vat.test.ts:55-61` only checks the seed pair (1 200 000 øre, divisible by 4) so it cannot catch this.

Fix: a credit note must be the exact negation of the stored document, not a recomputation. In `creditInvoice` use `subtotalOre: -orig.subtotalOre, vatOre: -orig.vatOre, totalOre: -orig.totalOre, vatRateBp: orig.vatRateBp` and drop the `computeTotals(lines, …)` call. Add a unit test for `computeTotals` with a subtotal ≡ 2 (mod 4) and an API test asserting `credit.vatOre === -orig.vatOre` on such an invoice.

### 2. [major] `todayIso()` is UTC; invoice/credit-note/paid dates and "overdue" flip at 01:00/02:00 Danish time, not midnight

`src/lib/format.ts:538-540`, used by `createDraft` (`invoices.ts:159`), `creditInvoice` (`:336`), the `paid` action default (`routes/(app)/fakturaer/[id]/+page.server.ts:81`, `routes/api/invoices/[id]/paid/+server.ts:10`), dashboard quarter (`routes/(app)/+page.server.ts:7`), and overdue status.

`new Date().toISOString()` is always UTC. Between 00:00 and 01:00 CET (02:00 CEST) the app stamps *yesterday's* date on a credit note (a legal document whose date is not user-editable), defaults paid dates to yesterday, and moves the dashboard quarter/year boundary. `docker-compose.yml` sets `TZ: Europe/Copenhagen`, which suggests the intent was local time, but `toISOString` ignores `TZ`.

Fix: compute the date in an explicit zone, independent of the host `TZ`:
```ts
const DK = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Copenhagen', year: 'numeric', month: '2-digit', day: '2-digit' });
export function todayIso(): string { return DK.format(new Date()); } // sv-SE yields yyyy-mm-dd
```
`addDays` and `quarterRange` are pure string/UTC arithmetic on yyyy-mm-dd and are fine as they are.

### 3. [major] Crash between PDF write and commit leaves an orphan `{number}.pdf` that blocks the number series forever

`src/lib/server/services/invoices.ts:274-297` and `:334-415`

Order is: `existsSync(absPath)` → `renderInvoicePdf` → `writeFileSync` → `db.transaction`. If the process dies (OOM, SIGKILL, power loss) after the write and before commit, the file exists but no invoice holds that number. Every later issue attempt for the same number throws `conflict('Filen … findes allerede')` and there is no code path or documented procedure to recover; the user must shell into the volume and delete the file. The same applies to `creditInvoice`.

Fix: write to a temp name (`${number}.pdf.tmp-${pid}`) and `renameSync` it to the final name *inside the try after the transaction commits* (rename is atomic on the same filesystem); on failure remove the temp file. Alternatively, change the pre-check to "file exists AND an invoice row with that number exists" and otherwise overwrite. Also add a startup sweep that deletes `files/invoices/*.tmp-*`.

### 4. [major] README backup makes a consistent copy (`app.db.backup`) but the restore procedure never uses it

`README.md` "Backup" and "Gendan" sections.

The backup command creates `/data/app.db.backup` via the SQLite online backup API, then tars the whole `data/` directory – which also contains the *live* `app.db`, `app.db-wal` and `app.db-shm` copied mid-write. The restore section says to unpack so `data/app.db` exists and to delete `-wal`/`-shm` "if they don't come from the same copy". Following those steps restores the *inconsistent live copy* (with its WAL discarded), not the consistent backup, and never mentions `app.db.backup`. Under WAL mode, deleting the `-wal` throws away committed transactions that were not yet checkpointed.

Fix (docs): in step 2 add `mv data/app.db.backup data/app.db && rm -f data/app.db-wal data/app.db-shm`. Better (code + docs): back up with `.backup()` to a path *outside* `data/` (e.g. `/data/../backup/app.db`, or mount a second volume) and tar `app.db` + `files/` explicitly, so the archive never contains the live db/WAL. Also consider `sqlite.pragma('wal_checkpoint(TRUNCATE)')` on a `SIGTERM` handler (see finding 22) so a stopped container leaves a clean single-file DB.

### 5. [major] CSRF origin check is disabled globally (`csrf.trustedOrigins: ['*']`)

`svelte.config.js:9`

Verified in `node_modules/@sveltejs/kit/src/core/sync/write_server.js:41`: a `'*'` entry sets `csrf_check_origin` to `false`, so Kit performs *no* origin check on any form POST. The reason is understandable: without `ORIGIN` (or `PROTOCOL_HEADER`/`HOST_HEADER`) adapter-node derives `url.origin` as `https://<host>` (`adapter-node/files/handler.js:210`, default protocol `'https'`), which never equals the browser's `http://…` Origin header, so every form action would 403 on the private HTTP network.

Assessment: for a single-user, plain-HTTP, private-network app the residual risk is low because the session cookie is `SameSite=Lax` (`routes/login/+page.server.ts:15`), which already prevents browsers from attaching the cookie to cross-site POSTs. But that makes one cookie attribute the *only* line of defence for an app whose form actions issue legally binding documents and change the number series, and it is a global switch that will silently stay off if the app is later exposed via a reverse proxy.

Better options, in order of preference:
1. Keep Kit's check and set `ORIGIN` correctly. If the app is reached under several names (Tailscale IP, MagicDNS, localhost), replace `'*'` with a scheme-agnostic check in `hooks.server.ts`: for non-GET requests with form content types, require an `Origin` header whose host (`new URL(origin).host`) equals `event.request.headers.get('host')`; 403 otherwise. Keep `trustedOrigins: []`.
2. At minimum make it configurable: `trustedOrigins: (process.env.TRUSTED_ORIGINS ?? '').split(',').filter(Boolean)` and document `ORIGIN`/`TRUSTED_ORIGINS` in the README (which currently lists neither).

### 6. [major] `.env` (containing `APP_PASSWORD`) is copied into the Docker image

`.dockerignore` (7 lines), `Dockerfile:17` `COPY . .`, `docker-compose.yml:11` comment "Set it in .env".

The compose file and README tell the user to put `APP_PASSWORD` in `.env`. `.env` is git-ignored but *not* docker-ignored, so `COPY . .` bakes the password into an image layer (`docker history`/`docker save` reveal it). `data-review/` (a full SQLite DB with WAL) is also copied into the image for the same reason.

Fix: add `.env`, `.env.*`, `data-review/`, `*.md` except `style.md` (or simply `README.md`), `.gitattributes` to `.dockerignore`. Consider the inverse approach (`COPY package*.json svelte.config.js vite.config.ts tsconfig.json drizzle.config.ts tokens.css style.md example.html ./` + `COPY src src` + `COPY drizzle drizzle` + `COPY scripts scripts`) so new files are excluded by default.

### 7. [major] The UI submission path (form actions + form parsers) has no test coverage

`tests/api/*.test.ts` exercise only the JSON API. `src/lib/server/invoice-form.ts`, `expense-form.ts`, `customer-form.ts`, and every `actions` block in `src/routes/(app)/**/+page.server.ts` and `src/routes/login/+page.server.ts` are only touched by `auth.test.ts` GETs. The most important user flow – editor `?/issue` (`fakturaer/[id]/+page.server.ts:64-70`, which saves *then* issues) – is never executed in tests, nor is the `paid` action's `todayIso()` fallback, the settings form (`indstillinger/+page.server.ts`), or the multipart upload action. `Client.raw` already supports `FormData`, so adding these is cheap.

Fix: add `tests/api/forms.test.ts` posting `application/x-www-form-urlencoded`/multipart bodies with `origin` header to `/fakturaer/{id}?/issue`, `/kunder?/create`, `/indstillinger?/save`, `/udgifter?/create`, asserting on redirects/`fail` payloads and resulting API state. Add unit tests for `formDataToDraft` (bad JSON, non-array, non-string fields – see finding 14).

### 8. [minor] `uploadExpenseFile` deletes the old voucher file before the new one is written

`src/lib/server/services/expenses.ts:583-587`

`fs.rmSync(old)` runs before `fs.writeFileSync(new)`. If the write fails (disk full, permissions) the old receipt is gone, the transaction rolls back, and `file_path` still points at a file that no longer exists. Order should be write new → update row → (after commit) remove old if the path differs. `fs.mkdirSync(EXPENSE_FILES_DIR)` at `:585` is redundant (created in `db.ts:153`).

### 9. [minor] Session token is a static HMAC of the password: never rotates, logout does not invalidate, no expiry on the server side

`src/lib/server/auth.ts:6-8, 25-28`

Every login yields the same token; a stolen cookie is valid until `APP_PASSWORD` changes, and `cookies.delete` on logout only affects that browser. `maxAge` 30 days is enforced by the client only. For a single user this is tolerable, but it is cheap to do better without a DB: token = `base64(issuedAt) + '.' + HMAC(password, issuedAt)`, verify the MAC and that `now - issuedAt <= 30d`; or hold a `Set<string>` of random session ids in memory (invalidated on logout/restart). Also: `safeEqual` returns early on length mismatch, which leaks the password length via timing – irrelevant here since the token/password lengths are effectively public, but worth a comment.

### 10. [minor] `vitest run tests/unit` runs `tests/global-setup.ts`, which seeds a DB and boots the built server

`vite.config.ts:8-11` (`globalSetup` applies to all tests, `include: tests/**`)

Unit tests of `format.ts` therefore require `npm run build` to have run, a Chromium install, ~3 s of seeding, and a free port. Confirmed by running `npx vitest run tests/unit`: output shows "Seed gennemført … Listening on http://127.0.0.1:3534". Fix: use Vitest projects (`test.projects: [{ name: 'unit', include: ['tests/unit/**'] }, { name: 'api', include: ['tests/api/**'], globalSetup: [...] }]`) so `test:unit` is a pure, fast run.

### 11. [minor] No login rate limiting or delay

`src/routes/login/+page.server.ts:9`

The single password is the whole security model and the endpoint is unthrottled. Add a tiny in-memory limiter (e.g. per-IP failure count with exponential delay, reset on success). Cheap and consistent with the "private network but defensible" posture.

### 12. [minor] `secure: false` is hard-coded on the session cookie

`src/routes/login/+page.server.ts:16`

If the app is later put behind a TLS proxy the cookie stays non-Secure. Use `secure: event.url.protocol === 'https:'` (requires correct `ORIGIN`/`PROTOCOL_HEADER`, see finding 5) or an env flag.

### 13. [minor] `payment_terms_days: ''` silently becomes `0`

`src/lib/server/services/settings.ts:320`, `routes/(app)/indstillinger/+page.server.ts:16`

`z.coerce.number()` turns `''` into `0`. Clearing the field in the settings form saves 0-day payment terms without error. Pre-process empty strings to `undefined` (`z.preprocess(v => v === '' ? undefined : v, z.coerce.number()…)`) or validate non-empty in the action. The same coercion in `next_invoice_number` happens to fail (`min(1)`), so it is safe there.

### 14. [minor] `formDataToDraft` trusts the shape of client JSON and can throw a `TypeError` (→ 500 instead of 400)

`src/lib/server/invoice-form.ts:150-151`

`rawLines` is cast to `EditorLine[]`; `(l.description ?? '').trim()` throws if `description` is a number or `l` is `null`, yielding a 500 with a generic message. Validate the array with a zod schema of string fields first (`z.array(z.object({ description: z.string().default(''), … }))`) before mapping.

### 15. [minor] Line total uses floating-point `quantity * unitPriceOre` before rounding

`src/lib/server/services/invoices.ts:57-59`, mirrored client-side in `InvoiceEditor.svelte:43`

`parseQuantity` rounds to 3 decimals but stores a double; `1.005 * 100 === 100.49999999999999` → `Math.round` gives 100 where half-up arithmetic gives 101 (verified). Prices in whole øre with 3-decimal quantities can hit this. Fix: compute with integers – `const qMilli = Math.round(quantity * 1000); return Math.round((qMilli * unitPriceOre) / 1000);` (an integer divided by 1000 is exact when the true value is x.5). Also note `Math.round` on negative quantities (allowed by the schema) rounds half towards +∞, i.e. asymmetrically; with the integer approach the sign can be applied after rounding the absolute value.

### 16. [minor] `BODY_SIZE_LIMIT=20M` equals `MAX_UPLOAD_BYTES`, so a 20 MB receipt fails with a raw 413, not the friendly 400

`Dockerfile:9`, `tests/global-setup.ts:40`, `src/lib/server/expense-form.ts:182`

Multipart overhead plus other fields push a 20 MB file over the adapter limit before `uploadFromForm` runs, so the user sees "Der opstod en fejl"/413 instead of "Filen er for stor (maks. 20 MB)". Set `BODY_SIZE_LIMIT=21M` (or `MAX_UPLOAD_BYTES = 19 MiB`) and add a test that uploads just above the limit.

### 17. [minor] Upload type check trusts the client `Content-Type`; no magic-byte sniffing

`src/lib/server/services/expenses.ts:479-485`

A file with `type: application/pdf` is stored as `.pdf` and served inline as `application/pdf` regardless of content. With `X-Content-Type-Options: nosniff` and a whitelist of three types the risk is a broken viewer rather than XSS, but a 4-byte check (`%PDF`, `\x89PNG`, `\xFF\xD8\xFF`) is trivial and would also catch users uploading the wrong file.

### 18. [minor] Tests depend on the wall-clock date

`tests/api/vat.test.ts:42-45`, `scripts/seed.ts` (credit note dated `todayIso()`), `tests/api/invoicing.test.ts` (hard-coded `2026-09-*`)

`creditNoteInQ3` toggles expectations based on today; from 2027 the seed's credit note falls in a different year and the Q3-2026 assertions still pass only because they filter by number. Deterministic alternative: let `seed()` accept a `today` parameter (or read `SEED_TODAY`) and have global-setup pass a fixed date. Also `port = 3200 + random(500)` (`global-setup.ts:33`) can collide; use port 0 with a `Listening on` parse, or check availability.

### 19. [minor] `audit_log` "append-only" and invoice immutability are enforced only by convention in application code

`src/lib/server/audit.ts:114-117`, `drizzle/0000_clean_toxin.sql`

The README promises an append-only audit log. Any future code path (or a `sqlite3` shell) can `UPDATE`/`DELETE` it. Add a migration with `CREATE TRIGGER audit_log_no_update BEFORE UPDATE ON audit_log BEGIN SELECT RAISE(ABORT, 'audit_log is append-only'); END;` (and the same for `DELETE`). A similar trigger can forbid changes to `invoice_number`, `subtotal_ore`, `vat_ore`, `total_ore`, `issue_date` on rows with `status != 'draft'`, making the immutability claim hold at the storage layer.

### 20. [minor] Container runs as root with `--no-sandbox`, no `HEALTHCHECK`, no non-root user

`Dockerfile` (no `USER`), `src/lib/server/pdf.ts:10`

The Playwright image ships a `pwuser`. Running as root makes the `/data` volume root-owned on the host and requires `--no-sandbox` for Chromium. Add `RUN mkdir -p /data && chown -R pwuser:pwuser /app /data`, `USER pwuser`, drop `--no-sandbox`, and add `HEALTHCHECK CMD node -e "fetch('http://127.0.0.1:3000/login').then(r=>process.exit(r.ok?0:1))"`.

### 21. [minor] `parseKrToOre` rejects Danish thousands-grouped whole amounts ("1.000")

`src/lib/format.ts:496-508`

Without a comma the input is treated as English decimal, so `"1.000"` and `"12.500"` throw "Ugyldigt beløb" while `"1.000,00"` works. Danish users type "1.000" routinely. Rule to consider: if there is exactly one `.` followed by exactly three digits and no `,`, treat `.` as a thousands separator. Add unit tests for `1.000`, `1.000.000`, `1.5`.

### 22. [minor] No graceful shutdown: Chromium and SQLite are never closed on SIGTERM/SIGINT

`src/lib/server/pdf.ts:23` (`closeBrowser` is only called by `scripts/seed.ts`), `src/lib/server/db.ts`

`docker stop` sends SIGTERM; Node exits without `browser.close()` or `sqlite.close()`. In the container this is harmless (PID namespace dies), but in dev it orphans Chromium processes and leaves a WAL that is only checkpointed on next open (relevant to finding 4). Add in `hooks.server.ts`:
```ts
for (const sig of ['SIGTERM', 'SIGINT'] as const) process.once(sig, async () => { await closeBrowser(); sqlite.close(); process.exit(0); });
```

### 23. [minor] README environment-variable list is incomplete and `docker compose exec app npm run seed` runs a second process against the live DB

`README.md` "Lokal udvikling" / "Kør"

`PROJECT_ROOT`, `HOST`, and `ORIGIN`/`PROTOCOL_HEADER` (needed once finding 5 is fixed) are undocumented. Running `seed` inside the running container starts a second Node process that issues invoices outside the app's in-process `withIssueLock`; the seed's "empty DB" guard makes an actual race unlikely, but the README should say "before first start" or the seed should be exposed as an in-app action. Also `tsx` is in `dependencies` solely to make this work in production (`package.json:26`); acceptable, but note it in a comment or precompile the seed.

### 24. [minor] `npm audit` findings – assessed as no impact, but document it

- `cookie <0.7.0` (GHSA-pxg6-pf52-xh8x) via `@sveltejs/kit`: the issue is missing validation of cookie *name/path/domain* supplied by the application. This app sets one fixed cookie name (`faktura_session`) with a fixed path; nothing attacker-controlled reaches those arguments. Not exploitable. Will disappear when Kit bumps `cookie`.
- `esbuild <=0.24.2` (GHSA-67mh-4wv8-2f99) via `drizzle-kit → @esbuild-kit`: affects esbuild's *dev server* mode only; `drizzle-kit` is a devDependency, pruned from the image (`Dockerfile:18`), and never serves anything. Not exploitable.

Suggest an `npm audit --omit=dev` in CI (both disappear or are irrelevant) and a note in the README/tech section so the next person does not re-investigate.

### 25. [nit] Dead exports

`getSetting` (`settings.ts:295`), `getInvoiceByNumber` (`invoices.ts:143`), and the types `DraftInput`, `ExpenseInput`, `CustomerInput`, `SettingsInput` have no consumers (grep of `src/` and `scripts/`). The `z.ZodError` branch in `errorResponse` (`api.ts:106`) is unreachable because every service already converts Zod errors to `badRequest`. Remove or wire up.

### 26. [nit] Duplicated helpers across route files

`isRedirect`/inline `'status' in e && 'location' in e` appears in `fakturaer/+page.server.ts:42`, `fakturaer/[id]/+page.server.ts:43`, `kunder/+page.server.ts:28`, `udgifter/+page.server.ts:27` – `@sveltejs/kit` exports `isRedirect`/`isHttpError` for exactly this. `id(params)` is copied in three `[id]/+page.server.ts` files and near-duplicates `idParam` in `api.ts:122`. `count(table)` is duplicated in `(app)/+layout.server.ts:9` and `eksport/+page.server.ts:15`. Extract into `$lib/server/api.ts`.

### 27. [nit] `PATCH = PUT` on `/api/invoices/[id]`

`src/routes/api/invoices/[id]/+server.ts:11`

A PATCH with a partial body on a *draft* returns 400 (full schema required), which is not PATCH semantics. Either implement a partial schema or remove PATCH; the immutability test only needs PUT/DELETE.

### 28. [nit] No upper bounds on money/quantity inputs

`invoices.ts:19-21`, `expenses.ts:450-452`

`unitPriceOre`/`amountExVatOre` accept any integer up to 2^53; sums could exceed `Number.MAX_SAFE_INTEGER` silently. Add `.max(1e13)` (100 billion kr) and `quantity` `.max(1e6)`.

### 29. [nit] No indexes on foreign keys / date columns

`src/lib/server/schema.ts`

`invoice(customer_id)`, `invoice(issue_date)`, `invoice_line(invoice_id)`, `expense(date)`, `audit_log(entity, entity_id)` are unindexed. Irrelevant at single-user scale, but `listQuery` runs two correlated sub-selects per row; an index on `invoice(credited_by_invoice_id)` keeps that O(n) rather than O(n²) as years accumulate.

### 30. [nit] `credited_by_invoice_id` has no FK and `invoice_line.invoice_id` has no `ON DELETE CASCADE`

`schema.ts:35, 43-45`. Manual line deletion in `deleteDraft` is correct today; a FK on `credited_by_invoice_id` would let SQLite enforce the credit-note link.

### 31. [nit] `formatQuantity` shows 2 decimals while `parseQuantity` keeps 3

`format.ts:511-523`. A quantity of `1,005` round-trips through the editor as `"1,01"` (or `"1,00"` due to float), so re-saving a draft silently changes the quantity and the line total.

### 32. [nit] Export audit entry is written before the stream is consumed

`export.ts:268`. `audit('export', …)` is logged even if the client aborts the download; also `zip.on('error')` destroys the response but nothing is logged server-side. Log after `finalize()` resolves, or accept and document "export attempted".

### 33. [nit] No Content-Security-Policy

`hooks.server.ts:57-59` sets `X-Frame-Options` and `nosniff` but no CSP. Kit supports `kit.csp = { mode: 'auto', directives: { 'default-src': ['self'] } }`; the invoice/expense pages render user-entered strings (escaped, but CSP is cheap defence in depth).

### 34. [nit] `package.json` has no `engines` field

The Playwright base image pins Node; local developers do not get a hint. Add `"engines": { "node": ">=22" }` (whatever the `v1.63.0-noble` image ships).

### 35. [nit] `hooks.server.ts` redirects unauthenticated *POST* requests with 303 to `/login`

`hooks.server.ts:50`. A form submission after cookie expiry loses the submitted data silently (redirect to login, then to `/`). Consider returning the login page with a 401 and a "session expired" message for non-GET, or preserving `?next=`.

### 36. [nit] Untracked working-tree noise

`git status`: `review/` and `data-review/` are untracked; `data-review/` holds a real SQLite DB + WAL. Add `data-review/` to `.gitignore` (and `.dockerignore`, finding 6).

---

## Positive observations

- Numbering is genuinely gap-free by construction: number read, PDF render, and assignment all happen under `withIssueLock`, the transaction re-checks `next_invoice_number` and draft status, `setSettingRaw` is only reachable under the same lock, and `invoice_number` has a DB unique index as a last line of defence. The 10-way concurrent issue test and the double-issue test are meaningful.
- Voucher numbers are assigned inside a synchronous `better-sqlite3` transaction with `max()+1` and a unique index – correct for the documented single-process model.
- All SQL goes through Drizzle or tagged `sql` templates with bound parameters; no string-built SQL anywhere.
- Money is integer øre end-to-end; `formatOre`/`oreToCsv` never touch floats; CSV export uses BOM + `;` + decimal comma, correct for Danish Excel.
- File paths on disk are derived exclusively from server-side numbers and a three-value extension whitelist; user-supplied filenames never reach the filesystem. Served filenames are likewise synthetic.
- HTML in the PDF template is escaped everywhere via `esc()`; the footer template only inlines values read from `tokens.css`.
- `HttpError` → status mapping is consistent across JSON API and form actions; immutability is checked *before* body parsing so issued invoices always answer 409.
- Password comparison is timing-safe; the cookie is `HttpOnly` + `SameSite=Lax`; logout is POST-only; `Cache-Control: no-store` on every response.
- Dockerfile layering is right (lockfile install before `COPY . .`, `npm prune --omit=dev`, Playwright image tag pinned to the exact `playwright` npm version, design assets asserted at build and at startup).
- `svelte-check` is clean; tests assert on real PDF text content, real files on disk, and hand-computed øre totals rather than mocking.

---

## Pass 2

Scope: re-verify all 36 pass-1 findings against the code at `7301efe` (fix commit `51dc7a8` plus the PDF-label follow-up), then look for regressions introduced by the fixes. Method: read every changed file (`git show --stat HEAD~1`), the new migration, the new tests and the README "Sikkerhed og drift" section; ran `npm run check` (0 errors, 0 warnings) and `npx vitest run --project unit` (2 files, 15 tests, 915 ms – the unit project no longer boots the server). Did not run `npm test`/`npm run build` (a server holds the build directory). Two claims were tested empirically with throw-away scripts in the scratchpad: the new migration was applied to (a) an empty DB, (b) a DB migrated to `0000` and populated with one issued invoice + one line, and (c) a copy of `data-review/app.db`; and the line-total rounding was brute-forced over all 2-decimal quantities ≤ 50 and prices ≤ 5 000 øre.

### Status of pass-1 findings

| # | Sev | Status | Evidence |
|---|---|---|---|
| 1 | major | **Fixed** | `creditInvoice` uses `-orig.subtotalOre/-orig.vatOre/-orig.totalOre` (`invoices.ts:388-393`); `roundOre` is half-away-from-zero (`format.ts:99-101`); unit test for `roundOre(-n) === -roundOre(n)` and API test "subtotal 100,02" (`invoicing.test.ts:189-200`). |
| 2 | major | **Fixed** | `todayIso()` formats via `Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Copenhagen' })` (`format.ts:104-106`); tests at 23:30 UTC on 7 Sep and 31 Dec. README documents that `TZ` only affects log timestamps. |
| 3 | major | **Fixed** | `archivePdf` writes `{n}.pdf.tmp`, commits, then `renameSync` (`invoices.ts:270-280`); on commit failure the tmp is removed. A crash before commit leaves only a `.tmp`, which the next attempt overwrites, so the series can no longer be blocked. Residual crash window between commit and rename – see new finding 42. |
| 4 | major | **Fixed** | Backup tars `app.db.backup files` only (`-C data app.db.backup files`), restore step 3 renames the copy to `app.db` and states no `-wal/-shm` may sit next to it. Cron example updated the same way. |
| 5 | major | **Fixed** | Host-relative Origin check for POST/PUT/PATCH/DELETE in `hooks.server.ts:28-41`, runs before auth, 403 as JSON; API test with `origin: https://evil.example`. `trustedOrigins: ['*']` is kept deliberately and commented as replaced by the hook. One gap remains – new finding 38 (`Origin: null` passes). |
| 6 | major | **Fixed** | `.dockerignore` now lists `.env`, `.env.*`, `data-*`, `review`, `tests`; `.gitignore` gained `data-*/`. |
| 7 | major | **Fixed** | `tests/api/form-actions.test.ts` (163 lines) drives `?/create`, `?/save`, `?/issue` (stale and correct `expectedNumber`), `?/paid`, `?/save` on an issued invoice (409), invalid date → 400 with field error, expense create with Danish amounts + sniffed PNG, settings save + refused lowering, customer create/save/delete. `udgifter/[id]?/upload` is still untested, acceptable. |
| 8 | minor | **Fixed** | `uploadExpenseFile` writes the new file, updates the row, then removes the old path only if it differs (`expenses.ts:154-158`). The redundant `mkdirSync` is still there (folded into new finding 43). |
| 9 | minor | **Accepted** | README "Sikkerhed og drift": HMAC session, invalidated by changing the password. Agreed for one user on a private network. |
| 10 | minor | **Fixed** | `vite.config.ts` defines `unit` and `api` projects; `globalSetup` only on `api`. Verified: the unit run no longer seeds or starts a server. But see new finding 41 – `db-guards.test.ts` launches Chromium. |
| 11 | minor | **Fixed** | Per-IP counter, 5 failures → 429 for 30 s per further attempt, reset on success (`login/+page.server.ts:5-30`). Documented in README. |
| 12 | minor | **Accepted** | Documented: plain HTTP on the private net, flip `Secure` when a TLS proxy is introduced. Agreed. |
| 13 | minor | **Fixed** | `payment_terms_days`/`next_invoice_number` are `z.union([z.number(), z.string().regex(/^\d+$/)])` → `''` is a 400 with a Danish message (`settings.ts:44-53`). |
| 14 | minor | **Fixed** | `formDataToDraft` checks `Array.isArray` and that every item is a non-null object, then `String(...)` coerces every field (`invoice-form.ts:20-30`). |
| 15 | minor | **Not fixed** | Only the parsing half changed: `parseQuantity` now rounds to 2 decimals on the decimal string (good). `computeLineTotalOre` is still `roundOre(quantity * unitPriceOre)` (`invoices.ts:57-59`) and the editor mirrors it (`InvoiceEditor.svelte:51`). Brute-force over 2-decimal quantities shows real misses: `0.29 * 50 = 14.499999999999998 → 14` (correct 15), `0.29 * 1450 = 420.49999999999994 → 420` (correct 421), `0.29 * 2850 → 826` (correct 827). Fix as proposed: `roundOre((Math.round(quantity * 100) * unitPriceOre) / 100)` – an integer divided by 100 is exact at `.5`. Additionally the JSON API still accepts quantities with more than 2 decimals (`z.coerce.number()`), so the 2-decimal invariant only holds for form input; add `.multipleOf(0.01)` or round in the schema. |
| 16 | minor | **Fixed** | Dockerfile `BODY_SIZE_LIMIT=25M`; README explains 25M vs. 20 MB. `tests/global-setup.ts:40` still sets `20M` and no over-limit test was added – the test environment does not mirror production here (folded into new finding 43). |
| 17 | minor | **Fixed** | `sniffUploadExt` checks `%PDF-`, PNG signature, `FF D8 FF` (`expenses.ts:42-47`); API test uploads text typed `application/pdf` → 400. |
| 18 | minor | **Fixed / residual accepted** | `vat.test.ts` now derives the credit note's quarter from its actual `issueDate` and asserts the pair nets to zero only when both fall in that quarter; the Q3 seed assertions are on fixed dates. The seed still dates 1006 "today" and the port is still random in 3200–3699; I accept both as nits. |
| 19 | minor | **Fixed – but see new finding 37** | `drizzle/0001_indexes_and_guards.sql:35-47` adds append-only triggers on `audit_log`, no-delete on non-draft invoices, an immutability trigger on every content column (`paid_date` and `credited_by_invoice_id` deliberately excluded), and insert/update/delete guards on lines of non-draft invoices. Checked against every write path: `setPaidDate` touches only `paid_date`; `creditInvoice` inserts the note as `draft`, adds lines, flips to `issued`, then moves the original `issued → credited` + `credited_by_invoice_id` – none of these hit a trigger; `deleteDraft` deletes lines then the draft row. `tests/unit/db-guards.test.ts` proves the guards with raw SQL. |
| 20 | minor | **Accepted** | `HEALTHCHECK` added; root + `--no-sandbox` documented with rationale (bind-mount ownership). Agreed. |
| 21 | minor | **Fixed** | `thousandsOnly` rule in `parseKrToOre` (`format.ts:25`); unit tests for `1.000`, `12.345.678`, `1,234` (rejected). |
| 22 | minor | **Fixed** | `process.on('sveltekit:shutdown', …)` closes Chromium and SQLite (`hooks.server.ts:14-17`). Verified adapter-node 5.x emits that event after `httpServer.close` on SIGINT/SIGTERM (`adapter-node/files/index.js:97,127-128`). Closing the last connection checkpoints the WAL, which also helps finding 4. |
| 23 | minor | **Fixed** | README lists `APP_PASSWORD`, `DATA_DIR`, `PROJECT_ROOT`, `PORT`, `HOST`, `BODY_SIZE_LIMIT`, `TZ`; `ORIGIN` is no longer needed. Seed section now says "kun på en tom database, aldrig mens der udstedes fakturaer". |
| 24 | minor | **Accepted** | README documents both audit findings and why they do not apply. |
| 25 | nit | **Not fixed** | `getSetting` (`settings.ts:19`), `getInvoiceByNumber` (`invoices.ts:143`), the exported types `DraftInput`/`ExpenseInput`/`CustomerInput`/`SettingsInput`, and the unreachable `z.ZodError` branch (`api.ts:8`) are all still present with no consumers (grep of `src/`, `scripts/`, `tests/`). |
| 26 | nit | **Partially fixed** | `isRedirect` and `routeId` were added to `api.ts` and used in `fakturaer/[id]`, `udgifter/*`. Still duplicated: the inline `'status' in e && 'location' in e` in `fakturaer/+page.server.ts:42` and `kunder/+page.server.ts:29`; the private `id()` in `kunder/[id]/+page.server.ts:10-14`; `count()` in `(app)/+layout.server.ts:9` and `eksport/+page.server.ts:15`. |
| 27 | nit | **Accepted** | Rationale (every mutation verb answers 409 on issued invoices, tested) is reasonable. |
| 28 | nit | **Fixed** | Price `±1e13`, quantity `|q| ≤ 1e9`, expense amounts `±1e13`. |
| 29 | nit | **Fixed** | Indexes on `invoice(customer_id, issue_date, status)`, `invoice_line(invoice_id)`, `expense(date)`, `audit_log(entity, entity_id)`. `credited_by_invoice_id` is still unindexed, so the `original` sub-select in `listQuery` stays a scan; accepted at this scale. |
| 30 | nit | **Fixed** | FK `credited_by_invoice_id → invoice(id)` in schema and migration. No cascade on lines; `deleteDraft` handles it explicitly and the trigger forbids deleting issued rows anyway. |
| 31 | nit | **Fixed** | `parseQuantity` rounds to the 2 decimals the UI shows, so the editor round-trips. |
| 32 | nit | **Fixed** | Export audit entry is written on `zip.on('end')` (`export.ts:97`). |
| 33 | nit | **Fixed** | `kit.csp` with `mode: 'auto'`, `default-src 'self'`, `form-action 'self'`, `base-uri 'self'`. |
| 34 | nit | **Fixed** | `"engines": { "node": ">=22.12" }`. |
| 35 | nit | **Accepted** | 303 to `/login` for unauthenticated POSTs is a stated design choice. |
| 36 | nit | **Fixed** | `data-*/` in `.gitignore` and `.dockerignore`; only `review/` remains untracked, intentionally. |

Tally: 27 fixed, 6 accepted with rationale I agree with, 3 still open (15, 25, 26).

### New findings introduced by the fixes

#### 37. [major] Migration `0001` fails with `FOREIGN KEY constraint failed` on any database that already contains invoice lines

`drizzle/0001_indexes_and_guards.sql:3-29`, `src/lib/server/db.ts:16,21`

To add the FK on `credited_by_invoice_id` the migration rebuilds `invoice` (`CREATE TABLE __new_invoice … INSERT … SELECT … DROP TABLE invoice … RENAME`), wrapped in `PRAGMA foreign_keys=OFF/ON`. Drizzle's synchronous migrator runs all pending migrations inside a single `BEGIN … COMMIT` (`drizzle-orm/sqlite-core/dialect.js:659-675`), and `PRAGMA foreign_keys` is documented as a no-op inside a transaction. `db.ts` has already set `foreign_keys = ON`, so `DROP TABLE invoice` performs its implicit `DELETE FROM invoice` with enforcement on, and every `invoice_line.invoice_id` becomes a violation.

Reproduced: a DB migrated to `0000` with one customer, one issued invoice and one line → `migrate()` throws `Failed to run the query 'DROP TABLE invoice;'`, cause `FOREIGN KEY constraint failed`; the transaction rolls back and, because `migrate()` runs at module load, the server does not start. On an empty DB it succeeds – which is why `tests/global-setup.ts`, `db-guards.test.ts` and a fresh `docker compose up` all look fine. `data-review/app.db` already has both migrations recorded, so it was evidently seeded after `0001` existed. Any installation created before commit `51dc7a8` (including the user's real data dir, if one exists) will crash on upgrade with no hint in the README, which promises "Migreringer kører automatisk ved start".

Fix (verified to succeed on the populated DB and to preserve rows, indexes and triggers): in `db.ts` run `sqlite.pragma('foreign_keys = OFF')` *before* `migrate(...)`, then `sqlite.pragma('foreign_key_check')` (throw if any row comes back) and `sqlite.pragma('foreign_keys = ON')`. Optionally remove the now-ineffective pragma lines from the SQL. Add a unit test that applies `0000`, inserts an invoice with a line, then runs the full migrator – the current guard test only exercises a fresh schema.

#### 38. [minor] CSRF hook treats `Origin: null` as trusted

`src/hooks.server.ts:31`

`if (!origin || origin === 'null') return false;` lets a request whose Origin is the literal `null` through. Browsers send `Origin: null` for cross-site form posts from sandboxed iframes (`<iframe sandbox="allow-forms">`), `data:`/`file:` pages, and some redirect chains – exactly the cross-site case the check exists for. SvelteKit's own check rejects it (it compares to `url.origin`). Residual risk is still bounded by `SameSite=Lax` and `form-action 'self'` in the CSP, but the hook is meant to be the primary line. Fix: treat `'null'` as a mismatch; only a genuinely absent header should pass (non-browser clients).

#### 39. [nit] Immutability trigger does not pin `status` on non-draft rows

`drizzle/0001_indexes_and_guards.sql:38-44`

The trigger forbids `NEW.status = 'draft'` but otherwise lets `status` change: `credited → issued` (un-crediting an invoice by raw SQL while its credit note still exists) and any string outside the enum (`status` has no `CHECK`). `credited_by_invoice_id` is likewise unguarded, so the link can be cleared. The README claims immutability "uanset hvilket SQL-værktøj der forsøger". Suggest `OR (NEW.status <> OLD.status AND NOT (OLD.status = 'issued' AND NEW.status = 'credited'))`, `OR (OLD.credited_by_invoice_id IS NOT NULL AND NEW.credited_by_invoice_id IS NOT OLD.credited_by_invoice_id)`, and a `CHECK (status IN ('draft','issued','credited'))` on the rebuilt table.

#### 40. [nit] `updateDraft` returns a `Promise` but throws synchronously

`src/lib/server/services/invoices.ts:185-197`

The 404/409/400 checks run before `withIssueLock`, in a non-`async` function, so `updateDraft(id, body).catch(...)` would not catch them while `await updateDraft(...)` does. Every current caller awaits inside an `async` wrapper (`api()`, `run()`, the seed, the tests), so behaviour is unchanged today, but the mixed contract is a trap. Mark the function `async` (the pre-lock fast-fail is still a good idea; keep it, just make it reject).

#### 41. [nit] `tests/unit/db-guards.test.ts` boots the real DB module and renders a PDF with Chromium

`tests/unit/db-guards.test.ts:21-38`

It imports `src/lib/server/db` (runs migrations against a temp dir) and calls `issueInvoice`, which launches Playwright/Chromium. That re-introduces, for the "unit" project, the heavyweight dependency finding 10 removed (a browser install and ~1 s of setup; it happened to be fast here because Chromium is installed). Since the triggers only guard UPDATE/DELETE, the fixture can simply `INSERT` an issued row and a line with raw SQL – no service, no browser – or the test can move to the `api` project.

#### 42. [nit] Crash between commit and `renameSync` leaves `{n}.pdf.tmp` and a row whose `pdf_path` points to a missing file

`src/lib/server/services/invoices.ts:270-280`

The number series is safe now (the important part of finding 3), but this window yields an issued invoice whose PDF GET returns 404 "PDF findes ikke", with the correct bytes sitting in `{n}.pdf.tmp`. Cheap mitigation: at startup (in `db.ts` or `hooks.server.ts`), for each `files/invoices/*.pdf.tmp` rename it into place if an invoice row with that `pdf_path` exists, otherwise delete it.

#### 43. [nit] Leftovers from the fix commit

- `UploadFile.type` (`expenses.ts:31`, filled in `expense-form.ts:63`) is no longer read anywhere – the sniffer replaced it.
- `fs.mkdirSync(EXPENSE_FILES_DIR, …)` in `uploadExpenseFile` (`expenses.ts:153`) is still redundant with `db.ts:12`.
- `tests/global-setup.ts:40` still runs the test server with `BODY_SIZE_LIMIT: '20M'` while the Dockerfile ships `25M`; the test environment should mirror production, and an "upload just above 20 MB → friendly 400" test is still missing.
- The login limiter's `failures` map is never pruned (entries for failing IPs live until a successful login from that IP or a restart). Harmless at this scale; a periodic sweep of expired entries is one line.
- `svelte.config.js` keeps `object-src 'self'`; `'none'` is the usual choice (PDFs are shown via `frame-src`).

### Positive observations (pass 2)

- The content fingerprint (`contentFingerprint`) is sound: both sides are built from `getInvoice()` inside the same lock, include the full customer row (so a customer edit racing an issue is caught even though customer writes are not under the lock), and lines are ordered by id. Settings cannot change underneath because `updateSettings` takes the same lock.
- Serialising `updateDraft`/`deleteDraft` under the issue lock closes the edit-during-issue window; the new concurrent edit-vs-issue test accepts either ordering but asserts consistency, which is the right shape for a non-deterministic race.
- Inserting the credit note as `draft` and flipping it inside the transaction was the correct way to coexist with the line-insert trigger; no legitimate write path fires a guard (checked each one).
- The README backup/restore sequence is now internally consistent and the shutdown hook makes a stopped container leave a single-file DB.

### Result

Open findings: 10

- 15 (minor) – line total still computed as `roundOre(quantity * unitPriceOre)` in floating point; `0,29 × 14,50 kr` → 420 øre instead of 421.
- 25 (nit) – dead exports (`getSetting`, `getInvoiceByNumber`, four `*Input` types, unreachable `ZodError` branch).
- 26 (nit) – duplicated helpers still in `fakturaer/+page.server.ts`, `kunder/+page.server.ts`, `kunder/[id]/+page.server.ts`, layout/eksport `count()`.
- 37 (major, new) – migration `0001` fails on any populated database because `PRAGMA foreign_keys=OFF` is a no-op inside the migrator's transaction; server will not start after upgrade.
- 38 (minor, new) – `Origin: null` bypasses the CSRF host check.
- 39 (nit, new) – immutability trigger lets `status` move `credited → issued` or to any string; `credited_by_invoice_id` unguarded; no `CHECK` on `status`.
- 40 (nit, new) – `updateDraft` mixes synchronous throws with a returned `Promise`.
- 41 (nit, new) – the unit-project guard test launches Chromium via `issueInvoice`.
- 42 (nit, new) – commit-then-rename crash window leaves `{n}.pdf.tmp` and a 404 PDF.
- 43 (nit, new) – leftovers: unused `UploadFile.type`, redundant `mkdirSync`, test `BODY_SIZE_LIMIT` 20M vs 25M, unpruned limiter map, `object-src 'self'`.

---

## Pass 3

Scope: re-verify the 10 findings left open by pass 2 (15, 25, 26, 37, 38, 39, 40, 41, 42, 43) against `370a5f3`, and review the new code in that commit (credit-note `expectedNumber`, `repairArchivedPdfs`, migration `0002`, the new tests) for regressions. Method: read the full commit diff and the current `invoices.ts`, `db.ts`, `hooks.server.ts`, `api.ts`, `login/+page.server.ts`, `InvoiceEditor.svelte`, `drizzle/0001`/`0002`, `vite.config.ts` and all test files; ran `npm run check` (0 errors, 0 warnings) and `npx vitest run --project unit` (2 files, 11 tests, 383 ms; `migration.test.ts` runs and passes in 234 ms). Did not run `npm test`/`npm run build` or start a server. Three claims were tested with throw-away scripts in the scratchpad against a DB built from `0000`+`0001`+`0002`: every legitimate write sequence and every forbidden transition against the new trigger, the residual `credited_by_invoice_id` holes, and a simulated *future* drizzle-kit rebuild of `invoice` (with and without `legacy_alter_table`). A dead-export scan (every `export` in `src/lib` grepped against `src/`, `scripts/`, `tests/`) and a client-vs-server line-total comparison were done with one-liners.

### Status of the pass-2 open findings

| # | Sev | Status | Evidence |
|---|---|---|---|
| 15 | minor | **Fixed server-side, client mirror not updated** | `computeLineTotalOre` is now `roundOre((Math.round(q*100) * unitPriceOre) / 100)` (`invoices.ts:63-66`): integer hundredths × øre, one half-away-from-zero rounding; an integer divided by 100 is exact at `.5`, so the pass-2 misses (`0,29 × 0,50 kr`) now give 15. The schema rejects >2 decimals (`invoices.ts:22`, tolerance `1e-6`) and `invoicing.test.ts` asserts both (15 øre, and `1.005` → 400). **But** `InvoiceEditor.svelte:51` still computes the preview as `roundOre(parseQuantity(q) * parseKrToOre(p))` in floating point: for `0,29 × 0,50` the editor shows 14 øre (and a 14-øre subtotal/VAT preview) while saving stores 15, verified with a one-liner (client 14, server 15). The stored/legal figures are right, so this is now a nit: move the pure function to `$lib/format.ts` (it has no DB dependency) and import it in both places. |
| 25 | nit | **Mostly fixed** | `getInvoiceByNumber`, `getSetting`, the four `*Input` types and the `DESIGN_ASSETS` export are gone. Still present: the unreachable `z.ZodError` branch in `api.ts:8` (no `.parse(` call exists anywhere in `src/`, only `safeParse`, so nothing can throw a `ZodError` past a service), and it is the only reason `api.ts` imports `zod`. The scan also shows twelve symbols exported but consumed only inside their own file (`computeLineTotalOre`, `computeTotals`, `VAT_RATE_BP`, `sniffUploadExt`, `MAX_UPLOAD_BYTES`, `oreToCsv`, `toCsv`, `Settings`, `VatReport`, `AuditLog`, `EditorLine`, `InvoiceStatusLabel`); harmless, but `export` there implies an API surface nobody uses. |
| 26 | nit | **Mostly fixed** | `isRedirect` replaces both inline checks, `routeId` replaces the private `id()` in `kunder/[id]`, `formValues` replaces the inlined loop in `kunder`. Still duplicated: the `count()` closure in `(app)/+layout.server.ts:9` and `eksport/+page.server.ts:15`. Small smell: `kunder/+page.server.ts:6` now imports `formValues` from `$lib/server/expense-form`, a customer route depending on the expense form module; it belongs in `api.ts` next to `isRedirect`/`routeId`. |
| 37 | major | **Fixed** (with a forward-looking caveat, new finding 45) | `db.ts:24-30` sets `foreign_keys = OFF` *before* `migrate()`, so it takes effect before the migrator's `BEGIN` (`drizzle-orm/sqlite-core/dialect.js:657`); after `COMMIT` it runs `foreign_key_check`, throws on any row, then turns enforcement back on. The `PRAGMA` lines inside `0001` remain as harmless no-ops. `tests/unit/migration.test.ts` builds a `0000` DB with an issued invoice + line, a draft + line, an expense, an audit row and a `__drizzle_migrations` row whose `created_at` equals `0000`'s `when` (which is exactly how the migrator decides what is pending: `Number(lastDbMigration[2]) < migration.folderMillis`), boots `db.ts`, and asserts row counts, `foreign_key_check = []`, `foreign_keys = 1`, two trigger names, and that the guards are live on migrated data. This is the regression test pass 2 asked for and it reproduces the original failure mode. One caveat inherent in drizzle's API: the integrity check runs *after* the commit, so a future faulty migration would be committed and then block startup on every boot until restored from backup; acceptable, but worth a comment. The second caveat, what happens on the *next* rebuild of `invoice`, is new finding 45. |
| 38 | minor | **Fixed** | `hooks.server.ts:36-38`: absent Origin passes (non-browser clients), literal `'null'` is now a mismatch → 403. No test sends `Origin: null` (`auth.test.ts` only covers `https://evil.example`); a one-line addition. |
| 39 | nit | **Partially fixed** | `0002_status_guard.sql` re-creates `invoice_immutable_issued` with `NEW.status NOT IN ('issued','credited')`, `credited → anything else` forbidden, and `issued → credited` requiring `credited_by_invoice_id`; two new triggers enforce the enum on INSERT/UPDATE and forbid `draft → credited`. Verified with raw SQL that every legitimate path passes: `issueInvoice` (draft→issued+number+pdf_path in one UPDATE), `setPaidDate` (paid_date only), the full `creditInvoice` sequence (insert note as draft → insert lines → note draft→issued → original issued→credited with `credited_by_invoice_id` in the same UPDATE), `updateDraft` and `deleteDraft` on drafts; and that these abort: issued→credited without link, credited→issued, credited→draft, issued→draft, draft→credited, `status='bogus'` on insert and update. **Still open**: `credited_by_invoice_id` itself is unguarded; all three of these succeed against the migrated DB: clearing it on a credited row (`SET credited_by_invoice_id = NULL`), repointing it to another invoice, and setting it on a row that stays `issued`. The pass-2 clause `OR (OLD.credited_by_invoice_id IS NOT NULL AND NEW.credited_by_invoice_id IS NOT OLD.credited_by_invoice_id)` (plus `OR (OLD.status = NEW.status AND NEW.credited_by_invoice_id IS NOT OLD.credited_by_invoice_id)`) was not adopted. `status` has no `CHECK`, but the two triggers cover the enum, which is fine. |
| 40 | nit | **Fixed** | `updateDraft` is `async` (`invoices.ts:186`); the pre-lock 404/409/400 checks now reject instead of throwing synchronously. |
| 41 | nit | **Fixed** | `tests/api/db-guards.test.ts` (moved, unchanged). The unit project is pure again: 2 files, 383 ms, no DB module, no Chromium. The guard test still boots the real db module + Chromium in-process with its own temp `DATA_DIR`, which is fine in the `api` project (`fileParallelism: false`, Chromium already required there). |
| 42 | nit | **Fixed** | `repairArchivedPdfs()` (`invoices.ts:271-282`) walks every row with a `pdf_path` and renames `{n}.pdf.tmp` into place when the final file is missing; called at startup from `hooks.server.ts:13-16` (all imports, including `db.ts` and therefore the migration, are evaluated before the module body, so the table is ready). Orphan `.tmp` files without a row are left alone and overwritten by the next attempt, as before. Residual, not worth a finding: if `renameSync` itself fails after the commit (e.g. an AV lock on Windows) the invoice's PDF GET is 404 until the next restart; the repair could also be invoked lazily from the PDF route. |
| 43 | nit | **Fixed, but the limiter prune is a regression, see new finding 44** | `mkdirSync` removed (`expenses.ts`), `UploadFile.type` documented as informational, `tests/global-setup.ts` runs with `BODY_SIZE_LIMIT: '25M'`, `object-src 'none'`, `failures` map pruned. The "upload just above 20 MB → friendly 400" test is still missing (accepted). |

Tally: 6 fixed (37, 38, 40, 41, 42, 43), 4 with residuals (15, 25, 26, 39; all nit-level now).

### New findings introduced by the fixes

#### 44. [minor] The login-limiter prune resets the failure count 30 s after the last failure, weakening the brake five-fold

`src/routes/login/+page.server.ts:18,27`

`until` is set to `now + 30 s` on *every* failure (line 27), and the new prune (line 18) deletes any entry with `now >= until`, regardless of `count`. So the count only accumulates within a 30-second burst: an attacker sends 5 attempts, is refused for 30 s, the entry is then pruned on the next request, and 5 more attempts are free. Before the prune, an entry with `count >= 5` persisted and every further failure re-armed the 30-s window, so throughput after the first 5 was 1 attempt / 30 s; now it is 5 / 30 s (about 14 400 per day instead of about 2 900). Still a brake, but the fix for finding 11 was weakened by a line meant to be a no-op.

Fix: prune only entries that are both unlocked and idle for much longer than the lock, e.g. keep `lastFailure` and delete when `now - lastFailure > 15 min`; or only prune entries with `count < MAX_FAILURES`. Add a test: 5 failures, wait past the lock, one more failure must still be refused for 30 s.

#### 45. [minor] Any future drizzle-kit rebuild of `invoice` will fail at startup, and if forced through would silently drop the four `invoice` guard triggers

`drizzle/0001_indexes_and_guards.sql:45-47`, `drizzle/0002_status_guard.sql`, `src/lib/server/db.ts:24-30`

The `invoice_line_*` triggers reference `invoice` by name in a sub-select. SQLite (3.26+, `legacy_alter_table = OFF`, which is the default and what better-sqlite3 3.53.4 runs here) re-parses every trigger and view on `ALTER TABLE … RENAME`. The drizzle "recreate" pattern is `CREATE __new_invoice → INSERT … SELECT → DROP TABLE invoice → RENAME __new_invoice TO invoice`; at the moment of the rename `invoice` does not exist, so the rename now fails. Reproduced on a DB at `0002`: `error in trigger invoice_line_no_insert_issued: no such table: main.invoice`. It was not a problem in `0001` only because the line triggers were created *after* that rename. The failure is loud (the migrator rolls back and `db.ts` throws at boot on empty and populated DBs alike, so the dev/test run catches it), but it means the next schema change that touches `invoice` in a way drizzle-kit cannot express as `ADD COLUMN` (type/NOT NULL/default/FK change, column drop) will produce a migration that cannot run, and the generated SQL will have to be hand-edited every time.

Second half, verified with `PRAGMA legacy_alter_table = ON` around the rebuild: the rename then succeeds and the `invoice_line_*` triggers keep working against the renamed table, but `DROP TABLE invoice` takes `invoice_no_delete_issued`, `invoice_immutable_issued`, `invoice_status_values_insert` and `invoice_status_values_update` with it (`DELETE FROM invoice WHERE id = 1` on an issued row was allowed afterwards). drizzle-kit does not model triggers, so a generated rebuild will never re-create them. `migration.test.ts` asserts two trigger names (`audit_log_no_update`, `invoice_no_delete_issued`), so it would catch the loss of one of the four: a partial tripwire.

Fix (cheap; I verified the first two): (1) in `db.ts` set `legacy_alter_table = ON` next to `foreign_keys = OFF` and reset both after the check; (2) put a comment above the trigger block (and in the README developer section) stating that any migration that rebuilds `invoice` must re-create its four triggers; (3) make `migration.test.ts` assert the full list of nine trigger names so a future rebuild that drops any of them fails the unit run. Also consider moving the guard triggers into their own `drizzle/guards.sql` applied idempotently (`CREATE TRIGGER IF NOT EXISTS`) *after* `migrate()` in `db.ts`, which makes them immune to table rebuilds altogether.

#### 46. [nit] Leftovers from this commit

- `routes/api/invoices/[id]/credit/+server.ts:8-10`: a body that is not JSON, or an `expectedNumber` that is not an integer (`"abc"`, `1.5`), silently disables the number check instead of answering 400. Optional body is fine; a *present but malformed* value should be rejected, otherwise a buggy client believes it confirmed a number it did not.
- `tests/api/form-actions.test.ts` does not drive `?/credit` (the hidden `expectedNumber` field added in `fakturaer/[id]/+page.svelte:117` is only exercised through the JSON API), and no test sends `Origin: null` (finding 38).
- `tests/unit/migration.test.ts` asserts 2 of 9 trigger names (see 45) and none of the `0002` triggers.
- `formValues` lives in `expense-form.ts` but is now imported by the customer route (see 26).

### Positive observations (pass 3)

- The migration test is the right shape: it reproduces the migrator's own bookkeeping (`__drizzle_migrations` row with `created_at = when`) rather than mocking, applies real fixture rows that exercise every FK, and asserts guards on the migrated data. It also demonstrates the `unit` project can host DB tests without Chromium when the fixture is raw SQL, which answers finding 41 properly.
- The credit-note `expectedNumber` check mirrors the issue check exactly (same lock, same message pattern, same 409 semantics) and the test proves a stale confirmation consumes neither a number nor the original's status.
- The trigger tightening was done as `DROP TRIGGER IF EXISTS` + `CREATE` in a new migration rather than editing `0001`, so databases already at `0001` upgrade cleanly; `_journal.json` and `0002_snapshot.json` (`prevId` = `0001`'s id) are consistent.
- Integer line math with a single rounding point, plus the 2-decimal schema guard, means the stored `line_total_ore` is now deterministic for every input the API accepts.

### Result

Open findings: 7

- 15 (nit, was minor): the editor's preview still multiplies floats (`InvoiceEditor.svelte:51`), showing 14 øre where the server stores 15 for `0,29 × 0,50 kr`; move `computeLineTotalOre` to `$lib/format.ts` and share it.
- 25 (nit): unreachable `z.ZodError` branch in `api.ts:8`; twelve symbols exported but used only in their own file.
- 26 (nit): `count()` still duplicated in the layout and export loaders; `formValues` imported into a customer route from `expense-form.ts`.
- 39 (nit): `credited_by_invoice_id` can still be cleared, repointed, or set on an `issued` row by raw SQL (three cases verified); the status transitions themselves are now sealed.
- 44 (minor, new): limiter prune resets the failure count 30 s after the last failure: 5 attempts per 30 s instead of 1.
- 45 (minor, new): a future rebuild of `invoice` fails on the `invoice_line_*` triggers (`no such table: main.invoice`) and, if forced through, silently drops the four `invoice` triggers; add `legacy_alter_table = ON` around `migrate()`, document the trigger re-creation requirement, and assert all nine trigger names in the migration test.
- 46 (nit, new): malformed `expectedNumber` silently ignored on the credit API; no `?/credit` form-action test; no `Origin: null` test; migration test asserts 2 of 9 triggers.

Nothing at major severity remains. The two headline defects of earlier passes (credit-note VAT residue, migration failure on populated databases) are closed with regression tests; the remaining items are hygiene plus one weakened rate limiter and one latent migration trap.

---

## Pass 4

Scope: re-verify the 7 findings left open by pass 3 (15, 25, 26, 39, 44, 45, 46) against `b8d288f` (fix commit) and `0e9c08e` (design pass-2 minors, which also carries the editor line-total change), and read the rest of those two commits for regressions. Method: read `git diff HEAD~2 -- src drizzle tests` in full plus the current `db.ts`, `api.ts`, `invoices.ts`, `hooks.server.ts`, `login/+page.server.ts`, `invoice-form.ts`, `expense-form.ts`, `InvoiceEditor.svelte`, all four migrations, `_journal.json`/`0003_snapshot.json` and every changed test; ran `npm run check` (0 errors, 0 warnings) and `npx vitest run --project unit` (2 files, 11 tests, 389 ms; `migration.test.ts` boots `db.ts` on a populated `0000` database and passes). Did not run `npm test`/`npm run build` or start a server, so the `api` project (where the new `?/credit`, `Origin: null`, `'abc'` and `db-guards` tests live) was read, not executed. Three claims were tested with throw-away scripts in the scratchpad against an in-memory DB built from `0000`–`0003` with `db.ts`'s pragma sequence: (a) every legitimate write sequence and every forbidden `credited_by_invoice_id` transition against the `0003` trigger, plus speculative probes for holes; (b) a simulated future drizzle-kit rebuild of `invoice` under `legacy_alter_table = ON`, checking which triggers survive, FK targets and `foreign_key_check`; (c) whether `legacy_alter_table = ON` changes FK rewriting on a *genuine* table rename (it is documented to). The editor's line-total formula was compared with the server's over 1 430 000 quantity/price pairs fed through the same `parseQuantity`/`parseKrToOre` path the form action uses.

### Status of the pass-3 open findings

| # | Sev | Status | Evidence |
|---|---|---|---|
| 15 | nit | **Fixed** | `InvoiceEditor.svelte:52` is now `roundOre((Math.round(parseQuantity(q) * 100) * parseKrToOre(p)) / 100)`, the same integer hundredths × øre with one `roundOre` as `computeLineTotalOre` (`invoices.ts:63-66`). The form path (`invoice-form.ts:36-38`) feeds the server through the same two parsers, so the inputs are identical; brute force over every 2-decimal quantity ≤ 50 and prices ≤ 20 kr: 0 mismatches, and `0,29 × 0,50 kr` now previews 15 øre. The formula is duplicated rather than shared from `$lib/format.ts` as suggested; two three-line copies with a comment pointing at each other is acceptable, noted under 47. |
| 25 | nit | **Fixed** | The `z.ZodError` branch is gone and `api.ts` no longer imports `zod` (`api.ts:1-9`). The export scan now lists 16 symbols with no consumer outside their own file (`computeLineTotalOre`, `computeTotals`, `VAT_RATE_BP`, `sniffUploadExt`, `MAX_UPLOAD_BYTES`, the five CSV builders in `export.ts`, `Settings`, `VatReport`, `AuditLog`, `EditorLine`, `InvoiceStatusLabel`, `oreToCsv`); pass 3 already accepted these as harmless and I agree. Closed. |
| 26 | nit | **Fixed** | `countRows(table: AnyTable)` lives in `db.ts:73-75` and both loaders use it (`+layout.server.ts:12`, `eksport/+page.server.ts:15-18`); `formValues` moved to `api.ts:60-64` and is imported from there by `kunder`, `udgifter` and `udgifter/[id]`, with the copy in `expense-form.ts` removed. The only remaining `count(*)` in a route is the per-customer group-by in `kunder/+page.server.ts:13`, which is a query, not the helper. |
| 39 | nit | **Fixed for the three reported cases; two further raw-SQL paths remain** | `0003_credited_by_guard.sql` re-creates `invoice_immutable_issued` with: `credited` rows may not change `credited_by_invoice_id` (clear/repoint), `issued → issued` may not set it, `issued → credited` must set it; plus `invoice_credited_by_insert` forbids it on INSERT. Verified against the migrated DB: the full `creditInvoice` sequence (`invoices.ts:444-481`: insert note as `draft` without the link → insert its lines → note `draft → issued` with number/pdf_path → original `issued → credited` with `credited_by_invoice_id`, all in one transaction) passes; so do `issueInvoice`, `setPaidDate`, `updateDraft` and `deleteDraft`. Forbidden and confirmed refused: clear on credited, repoint on credited, set while issued, issued→credited without link, insert (draft or issued) with the link, credited→issued. `tests/api/db-guards.test.ts:71-80` covers set-while-issued, insert, credited-without-link and a bogus status. **Still open** (raw SQL only, the app never produces these): (a) `UPDATE invoice SET credited_by_invoice_id = X WHERE status = 'draft'` is allowed because the immutability trigger only guards `OLD.status <> 'draft'` and the insert trigger only guards INSERT; a later `draft → issued` flip then carries the link along, yielding an `issued` row that the UI renders as "credited by X". (b) The link may point at a draft or at the row itself (`SET status='credited', credited_by_invoice_id = id`), since the FK only checks existence. Both close with one clause each: in `invoice_status_values_update` add `OR (OLD.status = 'draft' AND NEW.credited_by_invoice_id IS NOT NULL)`; in the `issued → credited` branch add `OR NEW.credited_by_invoice_id = NEW.id OR (SELECT status FROM invoice WHERE id = NEW.credited_by_invoice_id) <> 'issued'` (safe for the app: the note is flipped to `issued` before the original is credited, `invoices.ts:474-481`). `paid_date` on a credited row is also unguarded; the service refuses it and it is not part of the immutable record, so I do not count it. |
| 44 | minor | **Fixed** | `login/+page.server.ts:19` prunes only entries with `count < MAX_FAILURES` whose window has passed; an entry at or above the threshold persists until a successful login from that address (`:33`), so after the first five failures every further attempt re-arms the 30 s window and throughput is back to 1 attempt / 30 s. `failures.size > 10_000 → clear()` bounds the map; on a Tailscale network source addresses cannot be forged, so the "flood 10 000 addresses to reset all locks" path is theoretical. The regression test pass 3 asked for (5 failures, wait past the lock, the 6th must still be refused) was not added; `LOCK_MS` is a hard-coded 30 s, so it would need to be env-configurable first. Noted under 47. |
| 45 | minor | **Fixed; the protection is adequate** | `db.ts:45-53` sets `legacy_alter_table = ON` next to `foreign_keys = OFF` before `migrate()`, resets it after, runs `foreign_key_check`, then asserts every name in `REQUIRED_TRIGGERS` (10 entries, `db.ts:27-38`) exists in `sqlite_master` and throws with an explanatory message otherwise (`:55-64`); `migration.test.ts:57-60` asserts the same list and pins its length. Simulated a drizzle-style rebuild of `invoice` on a `0003` DB under the new pragmas: the rename now succeeds (no `no such table: main.invoice`), the three `invoice_line_*` triggers keep binding to the renamed table (`DELETE FROM invoice_line` of an issued invoice still aborts), `foreign_key_check` is empty, `invoice_line.invoice_id` and the self-FK still target `invoice`, and exactly the five `invoice` triggers (`invoice_no_delete_issued`, `invoice_immutable_issued`, `invoice_status_values_insert/update`, `invoice_credited_by_insert`) are gone, which is precisely what the assertion would report. Assessment: because `migrate()` commits before the assertion runs, a rebuild migration that ships would leave the database migrated-but-guardless and the server refusing to boot on every restart until a follow-up migration re-creates the triggers (or a backup is restored). That is the right failure mode: while the app is down nothing writes to the file, the message names the cause, and, more importantly, the unit test boots `db.ts` on a populated `0000` DB so a drizzle-kit-generated rebuild fails `npm run check`-adjacent CI before it is ever committed. The assertion also catches manual `DROP TRIGGER` tampering at next boot. I also checked the documented side effect of `legacy_alter_table = ON` (FK clauses in other tables not rewritten on a genuine rename): on this SQLite 3.53.4, `ALTER TABLE customer RENAME TO client` rewrote `invoice.customer_id`'s target to `client` identically with the pragma ON and OFF, so no regression for real renames. What was not done from the pass-3 suggestion: no comment above the trigger block in the SQL and nothing in the README developer section; the only documentation is the `REQUIRED_TRIGGERS` docblock and the error text. A self-healing alternative (`CREATE TRIGGER IF NOT EXISTS` from a `guards.sql` applied after `migrate()`) would avoid the downtime but splits the schema across two sources of truth; fail-loud plus the test is a defensible choice. |
| 46 | nit | **Fixed; one small residual** | `expectedNumberFrom()` (`api.ts:52-57`) returns `undefined` for absent/`null`/`''` and throws 400 for anything that is not a positive integer; used by both JSON endpoints and both form actions (`issue`, `credit`). `invoicing.test.ts:255` asserts `'abc'` → 400; `form-actions.test.ts:88-95` drives `?/credit` with a stale number (409) and the right one (303 to `/fakturaer/{id}`, original becomes `credited`); `auth.test.ts:38-39` asserts `Origin: null` → 403; the migration test asserts all 10 triggers. Residual: `readJson(...).catch(() => ({}))` in `issue/+server.ts:8` and `credit/+server.ts:8` still turns a *present but unparsable* JSON body into "no check" (the value is now validated, the envelope is not), and `Number()` coercion accepts non-scalars (`true` → 1, `[5]` → 5). Both need a deliberately broken client; noted under 47. |

Tally: 5 fixed outright (15, 25, 26, 44, 45), 2 fixed with nit-level residuals (39, 46).

### New findings

#### 47. [nit] Leftovers from this commit

- `readJson(event.request).catch(() => ({}))` on the two number-confirming endpoints: distinguish "no body" (empty text → no check) from "unparsable body" (400). One `await request.text()` does it.
- `expectedNumberFrom` should require `typeof raw === 'number' || typeof raw === 'string'` before `Number()`; today `true` and `[5]` are accepted as 1 and 5.
- No regression test for the limiter (finding 44); make `LOCK_MS` overridable via env for tests, then assert the 6th attempt after the lock window is still 429.
- The rebuild requirement ("a migration that rebuilds `invoice` must re-create its triggers") is stated only in `db.ts`; a one-line comment above the trigger block in `0001` and a sentence under "Teknik" next to `npm run db:generate` in the README would put it where the next developer looks.
- Line-total formula is duplicated in `InvoiceEditor.svelte:52` and `invoices.ts:65` instead of shared via `$lib/format.ts`.
- `formDataToDraft` still throws on the first bad *line* (`invoice-form.ts:32-43`) before it collects header-field errors, so a bad line plus a bad date shows one message; the design pass's "all field errors at once" only holds for header fields and for the expense form. Out of this review's scope, flagged for the design reviewer.

### Positive observations (pass 4)

- The `0003` trigger clauses are minimal and exactly aligned with the one legitimate sequence in `creditInvoice`; every service write path was re-run against the migrated schema and none trips a guard. Doing it as `DROP TRIGGER IF EXISTS` + `CREATE` in a new migration keeps `0001`/`0002` databases upgradeable, and `_journal.json`/`0003_snapshot.json` (`prevId` = `0002`'s id) are consistent.
- `REQUIRED_TRIGGERS` exported from `db.ts` and consumed by the migration test means the list cannot drift between the runtime assertion and the test.
- Consolidating `formValues`, `expectedNumberFrom`, `isRedirect`, `routeId` in `api.ts` and `countRows` in `db.ts` leaves the route files with no local helpers; `expense-form.ts` no longer exports anything a customer route needs.
- `expense-form.ts` collects every field error before throwing and `LABELS` covers all seven keys it reports on, so no "undefined: Skal udfyldes" can appear.

### Result

Open findings: 2

- 39 (nit): two raw-SQL-only paths remain around `credited_by_invoice_id`: it can be set on a *draft* by `UPDATE` and carried into `issued`, and an `issued → credited` link may point at a draft or at the row itself. One extra clause in each of two triggers closes both; the app never produces either state.
- 47 (nit, new): leftovers: unparsable JSON body still silently disables the number check; `Number()` coercion of non-scalars; no limiter regression test; trigger re-creation rule documented only in `db.ts`; duplicated line-total formula; first-bad-line-only errors in `formDataToDraft`.

Nothing at minor or above remains. Across the four passes every major (1–7, 37) and every minor (8–24, 38, 44, 45) is closed with code, tests, or an accepted rationale; the migration path has now been exercised against a populated database in the unit run, the invoice status machine and its credit link are sealed at the storage layer for every path the application uses, and the rate limiter is back to its intended 1 attempt / 30 s after five failures.

---

## Pass 5 (final)

Scope: confirm the two nit-level items left open by pass 4 (39, 47) against `64f3e22`, and read the rest of that commit for regressions. Method: read the full commit diff and the current `db.ts`, `api.ts`, `invoice-form.ts`, `invoices.ts` (`updateDraft`, `issueInvoice`, `setPaidDate`, `creditInvoice`), `hooks.server.ts`, `login/+page.server.ts`, `InvoiceEditor.svelte`, `format.ts`, all five migrations, `_journal.json`, the `0003`/`0004` snapshots, `tests/global-setup.ts`, `tests/api/client.ts` and every changed test; checked adapter-node's `getClientAddress` (`adapter-node/files/handler.js:113-143`) to understand what `ADDRESS_HEADER`/`XFF_DEPTH` do to the test server. Ran `npm run check` (892 files, 0 errors, 0 warnings) and `npx vitest run --project unit` (2 files, 11 tests, 394 ms; `migration.test.ts` boots `db.ts` on a populated `0000` database, applies `0001`–`0004` and asserts all 12 `REQUIRED_TRIGGERS`). Did not run `npm test`/`npm run build` or start a server, so the `api` project (limiter test, JSON-body test, `db-guards`) was read, not executed. The trigger claims were tested with a throw-away script in the scratchpad against an in-memory DB built from `0000`–`0004` inside one transaction with `db.ts`'s exact pragma sequence (`foreign_keys = OFF`, `legacy_alter_table = ON` → migrate → reset, `foreign_key_check` empty, `foreign_keys = ON`).

### Status of the pass-4 open findings

| # | Sev | Status | Evidence |
|---|---|---|---|
| 39 | nit | **Fixed** | `0004_credited_by_target.sql` adds two `BEFORE UPDATE` triggers. `invoice_credited_by_draft` fires when `OLD.status = 'draft' AND NEW.credited_by_invoice_id IS NOT NULL`, closing path (a) in both forms: setting the link on a draft, and setting it in the same `UPDATE` that flips `draft → issued`. `invoice_credited_by_target` fires on `issued → credited` when `NEW.credited_by_invoice_id = NEW.id OR (SELECT status FROM invoice WHERE id = NEW.credited_by_invoice_id) IS NOT 'issued'`; `IS NOT` makes a NULL sub-select (missing link, nonexistent id) abort as well, so it overlaps the `0003` "must set the link" clause – harmless, and `db-guards.test.ts:78` accepts either message. Walked the legitimate `creditInvoice` sequence (`invoices.ts:430-477`) statement by statement against the migrated DB: insert note as `draft` without link (insert trigger sees NULL, passes) → insert note lines (note is draft, line trigger passes) → note `draft → issued` with number/pdf_path (`OLD.status = 'draft'` but `NEW.credited_by_invoice_id` inherits NULL, draft trigger passes; target trigger needs `OLD.status = 'issued'`, does not fire) → original `issued → credited` with link = note id (link ≠ own id; the sub-select sees the note already `issued` on the same connection, passes). All four steps pass; final state `{1: credited → 2, 2: issued}`. `issueInvoice`'s `.set({ invoiceNumber, status, pdfPath })`, `updateDraft`'s `.set({ customerId, issueDate, dueDate, vatExemptReason, paymentReference, ...totals })`, `setPaidDate` and `deleteDraft` never mention `credited_by_invoice_id`, so `NEW` inherits `OLD`'s NULL and neither new trigger can fire on them – re-run and confirmed. Refused and confirmed: set on draft, draft→issued carrying the link, link to a draft, link to itself, link to a credited row, link to a nonexistent id, credited without link, credited→issued, clear/repoint on credited, set while staying issued, insert with link. `db-guards.test.ts:79-86` covers set-on-draft, link-to-draft and self-link; `REQUIRED_TRIGGERS` lists 12 and the migration test pins 12; `_journal.json` entry 4 and `0004_snapshot.json` (`prevId` = `0003`'s id; table shape identical to `0003`'s apart from ids, as expected for a trigger-only migration) are consistent. |
| 47 | nit | **Fixed** | (1) `readOptionalJson()` (`api.ts:49-59`): `request.text()`, trimmed; empty → `{}`; anything that does not parse, or parses to `null`/non-object/array → 400 `Ugyldig JSON`. Used by the `issue`, `credit` and `paid` routes, replacing the three `readJson(...).catch(() => ({}))`. `auth.test.ts:60-71` posts an empty body with `content-type: application/json` (expects not-400, i.e. the 409 for the already-issued seed invoice) and `'{not json'` (expects 400). (2) `expectedNumberFrom()` (`api.ts:65-70`) accepts only a `number` or a string matching `/^\d+$/` after trim; everything else becomes `NaN` → 400, so `true`, `[5]`, `'1e3'`, `1.5` are all refused. (3) Limiter test `auth.test.ts:44-59`: five wrong passwords from `x-forwarded-for: 10.99.0.7` → 401 x5, then 429, then 429 with the *correct* password, then a login without the header succeeds. Made possible by `ADDRESS_HEADER=x-forwarded-for`/`XFF_DEPTH=1` in `tests/global-setup.ts:42-43`, which adapter-node honours; `ADDRESS_HEADER` is set nowhere else (Dockerfile/compose/README unchanged), so production still keys on the socket address. See the caveat under 49 about what "another address" means in the test environment. (4) README line 71 now states the rule inside the immutability paragraph: the triggers are listed in `REQUIRED_TRIGGERS`, a migration that rebuilds `invoice` must re-create them, and the app refuses to start if one is missing. It is not next to `npm run db:generate` (line 160) as suggested, but it sits in the section that explains the guarantee, which is where someone debugging a refused startup will look; accepted. (5) `lineTotalOre()` lives in `$lib/format.ts:103-106`, imported by `invoices.ts` (`computeLineTotalOre` kept as an alias so the four internal call sites are untouched) and by `InvoiceEditor.svelte:51`; the editor still imports `roundOre` for the VAT preview at line 62, so no dead import. (6) `formDataToDraft` (`invoice-form.ts:24-41`) collects every bad line via `flatMap` into `lineErrors` and throws once with `Linje 1: …; Linje 3: …` plus a `fields.lines` entry. |

Tally: both closed.

### New findings

#### 48. [nit] One credit note can be recorded as crediting two originals (raw SQL only)

`drizzle/0004_credited_by_target.sql`, `src/lib/server/schema.ts`

With originals A and B both `issued` and note N `issued`, `UPDATE invoice SET status = 'credited', credited_by_invoice_id = N WHERE id = B` succeeds after A already points at N (probe `(x1)`, allowed). The app cannot produce it: `creditInvoice` inserts a fresh note inside the same transaction that credits exactly one original, and refuses drafts, credited rows and credit notes as sources. It is the same class as finding 39 (a link state the UI would render as two invoices "credited by N") and closes with one statement: `CREATE UNIQUE INDEX invoice_credited_by_unique ON invoice (credited_by_invoice_id) WHERE credited_by_invoice_id IS NOT NULL;` (drizzle: `uniqueIndex(...).on(t.creditedByInvoiceId).where(sql\`credited_by_invoice_id IS NOT NULL\`)`). Optional; not worth holding a release for.

#### 49. [nit] Leftovers from this commit

- `paid/+server.ts:11-12`: a *present but non-string* `paidDate` (`{ "paidDate": 20260901 }`, `true`) silently defaults to today instead of answering 400 – the same "malformed value ignored" shape that 47 removed from `expectedNumber`. A string that is not `yyyy-mm-dd` is correctly refused by `setPaidDate`. Needs a deliberately broken client.
- Test environment: because `ADDRESS_HEADER` is set for the whole test server, every request *without* `x-forwarded-for` makes `getClientAddress()` throw (`handler.js:115-120`); the login action catches it and buckets those requests as `'unknown'` (`login/+page.server.ts:12-17`). So the limiter test's "another address still logs in" compares `10.99.0.7` against `'unknown'`, and every other test's failed login (only `auth.test.ts:16`, one failure, cleared by the next success) shares that bucket. Valid, but the test name promises slightly more than it proves; giving the `other` client a second distinct `x-forwarded-for` would make it literal, and a default header in `client.ts` would stop ordinary tests from exercising the catch branch.
- `formDataToDraft` still reports line errors and header errors in two rounds (bad lines throw at `:41` before the date/VAT-reason checks run); all bad *lines* are now shown together, which is what 47 asked for. Design-scope, noted for completeness.

### Positive observations (pass 5)

- The two new triggers are exactly the minimal clauses proposed in pass 4, shipped as a separate trigger-only migration rather than a fourth rewrite of `invoice_immutable_issued`, so that trigger's tested semantics are untouched and `0003` databases upgrade with two `CREATE TRIGGER` statements.
- `readOptionalJson` distinguishes the three cases (absent, malformed, wrong shape) with a single body read and is shared by all three optional-body endpoints, so their behaviour cannot drift apart.
- `$lib/format.ts` (no server imports) is the right home for `lineTotalOre`: the editor preview and the stored figure are now the same function, not two copies kept in sync by comment.
- The limiter test proves the property that matters – the lock holds even against the correct password – and the address-header plumbing is confined to `tests/global-setup.ts`.

### Result

Open findings: 2

- 48 (nit, new): raw SQL can point two credited originals at the same credit note; a partial unique index on `credited_by_invoice_id` closes it. The app never produces this state.
- 49 (nit, new): leftovers: non-string `paidDate` silently defaults to today; the limiter test's "other address" is the `'unknown'` bucket in the test environment; line and header form errors still arrive in two rounds.

Both are optional hygiene. Every finding raised in passes 1–4 (1–47) is closed with code, tests, or an accepted rationale; nothing at minor severity or above remains. The invoice status machine and its credit link are sealed at the storage layer for every transition the application performs and for every raw-SQL misuse identified across the five passes except the one-note-two-originals case above; the migration path is exercised against a populated database in the unit run with all 12 guard triggers asserted; malformed confirmation bodies and values are rejected rather than ignored; and the login brake is covered by a test.

---

## Pass 6 (final)

Scope: confirm the two nit-level items left open by pass 5 (48, 49) against `841fa27`, and read the rest of that commit for regressions. Method: read `git diff HEAD~1 -- src drizzle tests` in full plus the current `invoice-form.ts`, `paid/+server.ts`, `api.ts`, `db.ts`, `schema.ts`, `InvoiceEditor.svelte`, `fakturaer/[id]/+page.server.ts`/`+page.svelte`, `tests/api/client.ts`, all six migrations, `_journal.json` and the `0004`/`0005` snapshots (diffed with ids stripped: the only difference is the new index entry; `prevId` = `0004`'s id). Ran `npm run check` (892 files, 0 errors, 0 warnings), `npx vitest run --project unit` (2 files, 11 tests, 387 ms; `migration.test.ts` boots `db.ts` on the populated `0000` fixture and now applies `0001`–`0005`) and `npx drizzle-kit check` ("Everything's fine", read-only). Did not run `npm test`/`npm run build` or start a server, so the `api` project (new limiter client, `db-guards`) was read, not executed. The index claim was tested with a throw-away script in the scratchpad against an in-memory DB built from `0000`–`0005` with `db.ts`'s exact pragma sequence.

### Status of the pass-5 open findings

| # | Sev | Status | Evidence |
|---|---|---|---|
| 48 | nit | **Fixed** | `drizzle/0005_credited_by_unique.sql` is the one statement proposed: `CREATE UNIQUE INDEX invoice_credited_by_unique ON invoice (credited_by_invoice_id) WHERE credited_by_invoice_id IS NOT NULL`; `schema.ts:45` declares the same via `uniqueIndex(...).on(t.creditedByInvoiceId).where(sql...)`, and the `0005` snapshot carries `isUnique: true` plus the `where` clause, so drizzle-kit will not try to re-generate it. Probe against the migrated DB: five rows with a NULL link coexist (partial index, so drafts and issued rows are unaffected); the legitimate `creditInvoice` sequence (note inserted as draft, lines, note `draft -> issued`, original `issued -> credited` with link) passes, and a second such pair passes; then `UPDATE invoice SET status='credited', credited_by_invoice_id=10 WHERE id=2` with original 1 already pointing at note 10 is refused with `UNIQUE constraint failed: invoice.credited_by_invoice_id`; `paid_date` on the note remains writable. The unit migration test proves `0005` applies to a populated database. Note for operators, not a finding: a pre-existing database that already holds two originals on one note (only reachable by raw SQL before `0005`) would fail `CREATE UNIQUE INDEX`, roll back and refuse to start, the same fail-loud shape as the trigger assertion; the app never produced that state. |
| 49 | nit | **Fixed (all three bullets)** | (1) `paid/+server.ts:12`: a present `paidDate` that is neither string nor `null` is a 400 `paidDate skal være en dato`; `undefined`/`null`/`''` still default to today, the same convention `expectedNumberFrom` uses for an absent value; a non-`yyyy-mm-dd` string is still refused by `setPaidDate`. (2) `auth.test.ts:57-63`: the "other client" now posts with `x-forwarded-for: 10.99.0.8` and its own `origin`, so the test literally compares two spoofed addresses instead of `10.99.0.7` against the `'unknown'` bucket. `client.ts` still sends no default header, so ordinary tests continue to go through the `getClientAddress()` catch branch; accepted, it only affects the login route. (3) `invoice-form.ts:24-62`: `messages` starts as `[...lineErrors]`, `fields.lines` is set when any line failed, and header validation (VAT reason, both dates) runs before the single `badRequest(messages.join('; '), fields)`, so a bad line and a bad date now arrive together. **But** see new finding 50: the merged message is not visible in the editor. |

Tally: both closed as specified.

### New findings

#### 50. [minor] Line errors from the draft editor are never shown to the user

`src/lib/components/InvoiceEditor.svelte:75,109,121-129,179-183`, `src/lib/server/invoice-form.ts:44`, `src/routes/(app)/fakturaer/[id]/+page.server.ts:43-44`

The editor shows the general error banner only when there are *no* field errors (`{#if error && Object.keys(fieldErrors).length === 0}`), and renders inline errors only for the keys `issueDate`, `dueDate` and `vatExemptReason`; nothing renders `fieldErrors.lines`. Since `64f3e22` (the pass-5 fix commit) every bad line puts its message under `fields.lines`, so the banner is suppressed and the line message has no other outlet: saving a draft with quantity `abc` or price `1,2,3` returns 400 and the page re-renders with the typed values (`update({ reset: false })`) and no message at all. At `b8d288f` (pass 4) a bad line threw `badRequest(msg)` with no `fields`, so the banner showed it; pass 5 checked the payload shape (`fields.lines`) but not its rendering, and this commit keeps the shape. With a bad line *and* a bad date, the date error is shown and the line error still vanishes. The JSON API and `form-actions.test.ts` (which has no bad-line case) are unaffected; it is a UI-only defect, but the most common validation failure in the app's main form is now silent, hence minor.

Fix (one of): render the key: above the line table add `{#if err('lines')}<p class="error">{err('lines')}</p>{/if}` (best, keeps per-field placement); or change the banner condition to "show `error` whenever some key in `fieldErrors` has no inline render site"; or drop `fields.lines` and let the banner carry line errors (loses them again when a header error accompanies). Add a `form-actions.test.ts` case posting a bad line and asserting `fields.lines` mentions `Linje 1`, and a note in the editor that every key emitted by `formDataToDraft` needs a render site.

#### 51. [nit] The new guard test asserts the index exists, not that it enforces anything

`tests/api/db-guards.test.ts:90-96`

The test "two originals can never share one credit note" selects the credited rows, checks that an index named `invoice_credited_by_unique` is present, and then `expect(rows.length).toBeGreaterThanOrEqual(0)`, which cannot fail. The comment "Build the state by hand" describes a step that is not performed. A non-unique index with the same name, or a `WHERE` clause that excluded the real rows, would pass it. The fixture already has an issued invoice; the missing ten lines are: insert a second issued row and a note (draft, then issued), credit the first with the note, then assert the same `UPDATE` on the second throws `/UNIQUE constraint failed/`, mirroring the probe above. Optional: the property is verified by this pass and the migration test proves the index applies; only the regression tripwire is weak.

### Positive observations (pass 6)

- The index is declared in both sources of truth (`schema.ts` and the migration) with matching name, column and predicate, and `drizzle-kit check` plus the snapshot diff confirm nothing else drifted. Shipping one trigger-only or index-only migration per finding has kept every earlier trigger's tested semantics untouched across `0002`–`0005`.
- `paid/+server.ts` now applies the same "absent is fine, malformed is 400" rule as `expectedNumberFrom` and `readOptionalJson`, so the three optional-body endpoints behave identically.
- The limiter test now makes both halves literal: the locked address is refused even with the right password, and a genuinely different spoofed address logs in.
- `formDataToDraft` has a single throw site for validation, with every message and field collected first; the only remaining early exits are the two structural ones (unparsable / non-array lines), which are correct to fail fast.

### Result

Open findings: 2

- 50 (minor, new; introduced in `64f3e22`, missed by pass 5): line validation errors from the draft editor are invisible. The banner is suppressed by `fields.lines` and no element renders that key. One `{#if err('lines')}` block fixes it.
- 51 (nit, new): the `db-guards` test for the new unique index is existence-only with a tautological assertion; the constraint itself is verified here by probe, not by the suite.

Findings 1–49 are all closed with code, tests or an accepted rationale, and the storage-layer sealing of the credit link is now complete for every raw-SQL misuse identified across six passes. The one item worth fixing before release is 50: it is a two-line template change, but it turns the app's most common form-validation failure from silent back into visible.

---

## Pass 7 (final)

Scope: confirm the two items left open by pass 6 (50, 51) against `d897fab`, and read the rest of that commit for regressions. Method: read `git show --stat HEAD` and `git diff HEAD~1 -- src tests` in full, plus the current `InvoiceEditor.svelte`, `invoice-form.ts`, `fakturaer/[id]/+page.svelte`, `tests/api/client.ts`, `tests/api/db-guards.test.ts`, the `invoice` table definition in `0001` and every trigger in `0002`–`0004` (to check that the new raw-SQL fixture is not stopped by a guard before it reaches the unique index), `app.css` (`.error`, `.formerror`, `.layout-6-6`) and `vite.config.ts`. Ran `npm run check` (892 files, 0 errors, 0 warnings) and `npx vitest run --project unit` (2 files, 11 tests, 385 ms). Did not run `npm test`/`npm run build` or start a server, so the two changed `api`-project tests were verified by reading against the code paths they exercise, not executed. One SvelteKit runtime claim (below) was checked in `node_modules/@sveltejs/kit/src/runtime/server/page/render.js`.

### Status of the pass-6 open findings

| # | Sev | Status | Evidence |
|---|---|---|---|
| 50 | minor | **Fixed** | `InvoiceEditor.svelte:140`: `{#if err('lines')}<p class="error formerror">{err('lines')}</p>{/if}` sits directly under the `Fakturalinjer` legend, inside the fieldset and above the line table, i.e. the first of the three fixes proposed. `err` is `fieldErrors[k]` (`:75`) and the page passes `fieldErrors={form?.fields ?? {}}` (`+page.svelte:17`), so the `fields.lines` string built by `invoice-form.ts:44` (`Linje N: <message>` joined by `; `) now has a render site. Classes are the ones the existing banner uses (`.error` = xs, negative colour; `.formerror` = bottom margin `--space-4`), so no new CSS was needed; no `field--error` on the fieldset, which is right since that class only recolours an `.input` border. The banner condition at `:109` is unchanged, which is now fine: every key `formDataToDraft` can emit (`lines`, `vatExemptReason`, `issueDate`, `dueDate`) has an inline element. With a bad line and a bad date both messages are visible; with only a bad line the line message is visible. The requested test exists (`form-actions.test.ts:105-119`): `?/save` with `issueDate: '2026-13-40'`, one line with quantity `abc` and one with price `xx` → 400 and the HTML contains `Linje 1`, `Linje 2` and `Ugyldig dato`; the draft is deleted afterwards. See finding 52 on what that assertion does and does not prove. |
| 51 | nit | **Fixed** | `db-guards.test.ts:90-101`: three raw `INSERT … RETURNING id` rows with `status = 'issued'` and distinct high numbers (990001–990003; `invoice_number_unique` is respected), then `UPDATE invoice SET status = 'credited', credited_by_invoice_id = ? WHERE id = ?` once for original `a` (asserted `not.toThrow()`) and once for `b` (asserted `toThrow(/UNIQUE constraint failed: invoice.credited_by_invoice_id/)`). Checked against the guards so the failure is attributable to the index and nothing else: the insert supplies every `NOT NULL` column without a default (`customer_id` 1 exists from `beforeAll`, `issue_date`, `due_date`, `created_at`), `invoice_status_values_insert` passes (`issued`), `invoice_credited_by_insert` does not fire (link NULL); on the update `invoice_immutable_issued` allows `issued → credited` with a non-NULL link, `invoice_credited_by_target` passes (note is `issued` and is not the row itself), `invoice_status_values_update` passes; the only remaining constraint is the partial unique index from `0005`, so the second update fails there with exactly the asserted message. The tautological `toBeGreaterThanOrEqual(0)` and the existence-only index check are gone. |

Tally: both closed as specified.

### Rest of the commit

- `moms/+page.svelte` adds `layout-6-6--tables` and `app.css:567-569` stacks that grid below 1280 px; `.layout-6-6` still exists at `:516`, and `example.html`/`style.md` carry the same rule and sentence, so the design reference and the app stay in sync. Visual only.
- `fakturaer/[id]/+page.svelte:44` replaces a literal ` · CVR ` inside an `{#if}` with `{' · CVR '}` so Svelte cannot trim the surrounding spaces. Rendering only, no logic change.
- No `src/lib/server` or `drizzle` changes; the immutability model verified in passes 2–6 is untouched.

### New finding

#### 52. [nit] The new "bad line and bad date" test would still pass if the editor stopped rendering `fields.lines`

`tests/api/form-actions.test.ts:112-115`

The test asserts `Linje 1`, `Linje 2` and `Ugyldig dato` are substrings of the full response body. For an SSR page answering a form action, SvelteKit serialises the action result into the hydration script regardless of what the template renders: `render.js:99-102` picks `action_result.data` for both `success` and `failure`, and `:482-497` emits `form: ${uneval_action_response(form_value, …)}` inside `<script>`. `form.error` (`Linje 1: …; Linje 2: …; Fakturadato: ugyldig dato …`) and `form.fields.lines` therefore appear in the HTML even at `841fa27`, where finding 50 was open. So the test proves the payload reaches the page (which pass 6 already had) but is not a tripwire for the regression it was written after; deleting line 140 of the editor again would leave it green. The product behaviour is correct (verified by reading above); only the test is soft.

Fix (one line): match the rendered element rather than the raw string, e.g. `expect(html).toMatch(/formerror">Linje 1: [^<]*Linje 2:/)` and `toMatch(/<span class="error">Ugyldig dato/)`, or strip `<script>…</script>` blocks from `html` before the three `toContain`s. Optionally note in the test why.

### Positive observations (pass 7)

- The fix for 50 is the minimal one and lands in the right place: the message sits with the table it describes, reuses existing classes, and leaves the header-level banner logic alone.
- The rewritten guard test is now independent of the service layer for the property it checks and can only pass if the partial unique index is present, unique, and covers the rows it must cover; the earlier five guard tests in the same file were not touched.
- `npm run check` stays at zero, and the `unit` project remains fast and browser-free.

### Result

Open findings: 1

- 52 (nit, new): the regression test added for 50 asserts on the whole HTML, which includes SvelteKit's serialised `form` payload, so it cannot detect the rendering regression it targets. One regex change closes it.

Findings 1–51 are all closed with code, tests or an accepted rationale. Nothing in `d897fab` touches money, numbering, immutability, auth or storage; the only remaining item is the strength of one test assertion, not a defect in the application.

---

## Pass 8 (final)

Scope: confirm the one item left open by pass 7 (52) against `108ff67`, and check that the commit introduces nothing else. Method: `git show HEAD --stat` (only `tests/api/form-actions.test.ts` changed, +8/−6; no `src/`, `drizzle/` or config changes), read the full test file, `InvoiceEditor.svelte`, `udgifter/+page.svelte`, `invoice-form.ts`, `expense-form.ts`, both `+page.server.ts` actions, `validateForIssue` in `invoices.ts`, and `devalue/src/utils.js` + `kit/src/runtime/server/page/render.js` for how the action payload is serialised. Ran `npm run check` (892 files, 0 errors, 0 warnings). Did not run `npm test`/`npm run build` or start a server; the three assertions were verified by reasoning about the markup Svelte 5 SSR emits for the two templates.

### Status of the pass-7 open finding

| # | Sev | Status | Evidence |
|---|---|---|---|
| 52 | nit | **Fixed** | `form-actions.test.ts:19` adds `rendered()` = `html.replace(/<script[\s\S]*?<\/script>/g, '')`, and the three soft `toContain`s are replaced by regexes on the rendered markup (`:117-118`, `:130`, `:153`). Each regex is a real tripwire, see below. |

#### Why the stripping is safe

The only `<script>` that carries data is the hydration script (`render.js:483,586`), built with devalue's `uneval`. devalue escapes `<` in every string to `\u003C` (`devalue/src/utils.js:5, 63-64`), so the serialised `form` payload can never contain `</script>` (the non-greedy strip cannot terminate early) nor any literal `<` at all. As a consequence, even without the strip, none of the three regexes could match inside the script: all three require a `<` or a `">` tag boundary that the payload cannot contain. The strip is belt-and-braces, and correct.

#### Regex 1 – `/formerror">Linje 1: [^<]*Linje 2:/` (`:117`, bad line + bad date)

- **Passes with the site present.** `InvoiceEditor.svelte:140` renders `<p class="error formerror">{err('lines')}</p>` where `err('lines')` is `fields.lines` = `Linje 1: Ugyldigt antal: abc; Linje 2: Ugyldigt beløb: xx` (`invoice-form.ts:37,44`; messages from `format.ts:43,27`). Svelte escapes only `<` and `&` in text, neither occurs, so the output is `formerror">Linje 1: Ugyldigt antal: abc; Linje 2: …` and `[^<]*` spans the first message and the `; ` separator.
- **Fails with the site removed.** The only other `formerror` element is the header banner at `:110`, guarded by `error && Object.keys(fieldErrors).length === 0`. In this test `fieldErrors` has two keys (`lines`, `issueDate`), so the banner is not rendered, and no other element in the page contains `formerror`. Deleting `:140` therefore leaves zero occurrences of `formerror">Linje 1:` – the exact regression finding 52 wanted caught. (If a future change were to render `form.error` in the banner despite field errors, the regex would match that instead – acceptable, since that too shows the line errors to the user, which is the property finding 50 was about.)

#### Regex 2 – `/class="error">Ugyldig dato/` (`:118`, `:130`)

- **Passes with the site present.** `InvoiceEditor.svelte:124`: `{#if err('issueDate')}<span class="error">{err('issueDate')}</span>{/if}` with `fields.issueDate = 'Ugyldig dato – brug dd.mm.åååå'` (`invoice-form.ts:55`). Svelte 5 wraps the block in `<!--[-->…<!--]-->` comments, which sit outside the span and do not affect the match; `–` and `å` are emitted raw.
- **Fails with the site removed.** Every other `class="error"` in the draft branch was checked: `:110` (hidden, see above); `:129` dueDate (valid `21.09.2026` in both tests, not rendered); `:140` renders `class="error formerror">`, which the regex cannot match because the quote closes after `formerror`; `:238` `<li class="error">Udfyld mindst én linje…` (rendered, wrong text); `:240` `<li class="error">{p}</li>` over `data.problems`, which can only be the four fixed strings from `validateForIssue` (`invoices.ts:295-299`: `Fakturaen har ingen linjer` – filtered out anyway –, `Forfaldsdato ligger før fakturadatoen`, `Betalingsreference mangler`, `Udfyld firmaoplysninger…`), none starting with `Ugyldig dato`. `fakturaer/[id]/+page.svelte:33` (`<p class="error">{form.error}</p>`) is in the non-draft branch and unreachable here; its text would also start with `Linje 1:`/`Fakturadato:`, not `Ugyldig dato`. So removing `:124` leaves no match.

#### Regex 3 – `/field--error[^>]*>\s*<label class="label" for="amountExVat"/` (`:153`)

- **Passes with the site present.** `udgifter/+page.svelte:127-128`: `<div class="field field--span-3 {err('amountExVat') ? 'field--error' : ''}">` followed by whitespace and `<label class="label" for="amountExVat">`. `err` is `form?.fields?.[k]` (`:6`); the action returns `fail(400, { error, fields, values })` (`udgifter/+page.server.ts:31`) with `fields.amountExVat = 'Ugyldigt beløb – brug fx 1.234,56'` (`expense-form.ts:34`). Rendered: `class="field field--span-3 field--error">` + collapsed whitespace + `<label class="label" for="amountExVat">`; `[^>]*` consumes the closing quote, `\s*` the whitespace. No `{#if}`/`{#each}` sits between the two tags, so no hydration comment intervenes.
- **Fails with the class removed.** Without the conditional the div renders as `class="field field--span-3 "`. `[^>]*` cannot cross a tag boundary, so `field--error` on any other field (none has an error in this test anyway) cannot reach this label. There is no inline `<style>` (no `inlineStyleThreshold` in `svelte.config.js`), and CSS text could not be followed by `>\s*<label class="label" for="amountExVat"` in any case.

The pass-7 suggestion was `/<span class="error">Ugyldig dato/`; the builder's `/class="error">Ugyldig dato/` is marginally looser (element name not pinned) but still requires a rendered attribute/tag boundary, which is what matters. Accepted.

### Rest of the commit

Nothing else changed. The other assertions in the file (status codes, redirect locations, API state after each action) are untouched and were verified in passes 2–7.

### Result

Open findings: 0

Findings 1–52 are all closed with code, tests or an accepted rationale. The application code has not changed since `d897fab` (reviewed in pass 7); `108ff67` only hardens the regression test for finding 50 so that removing any of the three error render sites makes it fail. `npm run check` remains clean.

---

## Spec v2 — Pass 1

Scope: the two spec-v2 commits `59134bf` (kontoplan, cash movements, opening balance, six-CSV export) and `1678b10` (Resultat/Cashflow/Balance, reconciliation), reviewed as new code with the standards of passes 1–8. Method: read `git diff 0a7ec6b..HEAD -- src drizzle scripts tests vite.config.ts` in full plus the complete new files (`drizzle/0006`, `0007`, both snapshots, `schema.ts`, `accounts.ts`, `cash.ts`, `finance.ts`, the four new API routes, the three new pages and their actions, the settings page and actions, `export.ts`, `scripts/seed.ts`, `tests/api/00-finance.test.ts`, `tests/sequencer.ts`, `tests/unit/migration.test.ts`), and re-read the unchanged code the new code leans on (`db.ts`, `format.ts`, `listInvoices`/`setPaidDate` in `invoices.ts`, `vat.ts`, `api.ts`, `errors.ts`, `global-setup.ts`, `client.ts`). Ran `npm run check` (915 files, 0 errors, 0 warnings) and `npx vitest run --project unit` (2 files, 11 tests, 399 ms; this includes `migration.test.ts`, which applies `0000` to a populated fixture and then boots `db.ts`, so `0006`/`0007` were executed against real rows). Did not run `npm test`/`npm run build` or start a server; the API assertions were verified by hand against the seed (every hand-computed figure in the header comment of `00-finance.test.ts` was re-derived from `scripts/seed.ts` and agrees). Three claims below were tested empirically with a throw-away tsx script in the scratchpad that boots `db.ts` against a temp `DATA_DIR` (findings 53 and 58, and the `NaN` id binding in 65). Library versions: better-sqlite3 13.0.3 bundling SQLite 3.53.4 (so `DROP COLUMN` in `0007` is supported), zod 4.5.4, vitest 5.0.0.

Working-tree note: the review is of the two commits. While it was being written, uncommitted changes appeared in the working tree — `tests/sequencer.ts` moved to `vitest.sequencer.ts` (identical content, `vite.config.ts:3` updated), and a `0008_cash_movement_guard` migration with `cash_movement_no_update`/`cash_movement_no_delete` added to `REQUIRED_TRIGGERS` (`db.ts`) and to the trigger count in `migration.test.ts:65`. The latter addresses half of finding 57 below. `00-finance.test.ts` is also being extended with a `skyldigeKreditnotaerOre` balance line (credit notes against paid originals that have not been refunded). None of these working-tree edits are reviewed here; they should be verified in the next pass together with the account trigger and a guard test.

### Summary

| Severity | Count |
|---|---|
| blocker | 0 |
| major | 1 |
| minor | 6 |
| nit | 6 |

The migration is sound on populated databases, the money arithmetic in Resultat and Balance is right and matches independently re-derived seed figures, the type checks on accounts run inside the transactions, and movements are append-only at the API. The one major is in the cash view: flows dated before the opening-balance date are applied on top of a balance that already contains them, so Likvider is wrong for anyone who back-enters history. The minors are a wall-clock dependency in the new test, an untested reconciliation path, a two-step confirm that does not bind step 2 to what step 1 showed, immutability of movements/accounts that exists only in the API layer, regex-only dates that the cash view silently drops, and an empty opening-balance field that becomes 0.

### Migration `0006`/`0007` — verified, no finding

- `drizzle/0006_accounts_and_cash.sql:32-53` rebuilds `expense` with the drizzle recreate pattern. Nothing references `expense`: no FK from another table, no view, and none of the 12 triggers in `0001`–`0004` mention it (checked every `CREATE TRIGGER`), so neither the `foreign_keys = OFF` window in `db.ts:47-55` nor `legacy_alter_table = ON` (`db.ts:48`) has anything to protect or break here, and `REQUIRED_TRIGGERS` (`db.ts:27-40`) is unaffected — `migration.test.ts:62-65` confirms all 12 are present after the run. The two indexes that die with the old table (`expense_voucher_unique` from `0000`, `expense_date_idx` from `0001`) are re-created at `:54-55`.
- The `INSERT … SELECT … 11 …` at `:50` gives every existing expense account 11 (`2900 Øvrige omkostninger`), and `ALTER TABLE invoice_line ADD account_id … DEFAULT 1 NOT NULL REFERENCES account(id)` at `:57` gives every existing line account 1. SQLite only allows a non-NULL default on an added `REFERENCES` column while foreign keys are off — which `db.ts:47` guarantees before `migrate()`. `PRAGMA foreign_key_check` afterwards is `[]` on the fixture (`migration.test.ts:55`), and the fixture asserts both defaults landed (`:58-59`) and that `category` is gone after `0007` (`:60`).
- Explicit ids 1–11 on an `AUTOINCREMENT` table advance `sqlite_sequence` to 11, so `createAccount` gets 12 next (the API test creates 2700 successfully). The `PRAGMA foreign_keys=OFF/ON` lines inside the file (`:32`, `:53`) are still no-ops inside the migrator's transaction, as established in pass 2; harmless.
- `0006` keeps `category` in the rebuilt table and `0007` drops it one statement later; a single rebuild without the column would have done, but two files are what `drizzle-kit generate` produced and both are correct.

### Findings

#### 53. [major] `cashflow()` applies flows dated before the opening-balance date on top of the opening balance, so Likvider double-counts back-entered history

`src/lib/server/services/finance.ts:139-156` (range and running position), `:98-99` (opening balance and date), used by `balance()` (`:193,218`) and both reconciliation steps (`:234,240`).

The opening balance is documented as "the bank balance the cash views count from, as of `opening_balance_date`" (`settings-defaults.ts`, README "Åbningssaldo"). But the month range starts at `min(openingMonth, earliestFlowMonth)` (`:143`) and every paid invoice, paid expense and movement is added to `position` regardless of its date (`:148-155`). A flow dated before the opening date is therefore counted twice: once inside the bank figure the user typed, once again by the view. Reproduced: opening balance 1.000,00 as of 2026-06-01, one expense paid 2026-04-01 for 125,00 → `months` starts at `2026-04` and every month including the opening month shows position 875,00; `closingPositionOre` and `balance().likviderOre` are 87 500 where the bank has 100 000. The realistic case is exactly the onboarding flow this spec adds: a user who starts in September, sets today's bank balance as the opening balance and then enters the year's paid invoices and expenses for the VAT report will see Likvider inflated by the whole year's net cash flow, and "Afstemning" will then book a large `correction` to hide it. Nothing in the seed exercises it (opening date 2026-01-01 precedes every flow), which is why `00-finance.test.ts` passes.

Fix: in `cashflow()` skip flows with `date < openingBalanceDate` (paid invoices/expenses by `paidDate`, movements by `date`; make the boundary inclusive/exclusive explicit — "saldo pr. dato" is normally end-of-day, so exclude `<=` and say so in the settings hint) and start the range at the opening month, never earlier. Return the count and sum of excluded flows so the Cashflow page can show "N bevægelser før åbningssaldoen er ikke medregnet". Add a test with an opening date after a paid flow.

#### 54. [minor] `00-finance.test.ts` hard-codes 2026 sums that include the credit note, which is dated the day the seed runs — the resultat assertions break on 1 January 2027

`tests/api/00-finance.test.ts:16,54,66,68`; `scripts/seed.ts:97,155` (`creditInvoice` dates the note `todayIso()`).

The header comment computes `1000 Konsulentydelser = 46.800 + 12.000 − 12.000 + 12.500`, i.e. it relies on credit note 1006 falling in 2026. `resultat(2026, null)` filters on `issue_date` (`finance.ts:45`), so once the wall clock reaches 2027 the note leaves the year, `rev[1000]` becomes 7 130 000, `revenueOre` 9 900 000 and `resultOre` 9 085 580, and three assertions fail. The other figures are genuinely clock-independent, verified: `balance()` cuts accrued VAT at the end of the *current* quarter (`finance.ts:200`), which always contains today's credit note and, from 2026-09-08 onward, every seed date; the cashflow months are all in the past; `expected` is by fixed due dates; the Q2 filter never sees the note. Pass 1 raised this class as finding 18 and the accepted fix was to derive expectations from the note's actual `issueDate` (`vat.test.ts:66-73`); the new test does not follow it.

Fix: read the note's `issueDate` via `/api/invoices`, and either request `resultat` for that year and assert the pair nets to zero there, or compute the expected `1000` total as `4_680_000 + 1_200_000 + 1_250_000 − (noteYear === 2026 ? 1_200_000 : 0)`. Better still, let `seed()` take a fixed `today` (the pass-1 suggestion) so every seed date is a constant.

#### 55. [minor] Reconciliation — the only new write path in `finance.ts` — and the new form actions have no test

`src/lib/server/services/finance.ts:232-251`; `src/routes/(app)/balance/+page.server.ts:20-39`; `src/routes/(app)/cashflow/+page.server.ts:18-45`; `src/routes/(app)/indstillinger/+page.server.ts:48-79`.

`00-finance.test.ts` covers the three read views and the JSON API for accounts and movements; `form-actions.test.ts` was only touched to add `accountId`/`opening_balance` fields to existing cases. Nothing calls `reconcilePreview`/`reconcileBook` (only reachable through `?/reconcile` and `?/book`), so the difference arithmetic, the `differenceOre === 0 → 400` guard, the `today` date on the correction, the audit detail `{ reconciliation: { enteredBalanceOre, likviderOre } }` and the hidden-field round trip (`formatOre` → `parseKrToOre`, including the Unicode minus for a negative bank balance) are all unexecuted. The same holds for `/cashflow?/create` (Danish amount with sign, field errors) and the three kontoplan actions (`addAccount` with a duplicate number → 409 rendered as `fail`, `renameAccount`, `deleteAccount` on a referenced account). Pass 1 finding 7 set the standard that UI write paths are tested; these are the v2 equivalents.

Fix: extend `form-actions.test.ts`: `?/reconcile` with `actual` = Likvider + 1 234,56 → 200 with `preview.differenceOre === 123_456`; `?/book` with the same value → 200, then `GET /api/finance?view=balance` shows `likviderOre` equal to the entered figure and `GET /api/cash-movements` has a `correction` of 123 456 dated today; `?/book` again → 400. One case each for the cashflow form and the three kontoplan actions.

#### 56. [minor] Step 2 of the reconciliation books `actual − Likvider(now)`, not the difference the user confirmed in step 1

`src/lib/server/services/finance.ts:239-241`; `src/routes/(app)/balance/+page.svelte:77-84` (confirm box promises "en bankbevægelse … på {differenceOre}"); `+page.server.ts:30-34`.

The `?/book` form carries only `actual`. `reconcileBook` recomputes `balance()` and books whatever the gap is at that moment. Within one process that is atomic (the whole function is synchronous better-sqlite3 work, so no other request interleaves), so Likvider always ends equal to the entered bank figure — that part is safe. What is not bound is the *shown* amount: if an invoice is marked paid or a movement is added between the two requests (second tab, the same user finishing something else first), the correction booked differs from the one the `alertdialog` asked the user to confirm, silently. The audit row records the Likvider used, so it is traceable after the fact, but the project already treats exactly this problem as a 409 elsewhere (`expectedNumber` on issue/credit, `expectedNumberFrom` in `api.ts:65`).

Fix: add `<input type="hidden" name="expectedLikvider" value={form.preview.likviderOre}>` to the book form, pass it to `reconcileBook(actualOre, expectedLikviderOre)`, and throw `conflict('Likvider har ændret sig siden sammenligningen; sammenlign igen')` when it differs from `preview.likviderOre`. Cover it in the test from finding 55.

#### 57. [minor] "Movements are created, never edited or deleted" and "rename only" are enforced only by the absence of routes; the database allows both

`src/lib/server/services/cash.ts:36`, README "De rettes aldrig – en fejl modposteres med en korrektion"; `accounts.ts:51` ("Rename only: number and type stay"); `drizzle/0006_accounts_and_cash.sql` (no triggers); `tests/api/00-finance.test.ts:145-146` asserts `PUT`/`DELETE /api/cash-movements/:id` → 404, which proves no route exists, not that the rows are immutable.

Pass 1 finding 19 established that append-only/immutability claims in this app hold at the storage layer (`audit_log_no_update/no_delete`, `invoice_immutable_issued`, …) and `db.ts` asserts those triggers at startup. The two new claims of the same kind have no trigger at `HEAD`, so a future route, a script, or a `sqlite3` shell can rewrite a movement or flip an account from `cost` to `revenue` — the latter would silently move every line on it out of both Resultat lists, since `resultat()` partitions by the account's current type (`finance.ts:58-59`).

Fix: migration `0008` with `cash_movement_no_update`/`cash_movement_no_delete` (`RAISE(ABORT, …)`) and `account_immutable_number_type` (`BEFORE UPDATE OF number, type ON account`); add all three to `REQUIRED_TRIGGERS`; one raw-SQL case each in `db-guards.test.ts`. Deleting an unreferenced account stays allowed (a `BEFORE DELETE` trigger is not wanted; the FK already blocks referenced ones). The uncommitted `0008` in the working tree appears to do the movement half; the account trigger and the guard tests are still missing.

#### 58. [minor] Regex-only dates on the JSON paths produce months like `2026-13`, which `cashflow()` silently drops from the position

`src/lib/server/services/cash.ts:20` (movement `date`), `settings.ts:54` (`opening_balance_date`), `invoices.ts:364` (`setPaidDate`), all `^\d{4}-\d{2}-\d{2}$` with no calendar check; consumed by `finance.ts:86-93,139-156`.

Reproduced: `createMovement({ date: '2026-13-01', amountOre: -777, … })` is accepted; `cashflow()` then extends `last` to `2026-13`, emits empty rows for Oct–Dec (`nextMonth('2026-12')` is `2027-01`, which sorts after `2026-13`, so the loop ends) and never visits the `2026-13` bucket — the −777 is in the table and the export but not in Likvider. The same happens for a `paidDate` of that shape (the invoice also leaves Debitorer, so the money vanishes from both sides), and an `opening_balance_date` of `2026-13-01` makes `first > last`, so `months` is empty and the position is just the opening balance. The form paths are safe (`parseDateInput` validates the calendar), so this is API-only, but the JSON API is a documented surface and the failure mode is a wrong balance with no error.

Fix: one shared `isoDate` in `$lib/server/validation.ts` = `z.string().regex(…).refine(d => parseDateInput(d) === d, 'Ugyldig dato')` and use it in `cash.ts`, `expenses.ts`, `invoices.ts` (draft schema and `setPaidDate`), `settings.ts`. Additionally make `cashflow()` robust: iterate the sorted keys and assert every key is `^\d{4}-(0[1-9]|1[0-2])$`, throwing rather than dropping.

#### 59. [minor] An empty "Banksaldo" field saves an opening balance of 0 without an error

`src/routes/(app)/indstillinger/+page.server.ts:27-29` (`parseKrToOre(ob || '0')`).

`parseKrToOre('')` throws `Tomt beløb`, which would have produced the field error two lines below; the `|| '0'` fallback turns a cleared field into a silent reset of the figure every cash view starts from. Pass 1 finding 13 (`payment_terms_days: '' → 0`) was the same shape and was fixed to reject. The input is `required` in the markup, so this only bites with a hand-crafted POST or a browser that skips validation — hence minor — but it is inconsistent with the earlier fix. Also `settings.ts:49-53` puts no bounds on `opening_balance_ore` where every other money field has `±1e13`.

Fix: drop the `|| '0'`; add `.min(-1e13).max(1e13)` to the setting schema.

#### 60. [nit] The `account_id` defaults hard-wire seeded ids that the user may delete

`src/lib/server/schema.ts:76,93`, `drizzle/0006:40,57`, `invoices.ts:27` (`lineSchema.accountId.default(1)`), `invoice-form.ts:32` (`Number(l.accountId ?? 1)`), `InvoiceEditor.svelte` (`accounts[0]?.id ?? 1`).

`deleteAccount` permits deleting any unreferenced account, including 1 (`1000 Konsulentydelser`) and 11 (`2900 Øvrige`), which a new user renumbering the plan may well do. Afterwards the DB `DEFAULT 1/11` point at nothing (no insert path relies on them today, so no FK failure), but a JSON `PUT /api/invoices/:id` that omits `accountId` gets a 400 "Kontoen findes ikke" that does not say why. Either forbid deleting ids 1 and 11 (`conflict('Standardkontoen kan ikke slettes')`), or remove the application-level defaults so the API requires `accountId` like the expense schema already does (`expenses.ts:19`) and leave the DB default as a migration-only artefact.

#### 61. [nit] Dead exports

`accountLabel` (`accounts.ts:79-81`) and `EXPORT_CSVS` (`export.ts:102`) have no consumers in `src/`, `scripts/` or `tests/`. Same class as pass-1 finding 25. Wire `EXPORT_CSVS` into `exportZipStream` (iterate it) and the eksport page, or delete both.

#### 62. [nit] Number fields in the new zod schemas fall back to English messages

`accounts.ts:9` (`.min(1000).max(9999)` without messages; `z.coerce.number()` of `''` → `0` → "Too small: expected number to be >=1000", of `'abc'` → "Invalid input: expected number, received NaN"), `cash.ts:23` (`.max/.min` without messages), `expenses.ts:19` (`accountId` `.int().positive()` unlabelled). Every other message in these schemas is Danish and the settings form action passes the raw string through (`indstillinger/+page.server.ts:51`), so "Nr." = `12` shows the English text in the UI. Add `'Kontonummer skal være mellem 1000 og 9999'` etc.

#### 63. [nit] Repeated queries in the finance path

`finance.ts:102-114` runs two identical selects that differ only in `status` (one `inArray(invoice.status, ISSUED)` would do); `balance()` calls `listInvoices({ unpaidOnly: true })` (`:194`) although `cashflow()` (`:159`) has just done the same, and `listInvoices` carries two correlated sub-selects per row; `reconcileBook` → `reconcilePreview` → `balance()` → `cashflow()` recomputes everything a second time in the same request (`:234,240`); `updateDraft` runs one `requireAccountOfType` select per line (`invoices.ts:201`) where a `Set` of distinct ids would do. Irrelevant at single-user scale — noted for the record, consistent with pass-1 finding 29.

#### 64. [nit] The alphabetical sequencer is a sound stop-gap, but it makes the API suite order-dependent by construction

`tests/sequencer.ts:9`, `vite.config.ts:10,25`.

Vitest's `BaseSequencer.sort` orders by cached failures/duration, so without the override `00-finance` could run after files that add September invoices and expenses; with `fileParallelism: false` already set, forcing filename order is deterministic and cheap, and the intent is documented in both places. Two caveats: `localeCompare` is ICU-dependent (fine for `0` vs letters, less so if a future file starts with `_` or a capital), so `a.moduleId < b.moduleId ? -1 : 1` is the safer comparator; and the dependency is invisible from the other files — a future `aaa-*.test.ts` that mutates the seed would break `00-finance` for a non-obvious reason. The robust alternative is a third vitest project (`finance`) with its own `globalSetup` and fresh `DATA_DIR`, which removes the ordering requirement altogether and lets the sequencer go. The uncommitted move to `vitest.sequencer.ts` does not change any of this (and the Vite "import without a file extension" warning at `vite.config.ts:3` remains until `.ts` is added).

#### 65. [nit] Small inconsistencies in the new actions

- `finance.ts:245` formats the entered balance with `(actualOre / 100).toFixed(2).replace('.', ',')` — no thousands separator and an ASCII minus — while every other user-visible amount goes through `formatOre` (`$lib/format`, already imported by the module's neighbours). The string is stored in the movement description forever, so it will look different from the amounts around it.
- `indstillinger/+page.server.ts:62,73` parse ids with `Number(form.get('id'))`. Verified that `NaN` binds as SQL `NULL` in better-sqlite3, so `getAccount(NaN)` yields a clean 404 rather than a 500 — but `api.ts` already has `idParam`/`routeId` for this and pass 1 finding 26 asked for one helper; add a `formId(form)` next to `formValues`.
- `cash.ts:27-30` fetches every movement and filters the year in JS; `listInvoices` does the same filter in SQL. Cosmetic.

### Positive observations (spec v2, pass 1)

- The migration is the risky part of this change and it was done right: explicit seeded ids with the reason in a comment, indexes re-created after the rebuild, the populated-DB unit test extended to assert the defaults and the dropped column, and no trigger or FK anywhere that the rebuild could have orphaned.
- Every hand-computed figure in `00-finance.test.ts` was re-derived from `scripts/seed.ts` and agrees to the øre, including the deliberate inclusion of credited-but-paid 1002 in the cash view and the netting of the credit note in both Resultat and accrued VAT. The sign convention for `vat_payment` (negative when paid, `skyldig = accrued + payments`) is right for payments and refunds alike.
- `requireAccountOfType` runs inside the same `db.transaction` as the write in all three places (`invoices.ts:201`, `expenses.ts:92,126`), the credit note copies `accountId` line for line, and `contentFingerprint` now includes it, so the issue-confirm covers account changes.
- Cash movements carry `auditDetail` through `createMovement`, so the reconciliation's entered figure lands in the audit log as promised, and the export gained `cash_movements.csv`/`accounts.csv` with tests on their content.
- `setPaidDate` refuses credit notes, so `cashflow()` cannot see a negative "Fakturaer ind" — a case I looked for and did not find.
- `todayIso()` (Copenhagen) is used consistently for `asOf`, the correction date, the month range and the default year; no `new Date().toISOString().slice(0,10)` crept back in.

### Result

Open findings: 13

- 53 (major): flows before the opening-balance date are double-counted in Likvider — one range/filter fix plus a test.
- 54–59 (minor): clock-dependent resultat assertions; untested reconciliation and form actions; step 2 not bound to the previewed difference; append-only movements and fixed account number/type not enforced by triggers at `HEAD`; regex-only dates silently dropped by the cash view; empty opening balance saved as 0.
- 60–65 (nit): deletable default accounts, two dead exports, English zod messages, repeated queries, sequencer caveats, formatting/id-parsing inconsistencies.

Findings 1–52 from the earlier passes remain closed; nothing in the two commits reopens them (the immutability triggers, issue lock, integer money and Copenhagen dates are all still in place and exercised by the new code).

## Spec v2 — Pass 2

Scope: commit `008853b` ("Address spec-2 review findings …"), verified against findings 53–65 of "Spec v2 — Pass 1", plus a review of the other changes in the same commit (credit-note refunds, the "Skyldige kreditnotaer" liability, the right-alignment CSS fix, the stacked Konto select, the cashflow page rework). Method: `git show --stat HEAD` and the full `git diff HEAD~1 -- src drizzle tests` (1 308 lines), read together with the surrounding code (`finance.ts` in full, `listInvoices` and `setPaidDate`, the `invoice_immutable_issued` trigger body in `0001`–`0003`, `parseDateInput`, the settings/balance/cashflow actions, `InvoiceEditor.svelte`, `invoice-form.ts`, `accounts.ts`, `schema.ts`, `scripts/seed.ts`, `vite.config.ts`/`vitest.sequencer.ts` — the latter two were moved in `49ff15b`, between the two reviewed commits). Ran `npm run check` (915 files, 0 errors, 0 warnings) and `npx vitest run --project unit` (2 files, 11 tests, 392 ms; `migration.test.ts` applies `0000`–`0008` to the populated fixture and boots `db.ts`, so the three new triggers were created and asserted present). Did not run `npm test`/`npm run build` or start a server; every figure asserted in the new API tests was re-derived by hand from `scripts/seed.ts` and agrees (see 53 and 55 below).

### Verification of findings 53–65

| # | Sev. | Status | Evidence |
|---|---|---|---|
| 53 | major | **closed** | `finance.ts:107-131`: `sinceOpening()` filters paid invoices, paid expenses and movements on `date >= opening_balance_date`, counting and summing what it drops into `excludedBeforeOpening`; the range now starts at `monthOf(openingBalanceDate)` and is only ever extended forward (`:155-158`), so no bucket can precede `first` and none is silently dropped. `00-finance.test.ts:150-160` moves the opening date to `2026-05-01`; the seed has exactly two flows before that — 1001 paid 2026-04-27 (+58 500,00) and voucher 1 paid 2026-04-02 (−373,75), no movement is earlier than 2026-05-20 — so `{count: 2, netOre: 5_812_625}` and `closingPositionOre = 10_700_000 − 5_812_625` are right, and `months[0].month === '2026-05'` confirms the range start. The Cashflow page states the exclusion in the "Pr. måned" caption. Boundary chosen: inclusive (a flow dated on the opening date is counted, i.e. the figure is a start-of-day balance) — consistent in code and caption, but not stated to the user; see 66. |
| 54 | minor | **closed** | `00-finance.test.ts:56-58,72-74`: `creditIn2026` is read from 1006's `issueDate` via `/api/invoices`, and `rev[1000]`, `revenueOre` and `resultOre` are expressed as `7_130_000 + creditIn2026` etc. Header comment updated with the 2027 figure. The other assertions were already clock-independent (re-checked: `expectedLikvider: '105.305,00'` and `'305,00'` in the preview depend only on paid flows, not on today). |
| 55 | minor | **closed** | New `describe('reconciliation and forms')`: `?/reconcile` 200 with the difference in the HTML; `?/book` with a stale `expectedLikvider` → 409 and Likvider unchanged; `?/book` → 200, Likvider = 105 000,00, a `correction` of −305,00 whose description contains `105.000,00 kr.`; `?/book` again → 400. `/cashflow?/create` valid (+2 000,00 → Likvider 107 000,00) and `31.13.2026`/`abc`/empty → 400; JSON `2026-13-01` → 400. Kontoplan: add 2800, rename, `deleteAccount` with `id=abc` → 400, delete → 200 then 404; `?/save` with empty `opening_balance` → 400 (and the action throws before `updateSettings`, so nothing is saved — `indstillinger/+page.server.ts:52-53`). Every figure re-derived from the seed. |
| 56 | minor | **closed** | `reconcileBook(actualOre, expectedLikviderOre?)` (`finance.ts:274-278`) throws `conflict` when the previewed Likvider differs from the current one, before the zero-difference check; the confirm form posts `expectedLikvider` (`balance/+page.svelte:84`) formatted with `formatOre(…, false)` and the action parses it back with `parseKrToOre` (Unicode minus round-trips, as in `actual`). Tested (409 path). Two small residuals in 68. |
| 57 | minor | **closed** | `drizzle/0008_cash_movement_guard.sql`: `cash_movement_no_update`, `cash_movement_no_delete`, and `account_identity_immutable` (`BEFORE UPDATE ON account WHEN NEW.number <> OLD.number OR NEW.type <> OLD.type`; both columns are `NOT NULL` in `schema.ts:21,23`, so `<>` cannot go NULL and skip the check). `REQUIRED_TRIGGERS` has 15 entries, `migration.test.ts:65` asserts 15 and the unit run passed, so the migration executes on a populated database. `db-guards.test.ts:103-114` covers update/delete on a movement and number/type/name on an account (name change `not.toThrow()`), against its own temp `DATA_DIR`, so it does not pollute the shared suite. Snapshot `0008` chains from `0007` (`prevId 6c6507d4…`). Deleting an unreferenced account remains allowed, as requested. |
| 58 | minor | **closed** | `isValidIsoDate()` (`format.ts:87-93`) = `parseDateInput(s) === s`, which rejects `2026-13-01` and `2026-02-30` and — because `parseDateInput` normalises through `Date.UTC` — also rejects anything whose round-trip differs. Applied as a zod `refine` in `cash.ts:21`, `expenses.ts:13`, `invoices.ts:16` (draft schema, hence issue/due dates and `paidDate` on expenses), `settings.ts:55` and in `setPaidDate` (`invoices.ts:372`). The two secondary suggestions (one shared `isoDate` helper; `cashflow()` asserting its month keys) were not taken — noted in 70, not blocking since the write paths are now closed. |
| 59 | minor | **closed** | `indstillinger/+page.server.ts:35-38`: `parseKrToOre(ob)` with a distinct message for the empty field; `settings.ts:53` bounds `opening_balance_ore` to ±1e13. Tested (empty → 400). |
| 60 | nit | **closed** | `defaultRevenueAccountId()` (`accounts.ts:79-85`) resolves 1000 by number, else the lowest-numbered revenue account, else 400 "Kontoplanen har ingen salgskonti"; `updateDraft` calls it once only when some line omits `accountId` (`invoices.ts:201`), and `lineSchema.accountId` is now `.optional()` with no hard-wired id. The editor default mirrors it (`InvoiceEditor.svelte:44`), and `formDataToDraft` passes `undefined` through instead of `Number(… ?? 1)`. The DB `DEFAULT 1/11` remain as migration-only artefacts, which the finding allowed. One caveat about the editor's `accounts[0]` fallback in 69. |
| 61 | nit | **closed** | `accountLabel` is gone; `EXPORT_CSVS` became a private `CSV_FILES` name → builder map that drives the zip loop (`export.ts:102-118`). The eksport page still lists the six names by hand (`eksport/+page.svelte:33-38`) — acceptable, it also carries a Danish description per file. |
| 62 | nit | **closed (residual)** | Danish `{ error }` messages on every `z.coerce.number()` in `accounts.ts`, `cash.ts`, `expenses.ts`, `invoices.ts`, and Danish `.min/.max` on the account number. The `±1e13` bounds on `amountOre`/`amountExVatOre`/`vatOre`/`unitPriceOre` still have no message (English "Too big"); at 100 mia. kr. this is unreachable from the forms, so residual only — folded into 70. |
| 63 | nit | **closed** | The two status-specific selects are one `inArray(invoice.status, ISSUED)` query (`finance.ts:119`). The other repeats (second `listInvoices` in `balance()`, `reconcileBook` recomputing `balance()`, per-line `requireAccountOfType`) are kept; I agree — every one is sub-millisecond on a single-user SQLite file, and the per-line account check inside the transaction is the *safer* shape, not merely the slower one. |
| 64 | nit | **accepted** | The sequencer stays (`vitest.sequencer.ts`, moved out of `tests/` in `49ff15b` so the Docker build sees it). Acceptable as a stop-gap: with `fileParallelism: false` the order is deterministic and documented in both files, and `00-finance` now also *mutates* the shared database (books a correction, adds a movement and an account), so the intent "this file goes first" is more important, not less. Neither caveat from pass 1 was taken: the comparator is still `localeCompare` and the Vite warning "import ./vitest.sequencer without a file extension" is printed by both `npm run check` and `vitest` (seen in this run). Folded into 70. |
| 65 | nit | **closed** | `formatOre(actualOre)` in the correction description (asserted by the test: `105.000,00 kr.`); `accountIdFrom()` (`indstillinger/+page.server.ts:9-13`) rejects non-integers and ≤ 0 with a 400 (tested with `abc`). The third bullet (year filter in JS in `cash.ts`) is cosmetic and was not changed; fine. |

### Review of the other changes in `008853b`

- **Credit-note refund (`setPaidDate`)** — `invoices.ts:366-381`: credit notes may now receive a `paid_date` (audited as `mark_refunded`), and any second `paid_date` on any document is a 409. Interplay with `invoice_immutable_issued` (`0003_credited_by_guard.sql:4-11`): `paid_date` is deliberately absent from the column list, so the update passes for issued invoices and issued credit notes alike, while the trigger still blocks every other column — correct. Interplay with `cashflow()`: a refunded note comes through the same `inArray(status, ISSUED) AND paid_date IS NOT NULL` select, its negative `totalOre` is routed to `creditNotesOutOre` (`finance.ts:141-145`) and into `outOre`, so it lowers Likvider on the refund month — correct sign, and it is shown as its own sub-line in the "Ud" cell. `listInvoices({ unpaidOnly: true })` excludes credit notes (`invoices.ts:115`), so Debitorer and "Forventet ind" are untouched by either state — no double count against the new liability. One gap in what may be refunded: see 67.
- **"Skyldige kreditnotaer"** — `finance.ts:214-226`: issued, unpaid credit notes whose original (`o.credited_by_invoice_id = invoice.id`) has a `paid_date`; the outer table is referenced unaliased and the inner one as `o`, so the correlation is right. Summed as `−totalOre` (positive liability), included in "Forpligtelser i alt" and subtracted in `nettoOre`; the seed case (1006 credits the paid 1002 → 15 000,00) is asserted. Once the note is refunded it leaves this query and enters the cash flow in the same request, so the balance is consistent at every step. Correct.
- **Right-alignment fix** — `app.css:468`: `table.data th.num, table.data td.num { text-align: right }`. Verified the claim in the comment: `table.data th, table.data td` (`:431`, specificity 0,1,2) beats `.num` (0,1,0), so numeric cells in every `table.data` were left-aligned before; the new selector (0,2,2) wins. The `.num` rule itself still applies outside tables (`dd` cells in `.totals`). The invoice editor's `table.lines` is also `table.data` (`InvoiceEditor.svelte:148`), so its Beløb column benefits too. Balance page uses `neg()` returning only `num--neg` on `<dd>` — those are not table cells and are right-aligned by `.totals__row dd`, so no regression there.
- **Stacked Konto select** — the select moved under the description in the same `<td>` (`InvoiceEditor.svelte:163-169`), `Line.accountId` widened to `number | undefined`, `defaultAccountId` may be `undefined` when there are no accounts. Serialisation is unchanged: `JSON.stringify(lines)` (`:104`) omits `undefined`, `formDataToDraft` maps missing/empty to `undefined` and only validates a *present* id (`invoice-form.ts:32,37`), and `updateDraft` then falls back to `defaultRevenueAccountId()`; with an empty kontoplan that is a clean 400 rather than an FK failure. `svelte-check` is clean on the widened type. The `input--cell`/`cell-stack` rules moved to `app.css` are used by both the editor and the kontoplan table, so the de-duplication is real, not a move. One usability caveat in 69.
- **Cashflow page** — the 9-column table became 5 columns with sub-lines; `neg()` there returns `'num num--neg' | 'num'`, so Netto/Position are right-aligned with the rest. The new-movement form and the movement list are separate `<section>`s now, `.wrap` on the description column. Fine.

### New findings

#### 66. [nit] The opening-balance boundary is inclusive but nowhere says so

`finance.ts:110` (`r.date >= openingBalanceDate`), `indstillinger/+page.svelte:77,80` ("Saldoen, som cashflow og balance tæller fra." / "Pr. dato"), `settings-defaults.ts:12`, README "Åbningssaldo".

The code treats the figure as the balance at the *start* of the opening date: a payment dated the same day is counted on top of it. Bank apps and statements show the balance at the *end* of a day, so a user who types "saldo pr. 31.08." from the bank and dates it 31.08. gets every 31.08. flow counted twice; dating it 01.09. is correct but not something the UI suggests. Pass-1 finding 53 asked for the choice to be made explicit; it was made, but only in code. Fix: hint text "Saldoen ved dagens begyndelse – bevægelser på selve datoen tælles med", the same sentence in the README, and `Pr. dato` → `Pr. dato (morgen)`; or switch to `>` and say "ved dagens udgang".

#### 67. [minor] A credit note can be marked "refunderet" although its original was never paid

`invoices.ts:370-381` (`setPaidDate` checks only `status === 'issued'` and `!paidDate`); `fakturaer/[id]/+page.svelte:100-110` shows "Markér som refunderet" for every issued, unrefunded credit note; `tests/api/invoicing.test.ts:176-180` refunds a note whose original went `issued → credited` without ever being paid, and asserts 200.

When the original is credited before payment (`creditInvoice` on an open invoice — the common case: the customer disputed it), the original leaves Debitorer as `credited` and the note is a paper netting; no money changed hands and there is nothing to refund. Marking it refunded anyway books `−totalOre` into `creditNotesOutOre`, lowering Likvider by an amount the bank never paid out, and "Afstemning" will later book an equal-and-opposite `correction` to hide it. The README's own definition ("En kreditnota til en allerede betalt faktura er penge, kunden har til gode") and the `balance()` query both restrict the concept to paid originals; `setPaidDate` and the page do not. Fix: in `setPaidDate`, when `inv.isCreditNote`, load the original (`credited_by_invoice_id = id`) and `throw conflict('Den krediterede faktura blev ikke betalt; der er intet at refundere')` if its `paid_date` is null; in the page, show the refund form only when the original is paid (the detail already knows `creditsInvoiceNumber`); and change the invoicing test to pay the original first (and assert 409 in the unpaid case).

#### 68. [nit] `?/book` still accepts a request without `expectedLikvider`, and a malformed one is a 500

`balance/+page.server.ts:35-37`; `finance.ts:274-278` (`expectedLikviderOre?: number`).

The optional parameter exists so `reconcileBook` can be called without a preview, but nothing does that; the only caller is the form, which always sends the field. A hand-crafted POST that omits it skips the 409 guard (the exact gap finding 56 closed for the UI), and one that sends `expectedLikvider=abc` hits `parseKrToOre` outside the `badRequest` wrapper that `actualFrom` has, so `errorMessage` logs it and returns 500 "Der opstod en fejl". Fix: make the parameter required, and parse `expectedLikvider` with the same `try { … } catch { throw badRequest(…) }` as `actual`.

#### 69. [nit] The invoice editor lists cost accounts in the line's Konto select

`fakturaer/[id]/+page.server.ts:29` (`accounts: listAccounts()`), `InvoiceEditor.svelte:44,166-168`; compare `udgifter/[id]/+page.server.ts:13` (`listAccounts('cost')`) and `udgifter/+page.svelte:118` (filters to `cost` in the template).

Pre-existing in the v2 commits, but finding 60's fix now leans on it: the fallback `accounts.find(number === 1000) ?? accounts[0]` is a revenue account only because revenue numbers happen to sort below cost numbers. A user who picks `2100 Software` on a line gets a 400 "Fakturalinjer skal bogføres på en salgskonto" after submitting instead of never seeing the option; the udgifter side already does this right. Fix: pass `listAccounts('revenue')` to the editor (the detail view's read-only `acc?.name` lookup at `:80` needs the full list, so pass both or keep the full list for the lookup).

#### 70. [nit] Residuals from 58, 62 and 64

- Four copies of the same `isoDate` schema (`cash.ts:21`, `expenses.ts:13`, `invoices.ts:16`, `settings.ts:55`) instead of the one shared export asked for in 58; a fifth check lives in `setPaidDate`. One `isoDate` in `$lib/server/validation.ts` (or exported from `format.ts` next to `isValidIsoDate`) would do.
- `.max(1e13).min(-1e13)` on the four money fields still produce English messages (62). Unreachable from the forms, reachable from the JSON API.
- `vite.config.ts:3` still imports `./vitest.sequencer` without an extension; the warning is printed on every `npm run check` and every vitest run (64). Add `.ts` (SvelteKit's tsconfig uses `moduleResolution: bundler`, which accepts it) or set `VITE_CONFIG_NATIVE_IGNORE_WARNING`.
- `00-finance.test.ts:150-160` restores `opening_balance_date` at the end of the test body, not in `finally`/`afterAll`; a failing assertion leaves the shared database at `2026-05-01` for every later file. Nothing later asserts on Likvider today, so this is hygiene, not a live problem.

### Positive observations (spec v2, pass 2)

- The `sinceOpening()` shape — one filter closure that both drops and tallies — keeps the exclusion count and sum honest by construction, and returning it in the API (not just rendering it) meant the test could assert the exact pair.
- The refund path was extended without loosening anything: the immutability trigger already permitted `paid_date`, `unpaidOnly` already excluded credit notes, and the new liability query and the cash-out routing are symmetric, so the balance identity holds before and after a refund.
- The reconciliation test drives the real HTML form actions end-to-end (preview → stale 409 → book → verify through the JSON API → 400 on a second booking) rather than calling the service, which is what pass 1 asked for.
- `db-guards.test.ts` proves the new triggers with raw SQL in its own database, and the `not.toThrow()` on a name change guards against the trigger being made too broad in a future edit.

### Result

Open findings: 5

- 67 (minor): a credit note whose original was never paid can be marked refunded, booking phantom cash out.
- 66, 68, 69, 70 (nit): undocumented inclusive opening-date boundary; optional/unwrapped `expectedLikvider`; cost accounts selectable on invoice lines; residual duplication, English bound messages, the Vite extension warning and a test without `finally`.

Findings 53–65 are closed (64 accepted as a stop-gap). Findings 1–52 remain closed; nothing in `008853b` reopens them.

## Spec v2 — Pass 3 (final)

Scope: commit `49fcc2d` ("Refunds only for credit notes of paid originals, required previewed figure when booking a correction, …"), verified against findings 66–70 of "Spec v2 — Pass 2", plus a review of the other source changes in the same commit. Method: `git diff HEAD~1 -- src tests vite.config.ts` (14 source/test files, read in full) together with the surrounding code (`setPaidDate`/`getInvoice`/`creditInvoice`, the paid API route, the balance actions, `reconcilePreview`/`reconcileBook`, `parseKrToOre`, `InvoiceEditor.svelte`, the detail page's credit-note block, the cashflow page, the Indstillinger form, README). Ran `npm run check` (916 files, 0 errors, 0 warnings) and `npx vitest run --project unit` (2 files, 11 tests, 389 ms). Did not run `npm test`/`npm run build` or start a server, so the changed API tests were verified by reading them against the service code, not by execution. Only `review/quality-review.md` was written.

### Verification of findings 66–70

| # | Sev. | Status | Evidence |
|---|---|---|---|
| 66 | nit | **closed (doc residual → 71)** | `indstillinger/+page.svelte:77`: hint is now "Saldoen ved dagens begyndelse; bevægelser på selve datoen tælles med. Cashflow og balance tæller herfra." — exactly the sentence asked for, on the field the user fills in from the bank statement. `cashflow/+page.svelte:29`: KPI sub-line "ved dagens begyndelse {date} · ændres under Indstillinger". Both agree with `finance.ts` (`>= openingBalanceDate`, unchanged). The README sentence was not updated — see 71. |
| 67 | minor | **closed** | `invoices.ts:58-59,143`: `InvoiceDetail.originalPaidDate` is read in `getInvoice` from the row whose `credited_by_invoice_id = id` (the original), null for non-credit notes; `creditInvoice` sets it on the in-memory detail used for the PDF (`:440`), so the type is satisfied everywhere (svelte-check clean). `setPaidDate` (`:378-380`) refuses with 409 "Kreditnotaen modregner en ubetalt faktura; der er intet at refundere" when `isCreditNote && !originalPaidDate`, after the status and already-paid checks and inside the same transaction. This predicate is the same one `balance()` uses for "Skyldige kreditnotaer" (`o.paid_date IS NOT NULL`), so refundable ⇔ owed — the phantom cash-out is gone. The original's `paid_date` cannot change after crediting (status is `credited`, so `setPaidDate` refuses it; `invoice_immutable_issued` blocks every other column), so the decision is stable. UI: `fakturaer/[id]/+page.svelte:105-106` shows "Modregner en ubetalt faktura – intet at refundere." instead of the form; the API route (`api/invoices/[id]/paid`) needs no change since it calls the same service. Tests: `invoicing.test.ts:176-177` now asserts 409 on the unpaid-original case; new `describe('credit note refund')` (`:192-203`) pays the original first, credits it, refunds once (200, `paidDate` echoed) and asserts 409 on the second attempt. The new fixture is issue-dated 2026-09-07 with a same-quarter refund, so `vat.test.ts` (Q2 rows `[1001, 1002]`) and the cashflow/balance assertions in `00-finance` (which runs first) are unaffected, and the pair nets to zero in every view. |
| 68 | nit | **closed** | `finance.ts:274-279`: `expectedLikviderOre: number` (required) and `if (!Number.isInteger(expectedLikviderOre)) throw badRequest('Ugyldig sammenligningssaldo')` before the 409 comparison. `balance/+page.server.ts:34-39`: `parseKrToOre` on the raw field inside its own `try/catch` → `badRequest('Sammenlign først, og bekræft derefter korrektionen')`; `parseKrToOre('')` throws `Tomt beløb` (`format.ts:23`), so a request without the field is a 400, not a bypass, and `abc` is a 400, not a 500. `reconcileBook` is the only caller (`grep`), so the signature change is complete. Test added: `00-finance.test.ts:119-120` posts `?/book` with `actual` only and expects 400, before the existing 409/200/400 sequence. |
| 69 | nit | **closed** | `fakturaer/[id]/+page.server.ts:30` adds `revenueAccounts: listAccounts('revenue')`; the editor receives it (`+page.svelte:17`) while the read-only line table keeps the full `data.accounts` for the `acc?.name` lookup (`:76`). The `defaultAccountId` fallback `accounts.find(number === 1000) ?? accounts[0]` (`InvoiceEditor.svelte:44`) is therefore a revenue account by construction, not by sort order, and a cost account can no longer be picked and rejected after submit. Header renamed "Beskrivelse og konto" to match the stacked select. |
| 70 | nit | **closed** | (a) `src/lib/server/zod-shared.ts` exports `isoDate` (regex + `isValidIsoDate` refine) and `oreAmount(label)`; imported by `cash.ts`, `expenses.ts` (incl. the `paidDate` union), `invoices.ts` (issue/due dates, `unitPriceOre`) and `settings.ts` (`opening_balance_date`). `setPaidDate` keeps its own regex + `isValidIsoDate` on a plain string (`invoices.ts:373`) — same semantics, not a zod field, acceptable. (b) `oreAmount` gives Danish `max/min` messages ("… er for stort/for lille"); `settings.ts:53` gives "Åbningssaldo er for stor/for lille". No English bound message remains on a money field. (c) `vite.config.ts:3` imports `./vitest.sequencer.js`; `npm run check` and the vitest run print no "without a file extension" warning (grepped both outputs), and `moduleResolution: bundler` resolves `.js` → `.ts`. (d) `00-finance.test.ts:149-160`: the opening-date change and its assertions are in `try`, the restore is in `finally`. |

### Review of the other changes in `49fcc2d`

- **Cashflow table** (`cashflow/+page.svelte:46,61-66`) — the per-month sub-lines ("fakturaer … · bevægelser …" under Ind, "udgifter … · kreditnotaer … · bevægelser …" under Ud) were removed; the table is five plain columns, and the breakdown now appears once, as whole-range totals, in the "Pr. måned" caption (five `reduce` calls over `f.months`, evaluated in the template — trivial for at most a few dozen rows). The caption's five components sum to the `tfoot` Ind/Ud totals by construction (same fields), and `creditNotesOutOre` is still returned per month by `/api/finance?view=cashflow`. Consequence worth stating: the UI no longer shows *which month* a refund or a movement left the bank as a separate figure — only the month's Ud total. That is a deliberate layout trade (the 1152 px geometry shots in `review/shots-extra.ts`), the data is one API call away, and nothing in the spec material available to me requires the per-month split, so I record it as an observation, not a finding.
- **`.totals__row dd { white-space: nowrap }`** (`app.css:502`, mirrored in `example.html`) — stops a negative total from breaking after the minus sign in narrow totals; `dd` values are short, so no overflow risk. Fine.
- **`td.wrap` on the read-only line description** (`fakturaer/[id]/+page.svelte:78`) — uses the existing `table.data td.wrap { white-space: normal }` (`app.css:471`), so long descriptions wrap instead of widening the table. Fine.
- **`review/shots.ts`, `review/shots-extra.ts`, screenshots** — review tooling only (adds Resultat/Cashflow/Balance shots; the added flows stop at the reconcile preview and submit only invalid movement values, per the comment). Not source; not assessed further.

### New findings

#### 71. [nit] README still describes the opening balance without the boundary

`README.md:132`: "**Åbningssaldo** (Indstillinger) er den banksaldo, cashflow og balance tæller fra."

Finding 66 asked for the same sentence in the README as on the form; the form and the Cashflow KPI were updated, the README was not, so the one place a user reads before typing a bank figure for the first time still does not say whether it is a start-of-day or end-of-day balance. One sentence: "… den banksaldo ved dagens begyndelse, som cashflow og balance tæller fra; bevægelser på selve datoen tælles med." Documentation only — the code, the form and the KPI agree.

### Positive observations (spec v2, pass 3)

- The refund guard was placed on the same predicate the liability query already used, so "may be refunded" and "is owed" cannot drift apart; exposing `originalPaidDate` on `InvoiceDetail` let the page make the same decision without a second query or a duplicated rule.
- Both halves of 68 were closed in the right layer: the service now refuses a non-integer regardless of caller, and the action turns a missing/malformed field into a specific 400 rather than relying on the service's message.
- `zod-shared.ts` is small and does exactly the two things asked; the message parametrisation (`oreAmount('Moms')`) keeps the Danish field names the previous per-file schemas had.

### Result

Open findings: 1

- 71 (nit): the README sentence on Åbningssaldo does not state the start-of-day boundary that the form and the Cashflow KPI now state.

Findings 66–70 are closed (66 with the documentation residual above). Findings 1–65 remain closed; nothing in `49fcc2d` reopens them. Verified by static reading, `npm run check` (0/0) and the unit project (11/11); the changed API tests were not executed in this pass.

## Spec v2 — Pass 4 (final)

Scope: commits `61e62d0` ("Document the start-of-day opening balance boundary in the README") and `9d7e7ba` ("Set the cashflow component totals in the numeric font"), verified against finding 71 of "Spec v2 — Pass 3 (final)" and checked for anything else they touch. Method: `git show 61e62d0` / `git show 9d7e7ba --stat` / `git diff 61e62d0..9d7e7ba`, read together with `README.md:129-140`, `src/lib/server/services/finance.ts:99-190` (the `sinceOpening` filter and `excludedBeforeOpening`), the Indstillinger hint (`indstillinger/+page.svelte:77`), the Cashflow KPI sub-line and intro (`cashflow/+page.svelte:29,46`) and `.mono` in `src/app.css:469`. HEAD is `9d7e7ba`; `git status` shows no modified or untracked files under `src/`, so the committed state is what was reviewed. Ran `npm run check` (916 files, 0 errors, 0 warnings). Did not run `npm test`/`npm run build` or start a server. Only `review/quality-review.md` was written.

### Verification of finding 71

| # | Sev. | Status | Evidence |
|---|---|---|---|
| 71 | nit | **closed** | `README.md:132-134` (from `61e62d0`, the commit's only hunk, 3 lines in / 1 out, README only): "**Åbningssaldo** (Indstillinger) er den banksaldo, cashflow og balance tæller fra: saldoen ved dagens begyndelse på den angivne dato. Betalinger og bevægelser på selve datoen og senere tælles med; ældre er allerede indeholdt i saldoen og vises som udeladte på Cashflow-skærmen." Each clause matches the code. (a) Boundary: `finance.ts:110` keeps a row iff `r.date >= openingBalanceDate`, so a flow dated on the opening date itself counts — "ved dagens begyndelse … på selve datoen … tælles med" is the correct reading of `>=`. (b) Coverage: the same `sinceOpening` closure is applied to paid invoices incl. refunded credit notes (`:114-121`), paid expenses (`:122-129`) and bank movements (`:131`), so "Betalinger og bevægelser" names every input the filter sees. (c) Excluded set: rows failing the predicate are counted into `excluded` (`:111-112`) and returned as `excludedBeforeOpening` (`:185`); `cashflow/+page.svelte:46` renders "{count} bevægelser dateret før åbningssaldoen (… netto) er allerede indeholdt i den og tælles ikke med" whenever `count > 0` — which is what "vises som udeladte på Cashflow-skærmen" says. (d) Consistency: the README now agrees word-for-word in substance with the form hint (`indstillinger/+page.svelte:77`, "Saldoen ved dagens begyndelse; bevægelser på selve datoen tælles med. Cashflow og balance tæller herfra.") and the KPI sub-line (`cashflow/+page.svelte:29`, "ved dagens begyndelse {date}"). The three places a user meets the figure — the form, the screen and the manual — now state the same boundary, which is what 66 originally asked for. |

### Review of `9d7e7ba`

- `git show 9d7e7ba --stat`: one file, `src/routes/(app)/cashflow/+page.svelte`, 1 insertion / 1 deletion. `git diff 61e62d0..9d7e7ba` is that single line (`:46`): each of the five `{formatOre(f.months.reduce(…), false)}` expressions in the "Pr. måned" intro is wrapped in `<span class="mono">…</span>`. The expressions themselves — the reduced fields (`invoicesInOre`, `movementsInOre`, `expensesOutOre`, `creditNotesOutOre`, `movementsOutOre`), the `false` argument, the surrounding Danish text and the trailing `{#if f.excludedBeforeOpening.count > 0}` clause — are byte-identical to the previous version. Markup only, no logic or data change.
- `.mono` exists (`app.css:469`: `font-family: var(--font-numeric); font-variant-numeric: tabular-nums`) and is already the pattern used for inline figures in prose elsewhere (`balance/+page.svelte:30-44,67,81`, `InvoiceEditor.svelte:239,247`), so the intro now matches the rest of the app rather than introducing a new convention. svelte-check is clean, so the added spans are well-formed.

### Result

Open findings: 0

Finding 71 is closed by `61e62d0`; `9d7e7ba` is a one-line, markup-only change that introduces nothing new. Findings 1–70 remain closed — neither commit touches any code they concern (`61e62d0` is README-only, `9d7e7ba` changes a single template line without altering an expression). Verified by static reading of the two diffs against `finance.ts`, the form and the Cashflow page, and by `npm run check` (0/0); no tests were executed in this pass.
