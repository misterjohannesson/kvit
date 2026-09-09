# Hosting Faktura remotely

Faktura is built for one user on a private network. It has a single shared password, no 2FA, no brute-force lockout, and has not been security audited. The recommended setup is VPN-only access (e.g. Tailscale). Exposing it directly to the internet is at your own risk — this guide reduces that risk, it does not remove it.

This guide is for a competent hobbyist running Faktura on one machine: a home server, a small VPS or a NAS that
can run Docker. Everything here is one compose file on one box. There is no clustering, no scaling and no
Kubernetes; if you need those, Faktura is the wrong tool.

Contents

1. [Recommended: VPN-only](#1-recommended-vpn-only)
2. [If you must go public](#2-if-you-must-go-public)
3. [Backups](#3-backups)
4. [Updating](#4-updating)

---

## 1. Recommended: VPN-only

Run the installer on the machine that will host Faktura (release page or README), then make that machine reachable only
through a private network. No port on the machine is opened to the internet.

### Tailscale

1. Create a free Tailscale account and install Tailscale on the server and on each device you will use:
   <https://tailscale.com/download>.
2. On the server, sign in: `sudo tailscale up`. Note the machine's tailnet address (`tailscale ip -4`, e.g.
   `100.64.0.12`) or its MagicDNS name (e.g. `faktura.tailnet-name.ts.net`).
3. Install Faktura as usual. The installer binds the web app to all interfaces on the port you chose (default 3000),
   but the machine's firewall (below) keeps it off the public interface; Tailscale traffic arrives on the `tailscale0`
   interface and is allowed.
4. From any device on the tailnet, open `http://100.64.0.12:3000` (or the MagicDNS name). For HTTPS with a real
   certificate, answer `tailscale` to the installer's HTTPS question (next subsection), or run
   `tailscale serve --bg 3000` yourself for `https://faktura.tailnet-name.ts.net`, still tailnet-only.
5. The MCP endpoint is published on `127.0.0.1:3333` only, and it has no login of its own: whoever can reach the port
   can use every tool, including the write tools. To use it from another tailnet device, either run the AI client on
   the server itself, or forward it over the tailnet with `tailscale serve --bg --tcp 3333 tcp://127.0.0.1:3333`
   (then every device on your tailnet has that access) and add the address clients will use to `MCP_ALLOWED_HOSTS` in
   `.env` (e.g. `MCP_ALLOWED_HOSTS=100.64.0.12:3333`; the installer carries it across reruns; details in
   [mcp/README.md](https://github.com/kvit-app/faktura/blob/main/mcp/README.md)). Never publish it on the public
   interface.

### HTTPS from the installer

Both installers end with an optional fifth answer, `FAKTURA_TLS`, kept in `.env` across reruns like everything else.
The default, `none`, is the plain setup above. Neither option makes Faktura reachable from the internet, and neither
one satisfies the "Add custom connector" dialog in claude.ai or Claude Desktop: that dialog connects from Anthropic's
servers and needs a public `https` address, so a local or tailnet-only server is added over stdio there (see the MCP
README). The value of HTTPS here is for browsers and for Claude Code and other MCP clients on your own devices.

**`tailscale`.** The installer runs `tailscale serve` for you: the app on `https://<machine>.<tailnet>.ts.net`
(port 443) and the MCP endpoint on port 8443 of the same name, both with a real Let's Encrypt certificate, both
reachable from your tailnet only. Requirements: the Tailscale CLI on the server, MagicDNS and *HTTPS Certificates*
enabled in the admin console (DNS page). The MCP host name is added to the endpoint's allowed hosts automatically. The
first certificate can take a minute. `tailscale serve status` lists the mounts; `tailscale serve --https=443 off`
removes one; the installer removes both when you switch back to `none`. Remember that the MCP endpoint has no login:
with this option every device on your tailnet can use every tool.

**`local`.** For one machine without Tailscale: Caddy runs as a third compose service with its own certificate
authority and serves the app on `https://kvit.localhost` (port 443, or the port you choose) and the MCP endpoint on
`https://kvit.localhost:8443/mcp`, bound to loopback only like the plain MCP port. The root certificate is copied to
`<install dir>/kvit-root-ca.crt`. Nothing on the machine is changed unless you answer yes to the follow-up question,
which adds `127.0.0.1 kvit.localhost` to the hosts file and imports the root into the system trust store
(macOS keychain, Debian/Ubuntu `update-ca-certificates`, Fedora `update-ca-trust`, the current user's store on
Windows); that step needs `sudo`, or an elevated PowerShell for the hosts file on Windows. Browsers and Claude Desktop
read the system store; Claude Code does not, so start it with `NODE_EXTRA_CA_CERTS=<install dir>/kvit-root-ca.crt`.
Do not use this option on a shared server: a root certificate you trust can sign for any name, so keep the `caddy/`
folder and `kvit-root-ca.crt` as private as `.env`.

Non-interactive equivalents: `FAKTURA_TLS`, `FAKTURA_DOMAIN`, `FAKTURA_TLS_PORT`, `FAKTURA_MCP_TLS_PORT`,
`FAKTURA_TRUST_LOCAL=1`, and `FAKTURA_TAILSCALE_BIN` when the CLI is not on `PATH`.

### Firewall (Linux, ufw)

Allow SSH and the tailnet, deny everything else from the internet:

```bash
sudo ufw default deny incoming
sudo ufw default allow outgoing
sudo ufw allow in on tailscale0
sudo ufw allow 22/tcp
sudo ufw enable
```

### WireGuard instead of Tailscale

Any WireGuard setup works the same way: install `wireguard-tools`, exchange keys, give the server a tunnel address
(e.g. `10.8.0.1/24`), allow the tunnel interface in the firewall (`sudo ufw allow in on wg0`) and open only the
WireGuard UDP port (`sudo ufw allow 51820/udp`). Then reach Faktura on `http://10.8.0.1:3000`.

---

## 2. If you must go public

Read the paragraph at the top of this file again. Then, if you still need Faktura on the open internet:

### Secrets

Use a long random password and token; both are only ever typed once (the browser remembers the password, the MCP
client stores the token):

```bash
openssl rand -base64 24   # APP_PASSWORD
openssl rand -hex 24      # API_TOKEN
```

Rerun the installer to change them; it rewrites `.env` and restarts the containers, data untouched.

### Caddy reverse proxy with automatic TLS and login rate limiting

Point a DNS name at the server, open only 80 and 443 (below), and put Caddy in front of the app. Caddy obtains and
renews the certificate by itself. The `rate_limit` directive needs the
[caddy-ratelimit](https://github.com/mholt/caddy-ratelimit) module; the second, module-free block below achieves a
similar effect with plain Caddy and a firewall.

`/etc/caddy/Caddyfile` (with the ratelimit module):

```caddyfile
{
	order rate_limit before basicauth
}

faktura.example.com {
	encode zstd gzip

	# Login attempts: 10 per minute per client address. The app has no lockout of its own.
	@login {
		path /login
		method POST
	}
	rate_limit @login {
		zone login {
			key    {remote_host}
			events 10
			window 1m
		}
	}

	# The MCP endpoint lives on a separate port that is NOT proxied here: keep it VPN-only (section 1).
	reverse_proxy 127.0.0.1:3000 {
		header_up X-Forwarded-For {remote_host}
	}

	header {
		Strict-Transport-Security "max-age=31536000"
		X-Content-Type-Options nosniff
		Referrer-Policy no-referrer
	}
}
```

Plain Caddy without extra modules (no rate limit at the proxy; rely on the firewall's connection limit below):

```caddyfile
faktura.example.com {
	encode zstd gzip
	reverse_proxy 127.0.0.1:3000 {
		header_up X-Forwarded-For {remote_host}
	}
	header Strict-Transport-Security "max-age=31536000"
}
```

Two settings go with the proxy, both in the install directory's `.env` (the installer keeps them across reruns, so
updating never undoes them; never hand-edit `docker-compose.yml`, which the installer rewrites):

```text
FAKTURA_BIND=127.0.0.1
ADDRESS_HEADER=x-forwarded-for
XFF_DEPTH=1
```

`FAKTURA_BIND=127.0.0.1` keeps the app's own port off the public interface so only Caddy reaches it. `ADDRESS_HEADER`
and `XFF_DEPTH` (read by the app's Node adapter) make the app trust Caddy's `X-Forwarded-For`, so its own login throttle
(five failures, then a 30-second pause, per address) and the `Login failed from …` log lines see the real client
address instead of Caddy's. Apply with `docker compose up -d` in the install directory, or by rerunning the installer.
The MCP service is bound to `127.0.0.1` regardless and must stay that way; use the VPN for it.

### Firewall for a public host

```bash
sudo ufw default deny incoming
sudo ufw default allow outgoing
sudo ufw allow 22/tcp
sudo ufw limit 22/tcp
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw enable
```

`ufw limit` throttles SSH brute force. Ports 3000 and 3333 are not opened: Caddy talks to them on localhost.

### OS basics

- Unattended security updates: `sudo apt install unattended-upgrades && sudo dpkg-reconfigure -plow unattended-upgrades`.
- SSH with keys only (`PasswordAuthentication no` in `/etc/ssh/sshd_config`).
- Keep Docker updated (`sudo apt upgrade docker-ce docker-compose-plugin`), and let Watchtower or a weekly
  `docker compose pull && docker compose up -d` bring in Faktura updates (section 4).
- Watch the login log once in a while: `docker compose logs app | grep -i "login failed"` (the app logs every failed
  attempt with the client address).

---

## 3. Backups

Everything Faktura knows lives in one folder: `<install dir>/data` (`app.db` plus `files/` with every PDF and
receipt, and `backups/` with the pre-migration copies). A backup is a copy of that folder. Danish bookkeeping law
(bogføringsloven) expects the records to be kept for five years and a backup to be held with a third party, i.e.
somewhere other than the server itself.

### A consistent copy while the app runs

SQLite's online backup produces a copy that is safe to take while the app is writing:

```bash
cd ~/faktura
docker compose exec -T app node -e "require('better-sqlite3')('/data/app.db').backup('/data/app.db.backup').then(()=>process.exit(0))"
tar czf faktura-backup-$(date +%F).tar.gz -C data app.db.backup files backups
rm data/app.db.backup
```

### Nightly off-box copy (cron)

`/etc/cron.d/faktura-backup`, running at 02:30, copying to a remote with rclone (S3, Backblaze B2, a NAS over SFTP,
a Hetzner Storage Box; configure the remote once with `rclone config`):

```cron
30 2 * * * root cd /home/you/faktura && docker compose exec -T app node -e "require('better-sqlite3')('/data/app.db').backup('/data/app.db.backup').then(()=>process.exit(0))" && tar czf /var/backups/faktura-$(date +\%F).tar.gz -C data app.db.backup files backups && rm -f data/app.db.backup && rclone copy /var/backups/ remote:faktura-backups/ --include 'faktura-*.tar.gz' && find /var/backups -name 'faktura-*.tar.gz' -mtime +60 -delete
```

The same with restic (deduplicated, encrypted, with retention handled by restic itself):

```cron
30 2 * * * root cd /home/you/faktura && docker compose exec -T app node -e "require('better-sqlite3')('/data/app.db').backup('/data/app.db.backup').then(()=>process.exit(0))" && restic -r sftp:backup@nas.example.com:/faktura backup data && rm -f data/app.db.backup && restic -r sftp:backup@nas.example.com:/faktura forget --keep-daily 30 --keep-monthly 60 --prune
```

Keep the remote copies for at least five years (the rclone rotation above only prunes the local staging folder).

### Test a restore, regularly

**Restoring from an export zip.** The export under *Eksport* is also a restore format: upload it on the same screen
(or `POST /api/restore`, then `POST /api/restore/{id}` with `{"confirm": true}`), check the summary and confirm. Before
anything is replaced the app copies the current database and files to `data/backups/data.bak01/` (then `02`, …)
together with the zip that was applied, so a restore can itself be undone by restoring the copy. `BODY_SIZE_LIMIT`
(512M in the image and the binaries) caps the upload.

A backup you have never restored is a hope, not a backup. Twice a year:

1. On another machine (or in a temporary folder), `mkdir restore-test && tar xzf faktura-backup-YYYY-MM-DD.tar.gz -C restore-test`.
2. `mv restore-test/app.db.backup restore-test/app.db` (the copy is self-contained; there must be no `-wal`/`-shm`
   files next to it).
3. Start Faktura against it: run the installer with the data directory pointing at `restore-test`, or
   `DATA_DIR=$(pwd)/restore-test APP_PASSWORD=test npm start` from a source checkout.
4. Log in, open **Fakturaer**, confirm the newest invoice number and open one PDF. Then throw the test folder away.

The real restore procedure is the same, done in the live install directory: `docker compose down`, move the old
`data` folder aside, unpack the backup as `data`, rename `app.db.backup` to `app.db` (no `-wal`/`-shm` files next to
it), `docker compose up -d`. Migrations run automatically on start.

---

## 4. Updating

Faktura is updated by rerunning the installer with the same directory (or, equivalently, `docker compose pull &&
docker compose up -d` in the install directory):

```bash
curl -fsSL https://github.com/kvit-app/faktura/releases/latest/download/install.sh | bash
```

On Windows, the same in PowerShell:

```powershell
powershell -ExecutionPolicy Bypass -Command "irm https://github.com/kvit-app/faktura/releases/latest/download/install.ps1 | iex"
```

The installer keeps your `.env` values as defaults (press Enter to keep them; the secrets are never shown), including
the proxy settings from section 2, and restarts the containers on the new image. It rewrites `docker-compose.yml`, so
keep your own adjustments in `.env`, not in that file. On first start the new version applies its database migrations; before it
touches anything it writes a consistent copy of the database to `data/backups/app-<timestamp>-pre-migration-…db`.
Updating never deletes data. If an update ever misbehaves, stop the containers, put the pre-migration copy back as
`data/app.db`, and start the previous image (`FAKTURA_IMAGE=ghcr.io/kvit-app/faktura:<previous version>` in `.env`).

For the standalone binary: download the new binary, replace the old one, start it. It finds the existing
`faktura.config.json`, unpacks its own runtime next to the previous version's and runs the same migration with the
same pre-migration copy.
