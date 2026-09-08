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

Run the installer on the machine that will host Faktura (see the README), then make that machine reachable only
through a private network. No port on the machine is opened to the internet.

### Tailscale

1. Create a free Tailscale account and install Tailscale on the server and on each device you will use:
   <https://tailscale.com/download>.
2. On the server, sign in: `sudo tailscale up`. Note the machine's tailnet address (`tailscale ip -4`, e.g.
   `100.64.0.12`) or its MagicDNS name (e.g. `faktura.tailnet-name.ts.net`).
3. Install Faktura as usual. The installer binds the web app to all interfaces on the port you chose (default 3000),
   but the machine's firewall (below) keeps it off the public interface; Tailscale traffic arrives on the `tailscale0`
   interface and is allowed.
4. From any device on the tailnet, open `http://100.64.0.12:3000` (or the MagicDNS name). Optionally turn on Tailscale
   HTTPS (`tailscale cert`, or `tailscale serve --bg 3000`, which gives you `https://faktura.tailnet-name.ts.net`
   with a real certificate, still tailnet-only).
5. The MCP endpoint is published on `127.0.0.1:3333` only. To use it from another tailnet device, either run the AI
   client on the server itself, or forward it over the tailnet with `tailscale serve --bg --tcp 3333 tcp://127.0.0.1:3333`
   and set `MCP_ALLOWED_HOSTS` accordingly (see `mcp/README.md`). Never publish it on the public interface.

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

Because Caddy adds `X-Forwarded-For`, tell the app to trust it so its own login throttle (five failures, then a
30-second pause, per address) sees the real client address. In the install directory, add to `.env`:

```text
ADDRESS_HEADER=x-forwarded-for
XFF_DEPTH=1
```

and add both variables under `environment:` of the `app` service in `docker-compose.yml`, then `docker compose up -d`.
Also make sure the app's own port is not reachable from outside: bind it to localhost by changing the port mapping to
`"127.0.0.1:3000:3000"`. The MCP service is already bound to `127.0.0.1` and must stay that way; use the VPN for it.

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
- Watch the login log once in a while: `docker compose logs app | grep -i login`.

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

A backup you have never restored is a hope, not a backup. Twice a year:

1. On another machine (or in a temporary folder), `mkdir restore-test && tar xzf faktura-backup-YYYY-MM-DD.tar.gz -C restore-test`.
2. `mv restore-test/app.db.backup restore-test/app.db` (the copy is self-contained; there must be no `-wal`/`-shm`
   files next to it).
3. Start Faktura against it: run the installer with the data directory pointing at `restore-test`, or
   `DATA_DIR=$(pwd)/restore-test APP_PASSWORD=test npm start` from a source checkout.
4. Log in, open **Fakturaer**, confirm the newest invoice number and open one PDF. Then throw the test folder away.

The real restore procedure is the same, done in the live install directory after `docker compose down`
(see the README, section *Gendan*).

---

## 4. Updating

Faktura is updated by rerunning the installer with the same directory (or, equivalently, `docker compose pull &&
docker compose up -d` in the install directory):

```bash
curl -fsSL https://github.com/OWNER/REPO/releases/latest/download/install.sh | bash
```

The installer keeps your `.env` values as defaults (press Enter to keep them; the secrets are never shown) and
restarts the containers on the new image. On first start the new version applies its database migrations; before it
touches anything it writes a consistent copy of the database to `data/backups/app-<timestamp>-pre-migration-…db`.
Updating never deletes data. If an update ever misbehaves, stop the containers, put the pre-migration copy back as
`data/app.db`, and start the previous image (`FAKTURA_IMAGE=ghcr.io/OWNER/faktura:<previous version>` in `.env`).

For the standalone binary: download the new binary, replace the old one, start it. It finds the existing
`faktura.config.json`, unpacks its own runtime next to the previous version's and runs the same migration with the
same pre-migration copy.
