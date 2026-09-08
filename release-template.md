# Faktura {{version}}

Faktura is a small bookkeeping program for one Danish business: invoices, expenses, quarterly VAT, and an AI helper
that can read your numbers but never issue an invoice. Everything stays on your own computer or server, in one folder
you can copy for backup.

**Updating never deletes data.** Before a new version changes anything in your database it writes a copy of the old
file to `data/backups/`. Install over an existing installation and your invoices, receipts and settings are kept.

## Install

**Windows:** download `faktura-windows-x64-{{version}}.exe` below and double-click it. A black window opens and asks
four questions (where to keep your data, which port, a password, and whether to create an AI key). Say yes when it
offers to download the PDF engine (about 150 MB, once). Then open the address it prints in your browser. Windows may
ask whether to trust the file the first time: choose "More info" and "Run anyway".

**Mac (Apple Silicon):** download `faktura-darwin-arm64-{{version}}`. Open Terminal, drag the downloaded file into the
window, press Enter, and answer the same four questions. If macOS refuses to open it, go to System Settings → Privacy &
Security and choose "Open anyway", then try again. The Mac binary is built on every release; it has not yet been run on
a Mac by the maintainer, so please report problems.

**Linux (x64):** download `faktura-linux-x64-{{version}}`, then `chmod +x faktura-linux-x64-{{version}} && ./faktura-linux-x64-{{version}}`.
Rendering PDFs needs the usual Chromium system libraries; if issuing an invoice fails, run
`npx playwright install-deps chromium` once, or install them with your package manager.

**Any computer or server with Docker** (the recommended way to run Faktura for real). Paste this into a terminal:

```bash
curl -fsSL https://github.com/kvit-app/faktura/releases/latest/download/install.sh | bash
```

On Windows with Docker Desktop, in PowerShell:

```powershell
irm https://github.com/kvit-app/faktura/releases/latest/download/install.ps1 -OutFile install.ps1; powershell -ExecutionPolicy Bypass -File .\install.ps1
```

The installer asks the same four questions, starts Faktura, and prints the address to open plus a ready-made snippet
for your AI client. Rerun it any time to update; your data is kept.

The Docker image is `{{image}}:{{version}}` (also `latest`), for amd64 and arm64.

### If you prefer to inspect before you run

For readers who know what a terminal is: download, verify, read, then run.

```bash
curl -fsSLO https://github.com/kvit-app/faktura/releases/latest/download/install.sh
curl -fsSLO https://github.com/kvit-app/faktura/releases/latest/download/SHA256SUMS
sha256sum --check --ignore-missing SHA256SUMS
less install.sh
bash install.sh
```

The same `SHA256SUMS` file covers the binaries.

## Security note

Faktura is built for one user on a private network. It has a single shared password, no 2FA, no brute-force lockout,
and has not been security audited. Run it on your own computer or behind a VPN such as Tailscale; see `HOSTING.md`
before exposing it to the internet.

## Changes in this release

{{commits}}
