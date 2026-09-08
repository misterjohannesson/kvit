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
  reruns once in .env: FAKTURA_MCP_PORT (3333), FAKTURA_BIND (0.0.0.0), ADDRESS_HEADER, XFF_DEPTH, FAKTURA_IMAGE.
#>
$ErrorActionPreference = 'Stop'

$DefaultImage = '__IMAGE__'
if ($DefaultImage -eq ('__IMAGE' + '__')) { $DefaultImage = 'ghcr.io/kvit-app/faktura:latest' }
$NonInteractive = $env:FAKTURA_NONINTERACTIVE -eq '1'

function Line { Write-Host ''; Write-Host ('-' * 60) }
function Fail($msg) { Write-Host "Error: $msg" -ForegroundColor Red; exit 1 }

# Native commands: run through cmd so Windows PowerShell 5.1 never turns stderr into a terminating error.
function Native($cmdline) {
  $prev = $ErrorActionPreference; $ErrorActionPreference = 'Continue'
  try { cmd /c "$cmdline" | Out-Host; return $LASTEXITCODE } finally { $ErrorActionPreference = $prev }
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

# ---------------------------------------------------------------- 1. Docker
if (-not (Get-Command docker -ErrorAction SilentlyContinue)) {
  Fail "Docker was not found. Install Docker Desktop first: https://docs.docker.com/desktop/install/windows-install/"
}
if ((Native 'docker compose version >nul 2>&1') -ne 0) { Fail "The 'docker compose' plugin is missing; it ships with Docker Desktop." }
if ((Native 'docker info >nul 2>&1') -ne 0) { Fail 'Docker Desktop is installed but not running. Start it and try again.' }

Line
Write-Host 'Faktura - installation'
if ($NonInteractive) { Write-Host 'Non-interactive mode: answers taken from the environment.' } else { Write-Host 'Four questions. Enter keeps the value in brackets.' }
Line

# ---------------------------------------------------------------- 2. Questions
$defaultDir = if ($env:FAKTURA_DIR) { $env:FAKTURA_DIR } else { Join-Path $HOME 'faktura' }
$Dir = Ask 'FAKTURA_DIR' 'Directory for configuration and data' $defaultDir
if ($Dir.StartsWith('~')) { $Dir = $HOME + $Dir.Substring(1) }
$Dir = [IO.Path]::GetFullPath($Dir)
New-Item -ItemType Directory -Force (Join-Path $Dir 'data\backups') | Out-Null
$EnvFile = Join-Path $Dir '.env'
$ComposeFile = Join-Path $Dir 'docker-compose.yml'

$curPort = ''; $curPassword = ''; $curToken = ''; $curMcpPort = ''; $curBind = ''; $curAddrHeader = ''; $curXff = ''; $curImage = ''; $curMcpHosts = ''
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
  "FAKTURA_IMAGE=$(EnvQuote $Image)"
) -join "`n"
[IO.File]::WriteAllText($EnvFile, $envText + "`n", (New-Object Text.UTF8Encoding $false))
# Restrict the file to the current user; warn (do not hide it) if that fails.
$me = [Security.Principal.WindowsIdentity]::GetCurrent().Name
if ((Native "icacls `"$EnvFile`" /inheritance:r /grant:r `"$me`:(F)`" >nul 2>&1") -ne 0) {
  Write-Host "Warning: could not restrict permissions on $EnvFile; check them by hand." -ForegroundColor Yellow
}

$compose = @'
# Written by install.ps1. Rerun the installer to change settings. Everything adjustable lives in .env
# (FAKTURA_BIND, ADDRESS_HEADER, XFF_DEPTH, MCP_ALLOWED_HOSTS, ports, image); this file is rewritten on every run.
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
      MCP_ALLOWED_HOSTS: localhost:${FAKTURA_MCP_PORT},127.0.0.1:${FAKTURA_MCP_PORT}${MCP_ALLOWED_HOSTS:+,}${MCP_ALLOWED_HOSTS:-}
    healthcheck:
      test: ["CMD", "node", "-e", "fetch('http://127.0.0.1:3333/healthz').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"]
      interval: 30s
      timeout: 5s
      start_period: 10s
'@
[IO.File]::WriteAllText($ComposeFile, $compose.Replace("`r`n", "`n") + "`n", (New-Object Text.UTF8Encoding $false))

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

# ---------------------------------------------------------------- 6. Summary (secrets stay in .env)
Line
Write-Host 'Faktura is running.'
Write-Host ''
Write-Host "  Open:        $Url"
Write-Host '  Log in with: the app password you chose'
Write-Host "  Data:        $(Join-Path $Dir 'data')   (app.db + files\ - back this folder up)"
Write-Host "  Config:      $EnvFile  (private; holds the secrets)"
Write-Host ''
Write-Host "AI / MCP access - the MCP server runs alongside the app on this machine only (localhost:$McpPort)."
Write-Host 'Put this in your MCP client config (Claude Code, Claude Desktop, ...):'
Write-Host ''
Write-Host "  { `"mcpServers`": { `"kvit`": { `"type`": `"http`", `"url`": `"http://localhost:$McpPort/mcp`" } } }"
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
