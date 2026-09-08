<#
.SYNOPSIS
  Faktura installer (Windows). Wraps Docker Desktop.

.DESCRIPTION
  Run:   powershell -ExecutionPolicy Bypass -File install.ps1
  Idempotent: rerunning with the same directory keeps your data and only updates the
  configuration and the image. Updating never deletes data: the app copies the database to
  <dir>\data\backups\ before any schema migration.

  Non-interactive use: set FAKTURA_NONINTERACTIVE=1 and FAKTURA_DIR, FAKTURA_PORT,
  APP_PASSWORD, API_TOKEN (or API_TOKEN=generate) in the environment. Optional, kept across
  reruns once in .env: FAKTURA_MCP_PORT (3333), FAKTURA_BIND (0.0.0.0), ADDRESS_HEADER, XFF_DEPTH, MCP_ALLOWED_HOSTS,
  FAKTURA_IMAGE.

  Optional HTTPS (fifth question, default none), also kept across reruns:
    FAKTURA_TLS=local      Caddy in compose with its own certificate authority for FAKTURA_DOMAIN
                           (default kvit.localhost) on FAKTURA_TLS_PORT (443) and, for MCP, on
                           FAKTURA_MCP_TLS_PORT (8443, localhost only). The root certificate is copied to
                           <dir>\kvit-root-ca.crt. FAKTURA_TRUST_LOCAL=1 also adds the hosts entry (needs an
                           elevated PowerShell) and imports the certificate into the current user's trusted roots.
    FAKTURA_TLS=tailscale  `tailscale serve` publishes the app on https://<machine>.<tailnet>.ts.net (port 443) and
                           the MCP endpoint on port 8443 with a real certificate, reachable from your tailnet only.
                           Requires Tailscale with HTTPS enabled.
#>
$ErrorActionPreference = 'Stop'

$DefaultImage = '__IMAGE__'
if ($DefaultImage -eq ('__IMAGE' + '__')) { $DefaultImage = 'ghcr.io/kvit-app/faktura:latest' }
$CaddyImage = 'caddy:2-alpine'
$NonInteractive = $env:FAKTURA_NONINTERACTIVE -eq '1'

function Line { Write-Host ''; Write-Host ('-' * 60) }
function Fail($msg) { Write-Host "Error: $msg" -ForegroundColor Red; exit 1 }
function Warn($msg) { Write-Host "Warning: $msg" -ForegroundColor Yellow }

# Native commands: run through cmd so Windows PowerShell 5.1 never turns stderr into a terminating error.
function Native($cmdline) {
  $prev = $ErrorActionPreference; $ErrorActionPreference = 'Continue'
  try { cmd /c "$cmdline" | Out-Host; return $LASTEXITCODE } finally { $ErrorActionPreference = $prev }
}
# Same, but returns stdout as a string (stderr discarded).
function NativeOut($cmdline) {
  $prev = $ErrorActionPreference; $ErrorActionPreference = 'Continue'
  try { return (cmd /c "$cmdline 2>nul" | Out-String) } finally { $ErrorActionPreference = $prev }
}

function Ask($name, $question, $default) {
  if ($NonInteractive) {
    $v = [Environment]::GetEnvironmentVariable($name)
    if ([string]::IsNullOrEmpty($v)) { return $default } else { return $v }
  }
  $v = Read-Host "$question [$default]"
  if ([string]::IsNullOrEmpty($v)) { return $default } else { return $v }
}

function AskSecret($name, $question, $keepCurrent) {
  # Hidden input; the value is never written to the console or a log.
  if ($NonInteractive) { return [Environment]::GetEnvironmentVariable($name) }
  $prompt = if ($keepCurrent) { "$question [Enter = keep current]" } else { $question }
  $secure = Read-Host -AsSecureString $prompt
  $bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
  try { return [Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr) } finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr) }
}

function AskYesNo($name, $question) {
  # Default no. Non-interactive: the environment variable set to 1 means yes.
  if ($NonInteractive) { return ([Environment]::GetEnvironmentVariable($name) -eq '1') }
  $v = Read-Host "$question [y/N]"
  return ($v -match '^(y|yes)$')
}

