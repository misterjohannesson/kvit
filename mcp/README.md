# kvit-mcp — MCP server for the Kvit (Faktura) app

An [MCP](https://modelcontextprotocol.io) server that lets an AI assistant read from and write to the
bookkeeping app on the owner's private network. It is a thin, typed HTTP client: it **never opens the
SQLite file** and talks only to the app's JSON API with a bearer token. Numbering, immutability and the
audit log are enforced once, in the app; every write made through this server is recorded there with
`actor = "api"`.

**Issuing and crediting invoices is intentionally not possible via MCP.** Both consume a number from the
legal series and are irreversible, so they stay human-only in the app UI. There is likewise no tool that
deletes anything or edits an issued document. Their absence is the safety model, not an oversight.

## Setup

In the app: set `API_TOKEN` (see the root README / `.env.example`) and restart. In `mcp/`:

```bash
npm install
npm run build
```

Environment variables for the server:

| Variable | Meaning | Default |
|---|---|---|
| `FAKTURA_URL` | Base URL of the app | `http://127.0.0.1:3000` |
| `FAKTURA_API_TOKEN` | Must equal the app's `API_TOKEN` | *(unset: every tool fails with an auth error, nothing is sent)* |
| `MCP_HOST` / `MCP_PORT` | Bind address and port for the HTTP transport only | `127.0.0.1` / `3333` |
| `MCP_ALLOWED_HOSTS` | Extra `host:port` values clients may address the HTTP transport as (comma-separated); the bound address and localhost are always allowed | – |

`API_TOKEN` must be at least 16 characters (the app refuses to start otherwise); generate one with `openssl rand -hex 24`.

Where the values come from, in order of precedence:

1. the shell environment (or the MCP client's `env` block);
2. `mcp/.env` (copy `mcp/.env.example`; git-ignored) for the five variables above;
3. the app's own `.env` in the repo root: its `API_TOKEN` is used as `FAKTURA_API_TOKEN` and its `PORT` as
   `FAKTURA_URL` when neither is set elsewhere, so a repo checkout needs the token in one place only.

Set `FAKTURA_SKIP_ENV_FILES=1` to ignore both files.

## Running

```bash
# stdio (from the repo root or from mcp/)
npm run mcp                     # root: tsx, no build needed
npm --prefix mcp start          # built: node mcp/dist/stdio.js

# streamable HTTP on http://127.0.0.1:3333/mcp (bind to the tailnet address with MCP_HOST)
npm run mcp:http
MCP_HOST=100.64.0.12 npm --prefix mcp run start:http

# MCP Inspector
npm --prefix mcp run inspect
```

### Client configuration

Which transport to use:

| Client | Local server | Notes |
|---|---|---|
| Claude Code | `claude mcp add --transport http kvit http://127.0.0.1:3333/mcp` after `npm run mcp:http`, or the stdio JSON below | plain `http` is fine for localhost |
| Claude Desktop | the stdio JSON below in `claude_desktop_config.json` (Windows: `%APPDATA%\Claude\`) | Desktop launches the server itself; no URL |
| claude.ai / Desktop "Add custom connector" | not for a local server | that dialog accepts only public `https` URLs reachable from Anthropic's side, hence "url must start with https" |

The HTTP server prints its URL and whether a token is configured when it starts.

With the Docker installers' HTTPS option (`FAKTURA_TLS`, see HOSTING.md) the endpoint is also available as
`https://<machine>.<tailnet>.ts.net:8443/mcp` (tailscale) or `https://kvit.localhost:8443/mcp` (local; loopback only,
certificate from the install directory's `kvit-root-ca.crt`, which Claude Code needs via `NODE_EXTRA_CA_CERTS`). The
installer adds those host names to `MCP_ALLOWED_HOSTS` for you. Neither makes the connector dialog work: it still needs
a public address.

stdio, e.g. Claude Code (`claude mcp add-json kvit '<json>'`) or Claude Desktop (`claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "kvit": {
      "command": "node",
      "args": ["C:/path/to/micro-finance/mcp/dist/stdio.js"],
      "env": {
        "FAKTURA_URL": "http://127.0.0.1:3000",
        "FAKTURA_API_TOKEN": "the-same-value-as-API_TOKEN"
      }
    }
  }
}
```

Streamable HTTP (a client on another machine on the tailnet; the token still lives only on the server side):

```json
{
  "mcpServers": {
    "kvit": {
      "type": "http",
      "url": "http://100.64.0.12:3333/mcp"
    }
  }
}
```

The HTTP transport is stateless and unauthenticated by itself; bind it only to localhost or the tailnet address,
never to a public interface. It validates the `Host` header (DNS-rebinding protection): requests must address the
bound `host:port`, localhost, or a value in `MCP_ALLOWED_HOSTS` (so a tailnet client should use the same address the
server is bound to). With a wildcard bind (`MCP_HOST=0.0.0.0` or `::`) no client ever sends the bound address, so set
`MCP_ALLOWED_HOSTS` to the tailnet IP or MagicDNS name plus port; the server warns at startup if it is missing.
`GET /healthz` reports whether a token is configured.

## Tools

Amounts are returned as both `amount_ore` (integer) and `amount_formatted` (`"1.234,56 kr."`). Dates are ISO
8601. Names and descriptions are English; data values stay Danish. Errors pass through structured: the app's
409 on an immutability rule becomes a tool error with `http_status: 409` and `retry: false`, never a retry.

Read:

| Tool | Answers | Arguments |
|---|---|---|
| `list_invoices` | what is coming in, who is overdue | `status?` (open · overdue · paid · draft · credited · credit_note · all; default open), `due_before?`, `year?` |
| `get_invoice` | full detail incl. lines and payment state | `number` |
| `list_expenses` | expenses with supplier, account, amounts, paid state | `year?` (default current), `unpaid_only?` |
| `cash_position` | what is my current bank: likvider, debitorer, kreditorer, skyldig moms, nettoposition, last reconciliation | – |
| `cashflow` | monthly in/out/net/position, `actual` vs `projected` months | `months_back?` (6), `months_forward?` |
| `vat_report` | salgsmoms, købsmoms, momstilsvar, deadline; `estimate: true` for future quarters | `quarter?` (`"2026-Q3"`, default current) |
| `resultat` | P&L per account, accrual basis; budget/variance columns (always null until a budget exists) | `year?`, `quarter?` |
| `budget_status` | YTD actual vs budget per account (budget_exists: false until a budget exists) | `year?` |
| `list_accounts` | kontoplan ids for the write tools | `type?` |
| `list_customers` | customer ids for drafts | – |

Write (append-only or reversible, all audit-logged as `actor = api`):

| Tool | Changes | Arguments |
|---|---|---|
| `mark_invoice_paid` | sets `paid_date` on an issued invoice (refund date on a credit note) | `number`, `paid_date` |
| `create_cash_movement` | appends a bank movement (vat_payment · owner · tax · correction · other) | `date`, `description`, `amount_ore` (signed), `kind` |
| `reconcile_balance` | afstemning: compares the bank's figure with likvider and books a `correction` for the delta (nothing if equal) | `actual_bank_balance_ore`, `date?` |
| `create_draft_invoice` | creates a **draft** only; the response says issuing is done by the owner in the UI | `customer_id`, `lines[]`, `issue_date?`, `due_date?`, `payment_reference?`, `vat_exempt_reason?` |
| `create_expense` | creates the expense row (next voucher number); the bilag file is attached in the UI | `date`, `supplier`, `description`, `account_id`, `amount_ex_vat_ore`, `vat_ore`, `paid_date?` |

Beyond the spec's parameter lists, a few optional arguments are accepted because the app supports them: `list_accounts(type?)`,
`create_draft_invoice(issue_date?, payment_reference?, vat_exempt_reason?)` and `create_expense(paid_date?)`. All stay
append-only. Writes made by the seed script or by code outside a request are logged as `actor = "ui"`; the app's audit
enum has only `ui` and `api`.

Budget note: the app does not have a budget feature yet. `resultat` and `budget_status` return `budget_exists:
false` with null budget/variance columns, `cashflow` projects from open invoices, unpaid expenses, credit notes
and VAT deadlines only, and `vat_report` marks future quarters `estimate: true` from documents already dated
there. The tool shapes are stable so a budget can be wired in later without changing callers.

## Tests

```bash
# from the repo root: build the app once, then
npm run build
npm run mcp:test
```

The tests boot the real app (`../build`) against a fresh seeded database with an `API_TOKEN`, connect a real MCP
client to the server over an in-memory transport, and check: the tool list and schemas; every read tool against
hand-computed seed figures in exact øre; every write tool against the app's API afterwards, including the
`actor = "api"` audit rows; `reconcile_balance` booking exactly the delta and then nothing; wrong and missing
tokens failing every tool without changing state; and a grep over the whole `mcp/` tree (excluding `node_modules`
and `dist`) for any database-driver import, ORM import or database file path.