function NewSecret {
  $bytes = New-Object byte[] 24
  [Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
  return (($bytes | ForEach-Object { $_.ToString('x2') }) -join '')
}

# .env values are single-quoted so compose takes them literally ($, #, spaces and " are safe). Compose's escaping inside
# single quotes differs from the shell's, so ' and \ are not allowed in secrets (checked below).
function EnvQuote($v) { return "'" + $v + "'" }
function EnvRead($key, $file) {
  $v = ''
  foreach ($l in Get-Content $file) { if ($l -match "^$key=(.*)$") { $v = $Matches[1] } }
  if ($v.Length -ge 2 -and $v.StartsWith("'") -and $v.EndsWith("'")) { return $v.Substring(1, $v.Length - 2) }
  if ($v.Length -ge 2 -and $v.StartsWith('"') -and $v.EndsWith('"')) { return $v.Substring(1, $v.Length - 2) }
  return $v
}

function FindTailscale {
  if ($env:FAKTURA_TAILSCALE_BIN) { if (Test-Path $env:FAKTURA_TAILSCALE_BIN) { return $env:FAKTURA_TAILSCALE_BIN } else { return $null } }
  $c = Get-Command tailscale -ErrorAction SilentlyContinue
  if ($c) { return $c.Source }
  $p = Join-Path $env:ProgramFiles 'Tailscale\tailscale.exe'
  if (Test-Path $p) { return $p }
  return $null
}

function IsAdmin {
  return ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
}

# ---------------------------------------------------------------- 1. Docker
if (-not (Get-Command docker -ErrorAction SilentlyContinue)) {
  Fail "Docker was not found. Install Docker Desktop first: https://docs.docker.com/desktop/install/windows-install/"
}
if ((Native 'docker compose version >nul 2>&1') -ne 0) { Fail "The 'docker compose' plugin is missing; it ships with Docker Desktop." }
if ((Native 'docker info >nul 2>&1') -ne 0) { Fail 'Docker Desktop is installed but not running. Start it and try again.' }

Line
Write-Host 'Faktura - installation'
if ($NonInteractive) { Write-Host 'Non-interactive mode: answers taken from the environment.' } else { Write-Host 'Four questions plus an optional HTTPS choice. Enter keeps the value in brackets.' }
Line

# ---------------------------------------------------------------- 2. Questions
$defaultDir = if ($env:FAKTURA_DIR) { $env:FAKTURA_DIR } else { Join-Path $HOME 'faktura' }
$Dir = Ask 'FAKTURA_DIR' 'Directory for configuration and data' $defaultDir
if ($Dir.StartsWith('~')) { $Dir = $HOME + $Dir.Substring(1) }
$Dir = [IO.Path]::GetFullPath($Dir)
New-Item -ItemType Directory -Force (Join-Path $Dir 'data\backups') | Out-Null
$EnvFile = Join-Path $Dir '.env'
$ComposeFile = Join-Path $Dir 'docker-compose.yml'
$Caddyfile = Join-Path $Dir 'Caddyfile'
$CaFile = Join-Path $Dir 'kvit-root-ca.crt'

$curPort = ''; $curPassword = ''; $curToken = ''; $curMcpPort = ''; $curBind = ''; $curAddrHeader = ''; $curXff = ''; $curImage = ''; $curMcpHosts = ''
$curTls = ''; $curDomain = ''; $curTlsPort = ''; $curMcpTlsPort = ''
if (Test-Path $EnvFile) {
  $curMcpHosts = EnvRead 'MCP_ALLOWED_HOSTS' $EnvFile
  $curPort = EnvRead 'FAKTURA_PORT' $EnvFile
  $curPassword = EnvRead 'APP_PASSWORD' $EnvFile
  $curToken = EnvRead 'API_TOKEN' $EnvFile
  $curMcpPort = EnvRead 'FAKTURA_MCP_PORT' $EnvFile
  $curBind = EnvRead 'FAKTURA_BIND' $EnvFile
  $curAddrHeader = EnvRead 'ADDRESS_HEADER' $EnvFile
  $curXff = EnvRead 'XFF_DEPTH' $EnvFile
  $curImage = EnvRead 'FAKTURA_IMAGE' $EnvFile
  $curTls = EnvRead 'FAKTURA_TLS' $EnvFile
  $curDomain = EnvRead 'FAKTURA_DOMAIN' $EnvFile
  $curTlsPort = EnvRead 'FAKTURA_TLS_PORT' $EnvFile
  $curMcpTlsPort = EnvRead 'FAKTURA_MCP_TLS_PORT' $EnvFile
  Write-Host "Existing installation found in $Dir - this run updates it; data is kept."
}
$Image = if ($env:FAKTURA_IMAGE) { $env:FAKTURA_IMAGE } elseif ($curImage) { $curImage } else { $DefaultImage }

$portDefault = if ($env:FAKTURA_PORT) { $env:FAKTURA_PORT } elseif ($curPort) { $curPort } else { '3000' }
$Port = Ask 'FAKTURA_PORT' 'Port for the web app' $portDefault
if ($Port -notmatch '^\d+$') { Fail 'Port must be a number' }

while ($true) {
  $Password = AskSecret 'APP_PASSWORD' 'App password (the one login; at least 8 characters)' ([bool]$curPassword)
  if ([string]::IsNullOrEmpty($Password)) { $Password = $curPassword }
  if ($Password.Length -ge 8) { break }
  if ($NonInteractive) { Fail 'APP_PASSWORD must be at least 8 characters' }
  Write-Host 'At least 8 characters, please.'
}
if ($Password -match "[`r`n]") { Fail 'The password cannot contain a line break' }
if ($Password -match "['\\]") { Fail "The password cannot contain ' or \ (every other character is fine)" }

$Token = AskSecret 'API_TOKEN' 'API token for AI/MCP access (Enter = generate one)' ([bool]$curToken)
$TokenGenerated = $false
if ([string]::IsNullOrEmpty($Token)) { $Token = if ($curToken) { $curToken } else { 'generate' } }
if ($Token -eq 'generate') { $Token = NewSecret; $TokenGenerated = $true }
if ($Token.Length -lt 16) { Fail 'API_TOKEN must be at least 16 characters' }
if ($Token -match "[\s'`"]") { Fail 'The API token cannot contain spaces or quotes' }

$McpPort = if ($env:FAKTURA_MCP_PORT) { $env:FAKTURA_MCP_PORT } elseif ($curMcpPort) { $curMcpPort } else { '3333' }
$Bind = if ($env:FAKTURA_BIND) { $env:FAKTURA_BIND } elseif ($curBind) { $curBind } else { '0.0.0.0' }
$AddrHeader = if ($env:ADDRESS_HEADER) { $env:ADDRESS_HEADER } elseif ($curAddrHeader) { $curAddrHeader } else { '' }
$Xff = if ($env:XFF_DEPTH) { $env:XFF_DEPTH } elseif ($curXff) { $curXff } else { '1' }
$McpHosts = if ($env:MCP_ALLOWED_HOSTS) { $env:MCP_ALLOWED_HOSTS } elseif ($curMcpHosts) { $curMcpHosts } else { '' }
$HostForUrl = if ($Bind -eq '0.0.0.0' -or $Bind -eq '' -or $Bind -eq '::') { 'localhost' } else { $Bind }

# ---------------------------------------------------------------- 2b. HTTPS (optional)
$tlsDefault = if ($env:FAKTURA_TLS) { $env:FAKTURA_TLS } elseif ($curTls) { $curTls } else { 'none' }
$Tls = (Ask 'FAKTURA_TLS' 'HTTPS: none, local (own certificate for a local domain) or tailscale (tailnet certificate)' $tlsDefault).ToLowerInvariant()
if ($Tls -notin @('none', 'local', 'tailscale')) { Fail "FAKTURA_TLS must be none, local or tailscale (got `"$Tls`")" }
$Domain = ''; $TlsPort = ''; $McpTlsPort = ''; $Ts = $null
if ($Tls -eq 'local') {
  $domainDefault = if ($env:FAKTURA_DOMAIN) { $env:FAKTURA_DOMAIN } elseif ($curDomain) { $curDomain } else { 'kvit.localhost' }
  $Domain = (Ask 'FAKTURA_DOMAIN' 'Local domain name for the certificate' $domainDefault).ToLowerInvariant()
  if ($Domain -notmatch '^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*$') { Fail 'The domain may only contain letters, digits, dots and dashes' }
  $tlsPortDefault = if ($env:FAKTURA_TLS_PORT) { $env:FAKTURA_TLS_PORT } elseif ($curTlsPort) { $curTlsPort } else { '443' }
  $TlsPort = Ask 'FAKTURA_TLS_PORT' 'HTTPS port for the web app' $tlsPortDefault
  $mcpTlsPortDefault = if ($env:FAKTURA_MCP_TLS_PORT) { $env:FAKTURA_MCP_TLS_PORT } elseif ($curMcpTlsPort) { $curMcpTlsPort } else { '8443' }
  $McpTlsPort = Ask 'FAKTURA_MCP_TLS_PORT' 'HTTPS port for the MCP endpoint (localhost only)' $mcpTlsPortDefault
  if ($TlsPort -notmatch '^\d+$' -or $McpTlsPort -notmatch '^\d+$') { Fail 'HTTPS ports must be numbers' }
  if ($TlsPort -eq $McpTlsPort) { Fail 'The two HTTPS ports must differ' }
} elseif ($Tls -eq 'tailscale') {
  $Ts = FindTailscale
  if (-not $Ts) { Fail 'FAKTURA_TLS=tailscale needs the Tailscale CLI on this machine (https://tailscale.com/download). Nothing was changed.' }
  $statusJson = NativeOut "`"$Ts`" status --json"
  try { $Domain = ([string](ConvertFrom-Json $statusJson).Self.DNSName).TrimEnd('.') } catch { $Domain = '' }
  if (-not $Domain) { Fail "Tailscale is installed but not connected, or MagicDNS is off. Sign in, enable MagicDNS and HTTPS in the admin console (DNS page), then rerun. Nothing was changed." }
  $TlsPort = if ($env:FAKTURA_TLS_PORT) { $env:FAKTURA_TLS_PORT } elseif ($curTlsPort) { $curTlsPort } else { '443' }
  $McpTlsPort = if ($env:FAKTURA_MCP_TLS_PORT) { $env:FAKTURA_MCP_TLS_PORT } elseif ($curMcpTlsPort) { $curMcpTlsPort } else { '8443' }
  foreach ($p in @($TlsPort, $McpTlsPort)) { if ($p -notin @('443', '8443', '10000')) { Fail "Tailscale serve only offers HTTPS on ports 443, 8443 and 10000 (got $p)" } }
  if ($TlsPort -eq $McpTlsPort) { Fail 'The two HTTPS ports must differ' }
}
# Host names the MCP endpoint may be addressed as through the TLS proxy (its DNS-rebinding check is strict).
$McpTlsHosts = if ($Domain) { "${Domain}:${McpTlsPort},$Domain" } else { '' }
if (-not $TlsPort) { $TlsPort = '443' }
if (-not $McpTlsPort) { $McpTlsPort = '8443' }

# ---------------------------------------------------------------- 3. Write config (secrets only in .env)
$envText = @(
  '# Faktura configuration. Keep this file private: it holds the login password and the API token.',
  '# Values are single-quoted so $ and # inside them are taken literally.',
  "APP_PASSWORD=$(EnvQuote $Password)",
  "API_TOKEN=$(EnvQuote $Token)",
  "FAKTURA_PORT=$Port",
  "FAKTURA_MCP_PORT=$McpPort",
  "FAKTURA_BIND=$Bind",
  "ADDRESS_HEADER=$(EnvQuote $AddrHeader)",
  "XFF_DEPTH=$Xff",
  "MCP_ALLOWED_HOSTS=$(EnvQuote $McpHosts)",
  "FAKTURA_IMAGE=$(EnvQuote $Image)",
  '# HTTPS: none, local or tailscale (see the installer header). MCP_TLS_HOSTS is derived; do not edit.',
  "FAKTURA_TLS=$Tls",
  "FAKTURA_DOMAIN=$(EnvQuote $Domain)",
  "FAKTURA_TLS_PORT=$TlsPort",
  "FAKTURA_MCP_TLS_PORT=$McpTlsPort",
  "MCP_TLS_HOSTS=$(EnvQuote $McpTlsHosts)"
) -join "`n"
[IO.File]::WriteAllText($EnvFile, $envText + "`n", (New-Object Text.UTF8Encoding $false))
# Restrict the file to the current user; warn (do not hide it) if that fails.
$me = [Security.Principal.WindowsIdentity]::GetCurrent().Name
if ((Native "icacls `"$EnvFile`" /inheritance:r /grant:r `"$me`:(F)`" >nul 2>&1") -ne 0) {
  Warn "could not restrict permissions on $EnvFile; check them by hand."
}

$compose = @'
# Written by install.ps1. Rerun the installer to change settings. Everything adjustable lives in .env
# (FAKTURA_BIND, ADDRESS_HEADER, XFF_DEPTH, MCP_ALLOWED_HOSTS, FAKTURA_TLS, ports, image); this file is rewritten on every run.
# The compose project is named after this directory, so two installs in different directories coexist.
services:
  app:
    image: ${FAKTURA_IMAGE}
    restart: unless-stopped
    ports:
      - "${FAKTURA_BIND}:${FAKTURA_PORT}:3000"
    environment:
      APP_PASSWORD: ${APP_PASSWORD}
      API_TOKEN: ${API_TOKEN}
      ADDRESS_HEADER: ${ADDRESS_HEADER}
      XFF_DEPTH: ${XFF_DEPTH}
      TZ: Europe/Copenhagen
    volumes:
      # The only state: the SQLite database and all PDFs/receipts. Back up this folder.
      - ./data:/data
    healthcheck:
      test: ["CMD", "node", "-e", "fetch('http://127.0.0.1:3000/healthz').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"]
      interval: 30s
      timeout: 5s
      start_period: 20s

  # AI access (MCP over HTTP). Published on localhost only: reach it through your VPN, never the open internet.
  mcp:
    image: ${FAKTURA_IMAGE}
    restart: unless-stopped
    command: ["node", "mcp/dist/http.js"]
    depends_on:
      app:
        condition: service_healthy
    ports:
      - "127.0.0.1:${FAKTURA_MCP_PORT}:3333"
    environment:
      FAKTURA_URL: http://app:3000
      FAKTURA_API_TOKEN: ${API_TOKEN}
      MCP_HOST: 0.0.0.0
      MCP_PORT: "3333"
      MCP_ALLOWED_HOSTS: localhost:${FAKTURA_MCP_PORT},127.0.0.1:${FAKTURA_MCP_PORT}${MCP_TLS_HOSTS:+,}${MCP_TLS_HOSTS:-}${MCP_ALLOWED_HOSTS:+,}${MCP_ALLOWED_HOSTS:-}
    healthcheck:
      test: ["CMD", "node", "-e", "fetch('http://127.0.0.1:3333/healthz').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"]
      interval: 30s
      timeout: 5s
      start_period: 10s
'@
if ($Tls -eq 'local') {
  $compose += @"


  # HTTPS with Caddy's own certificate authority (FAKTURA_TLS=local). The root certificate is copied to
  # kvit-root-ca.crt next to this file; trust it on every device that should open https://$Domain.
  # The MCP port stays on localhost, exactly like the plain one above.
  caddy:
    image: $CaddyImage
    restart: unless-stopped
    depends_on:
      - app
      - mcp
    ports:
      - "`${FAKTURA_BIND}:`${FAKTURA_TLS_PORT}:`${FAKTURA_TLS_PORT}"
      - "127.0.0.1:`${FAKTURA_MCP_TLS_PORT}:`${FAKTURA_MCP_TLS_PORT}"
    environment:
      FAKTURA_DOMAIN: `${FAKTURA_DOMAIN}
      FAKTURA_TLS_PORT: `${FAKTURA_TLS_PORT}
      FAKTURA_MCP_TLS_PORT: `${FAKTURA_MCP_TLS_PORT}
    volumes:
      - ./Caddyfile:/etc/caddy/Caddyfile:ro
      - ./caddy:/data
"@
  $caddyText = @'
# Written by install.ps1 for FAKTURA_TLS=local. Certificates come from Caddy's internal CA (root in ./caddy/pki/,
# copied to ./kvit-root-ca.crt). Host headers pass through unchanged, which the app's CSRF check and the MCP
# endpoint's host check both rely on.
{
	skip_install_trust
	auto_https disable_redirects
}

https://{$FAKTURA_DOMAIN}:{$FAKTURA_TLS_PORT} {
	tls internal
	encode zstd gzip
	reverse_proxy app:3000
}

https://{$FAKTURA_DOMAIN}:{$FAKTURA_MCP_TLS_PORT} {
	tls internal
	reverse_proxy mcp:3333
}
'@
  [IO.File]::WriteAllText($Caddyfile, $caddyText.Replace("`r`n", "`n") + "`n", (New-Object Text.UTF8Encoding $false))
} elseif (Test-Path $Caddyfile) {
  Remove-Item $Caddyfile -Force
}
[IO.File]::WriteAllText($ComposeFile, $compose.Replace("`r`n", "`n") + "`n", (New-Object Text.UTF8Encoding $false))

# Compose lets the process environment override .env. Anything the caller passed in (API_TOKEN=generate, an
# upper-case FAKTURA_TLS, ...) must therefore be replaced by the values just written, or the containers see the input
# instead of the result.
$env:APP_PASSWORD = $Password; $env:API_TOKEN = $Token; $env:FAKTURA_PORT = $Port; $env:FAKTURA_MCP_PORT = $McpPort
$env:FAKTURA_BIND = $Bind; $env:ADDRESS_HEADER = $AddrHeader; $env:XFF_DEPTH = $Xff; $env:MCP_ALLOWED_HOSTS = $McpHosts
$env:FAKTURA_IMAGE = $Image; $env:FAKTURA_TLS = $Tls; $env:FAKTURA_DOMAIN = $Domain; $env:FAKTURA_TLS_PORT = $TlsPort
$env:FAKTURA_MCP_TLS_PORT = $McpTlsPort; $env:MCP_TLS_HOSTS = $McpTlsHosts

# ---------------------------------------------------------------- 4. Pull and start
Line
Write-Host "Starting Faktura ($Image) on port $Port ..."
Push-Location $Dir
try {
  if ((Native 'docker compose pull --quiet >nul 2>&1') -ne 0) {
    if ((Native "docker image inspect `"$Image`" >nul 2>&1") -ne 0) { Fail "Could not pull $Image and no local copy exists. Check your network or FAKTURA_IMAGE." }
    Write-Host "Could not pull $Image; using the local copy."
  }
  if ((Native 'docker compose up -d --remove-orphans') -ne 0) { Fail 'docker compose up failed' }
} finally { Pop-Location }

# ---------------------------------------------------------------- 5. Health check
$Url = "http://${HostForUrl}:$Port"
$ok = $false
for ($i = 0; $i -lt 60 -and -not $ok; $i++) {
  try { $r = Invoke-WebRequest -UseBasicParsing -Uri "$Url/healthz" -TimeoutSec 3; if ($r.StatusCode -eq 200) { $ok = $true } } catch { Start-Sleep -Seconds 1 }
}
if (-not $ok) { Fail "The app did not answer on $Url/healthz within 60 s. Logs: docker compose -f `"$ComposeFile`" logs" }

# ---------------------------------------------------------------- 5b. HTTPS setup
$TlsUrl = ''; $McpUrl = "http://localhost:$McpPort/mcp"; $TrustLocal = $false; $TrustDone = $false
$curlExe = (Get-Command curl.exe -ErrorAction SilentlyContinue).Source
if ($Tls -eq 'local') {
  $TlsUrl = "https://${Domain}:$TlsPort"; $McpUrl = "https://${Domain}:$McpTlsPort/mcp"
  Write-Host 'Waiting for the local certificate authority ...'
  $ok = $false
  Push-Location $Dir
  try {
    for ($i = 0; $i -lt 30 -and -not $ok; $i++) {
      # Read through exec rather than cp: no host path handling involved.
      $pem = NativeOut 'docker compose exec -T caddy cat /data/caddy/pki/authorities/local/root.crt'
      if ($pem -match 'BEGIN CERTIFICATE') { [IO.File]::WriteAllText($CaFile, $pem.Replace("`r`n", "`n").Trim() + "`n", (New-Object Text.UTF8Encoding $false)); $ok = $true } else { Start-Sleep -Seconds 1 }
    }
  } finally { Pop-Location }
  if (-not $ok) { Fail "Caddy did not produce a root certificate within 30 s. Logs: docker compose -f `"$ComposeFile`" logs caddy" }
  if ($curlExe) {
    $ok = $false
    for ($i = 0; $i -lt 30 -and -not $ok; $i++) {
      # --ssl-revoke-best-effort: Windows curl (schannel) otherwise refuses a root that publishes no revocation list.
      if ((Native "`"$curlExe`" -fsS --ssl-revoke-best-effort --cacert `"$CaFile`" --resolve ${Domain}:${TlsPort}:127.0.0.1 $TlsUrl/healthz >nul 2>&1") -eq 0) { $ok = $true } else { Start-Sleep -Seconds 1 }
    }
    if (-not $ok) { Fail "The app did not answer over HTTPS on $TlsUrl within 30 s. Is port $TlsPort free? Logs: docker compose -f `"$ComposeFile`" logs caddy" }
  }

  $TrustLocal = AskYesNo 'FAKTURA_TRUST_LOCAL' "Add '127.0.0.1 $Domain' to the hosts file and trust the certificate for the current user now?"
  if ($TrustLocal) {
    $hostsFile = Join-Path $env:SystemRoot 'System32\drivers\etc\hosts'
    $hasEntry = (Get-Content $hostsFile -ErrorAction SilentlyContinue) | Where-Object { $_ -match "^[^#]*\s$([regex]::Escape($Domain))(\s|$)" }
    if ($hasEntry) {
      Write-Host "The hosts file already has $Domain."
    } elseif (IsAdmin) {
      Add-Content -Path $hostsFile -Value "127.0.0.1 $Domain"
      Write-Host "Added 127.0.0.1 $Domain to the hosts file."
    } else {
      Warn "not running as administrator, so the hosts file was not changed. Add this line to $hostsFile yourself:  127.0.0.1 $Domain"
    }
    # Current user's trusted roots: no administrator needed; Windows shows one confirmation dialog.
    if ((Native "certutil -user -addstore Root `"$CaFile`" >nul 2>&1") -eq 0) {
      $TrustDone = $true
      Write-Host 'The certificate is trusted for the current user (browsers, Claude Desktop). Restart open browsers.'
    } else {
      Warn "could not import the certificate; import $CaFile as a trusted root by hand (double-click it)."
    }
  }
} elseif ($Tls -eq 'tailscale') {
  $TlsUrl = if ($TlsPort -eq '443') { "https://$Domain" } else { "https://${Domain}:$TlsPort" }
  $McpUrl = "https://${Domain}:$McpTlsPort/mcp"
  Write-Host 'Publishing on your tailnet with tailscale serve ...'
  if ((Native "`"$Ts`" serve --bg --https=$TlsPort http://127.0.0.1:$Port >nul") -ne 0) {
    Fail "tailscale serve failed for the app. HTTPS certificates must be enabled for the tailnet (admin console > DNS > HTTPS Certificates). Faktura itself is running on $Url."
  }
  if ((Native "`"$Ts`" serve --bg --https=$McpTlsPort http://127.0.0.1:$McpPort >nul") -ne 0) {
    Fail "tailscale serve failed for the MCP endpoint (port $McpTlsPort). The app is published on $TlsUrl."
  }
  $ok = $false
  for ($i = 0; $i -lt 60 -and -not $ok; $i++) {
    try { $r = Invoke-WebRequest -UseBasicParsing -Uri "$TlsUrl/healthz" -TimeoutSec 3; if ($r.StatusCode -eq 200) { $ok = $true } } catch { Start-Sleep -Seconds 1 }
  }
  if (-not $ok) { Warn "$TlsUrl/healthz did not answer yet; the first certificate can take a minute. Check 'tailscale serve status'." }
}
# Switching away from tailscale: take the old mounts down again (best effort).
if ($curTls -eq 'tailscale' -and $Tls -ne 'tailscale') {
  $tsOld = FindTailscale
  if ($tsOld) {
    $oldPort = if ($curTlsPort) { $curTlsPort } else { '443' }
    $oldMcpPort = if ($curMcpTlsPort) { $curMcpTlsPort } else { '8443' }
    Native "`"$tsOld`" serve --https=$oldPort off >nul 2>&1" | Out-Null
    Native "`"$tsOld`" serve --https=$oldMcpPort off >nul 2>&1" | Out-Null
  }
}

# ---------------------------------------------------------------- 6. Summary (secrets stay in .env)
Line
Write-Host 'Faktura is running.'
Write-Host ''
Write-Host "  Open:        $Url"
if ($TlsUrl) { Write-Host "  HTTPS:       $TlsUrl" }
Write-Host '  Log in with: the app password you chose'
Write-Host "  Data:        $(Join-Path $Dir 'data')   (app.db + files\ - back this folder up)"
Write-Host "  Config:      $EnvFile  (private; holds the secrets)"
Write-Host ''
switch ($Tls) {
  'local' {
    Write-Host "HTTPS uses a certificate authority created on this machine. Its root certificate is $CaFile."
    if (-not $TrustLocal -or -not $TrustDone) {
      Write-Host "To make browsers and Claude Desktop accept it: add '127.0.0.1 $Domain' to the hosts file and import that file as a"
      Write-Host 'trusted root (rerun the installer from an elevated PowerShell and answer yes to do both), or copy it to another device.'
    }
    Write-Host "Claude Code (Node) does not read the Windows store: start it with NODE_EXTRA_CA_CERTS=$CaFile"
    Write-Host ''
    Write-Host "AI / MCP access - the MCP endpoint is on this machine only: $McpUrl (also http://localhost:$McpPort/mcp)."
  }
  'tailscale' {
    Write-Host 'HTTPS is served by Tailscale with a real certificate, reachable from devices on your tailnet only.'
    Write-Host "'tailscale serve status' shows the mounts; 'tailscale serve --https=$TlsPort off' removes one."
    Write-Host ''
    Write-Host "AI / MCP access - the MCP endpoint is reachable from every device on your tailnet: $McpUrl"
    Write-Host '(it has no login of its own: whoever is on the tailnet can use every tool, including the write tools).'
  }
  default {
    Write-Host "AI / MCP access - the MCP server runs alongside the app on this machine only (localhost:$McpPort)."
  }
}
Write-Host 'Put this in your MCP client config (Claude Code, Claude Desktop, ...):'
Write-Host ''
Write-Host "  { `"mcpServers`": { `"kvit`": { `"type`": `"http`", `"url`": `"$McpUrl`" } } }"
Write-Host ''
Write-Host 'For a client that only speaks stdio, this runs the MCP server inside the app container (the token is read'
Write-Host 'from the container''s own environment, so it appears nowhere in your client config):'
Write-Host ''
$composePath = $ComposeFile.Replace('\', '/')
Write-Host "  { `"mcpServers`": { `"kvit`": { `"command`": `"docker`", `"args`": [`"compose`", `"-f`", `"$composePath`", `"exec`", `"-i`", `"-T`","
Write-Host "      `"-e`", `"FAKTURA_URL=http://127.0.0.1:3000`", `"app`", `"sh`", `"-c`", `"FAKTURA_API_TOKEN=`$API_TOKEN exec node mcp/dist/stdio.js`"] } } }"
Write-Host ''
if ($TokenGenerated -and -not $NonInteractive) {
  Write-Host "A new API token was generated and stored in $EnvFile (open that file if a client ever needs it)."
  Write-Host ''
}
Write-Host 'Update later: rerun this installer with the same directory. Your data is kept, and the database is copied'
Write-Host "to $(Join-Path $Dir 'data\backups') before any schema change."
Line
