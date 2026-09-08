<#
.SYNOPSIS
  Faktura installer (Windows). Wraps Docker Desktop.

.DESCRIPTION
  Run:   powershell -ExecutionPolicy Bypass -File install.ps1
  Idempotent: rerunning with the same directory keeps your data and only updates the
  configuration and the image. Updating never deletes data: the app copies the database to
  <dir>\data\backups\ before any schema migration.

  Non-interactive use: set FAKTURA_NONINTERACTIVE=1 and FAKTURA_DIR, FAKTURA_PORT,
  APP_PASSWORD, API_TOKEN (or API_TOKEN=generate) in the environment.
#>
$ErrorActionPreference = 'Stop'

$Image = if ($env:FAKTURA_IMAGE) { $env:FAKTURA_IMAGE } else { '__IMAGE__' }
if ($Image.StartsWith('__IMAGE__')) { $Image = 'ghcr.io/kvit-app/faktura:latest' }
$NonInteractive = $env:FAKTURA_NONINTERACTIVE -eq '1'

function Line { Write-Host ''; Write-Host ('-' * 60) }
function Fail($msg) { Write-Host "Error: $msg" -ForegroundColor Red; exit 1 }

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

# ---------------------------------------------------------------- 1. Docker
if (-not (Get-Command docker -ErrorAction SilentlyContinue)) {
  Fail "Docker was not found. Install Docker Desktop first: https://docs.docker.com/desktop/install/windows-install/"
}
try { docker compose version | Out-Null } catch { Fail "The 'docker compose' plugin is missing; it ships with Docker Desktop." }
try { docker info 2>$null | Out-Null; if ($LASTEXITCODE -ne 0) { throw 'down' } } catch { Fail "Docker Desktop is installed but not running. Start it and try again." }

Line
Write-Host 'Faktura - installation'
Write-Host 'Four questions. Enter keeps the value in brackets.'
Line

# ---------------------------------------------------------------- 2. Questions
$defaultDir = if ($env:FAKTURA_DIR) { $env:FAKTURA_DIR } else { Join-Path $HOME 'faktura' }
$Dir = Ask 'FAKTURA_DIR' 'Directory for configuration and data' $defaultDir
New-Item -ItemType Directory -Force (Join-Path $Dir 'data') | Out-Null
$EnvFile = Join-Path $Dir '.env'
$ComposeFile = Join-Path $Dir 'docker-compose.yml'

$curPort = ''; $curPassword = ''; $curToken = ''
if (Test-Path $EnvFile) {
  foreach ($l in Get-Content $EnvFile) {
    if ($l -match '^FAKTURA_PORT=(.*)$') { $curPort = $Matches[1] }
    if ($l -match '^APP_PASSWORD=(.*)$') { $curPassword = $Matches[1] }
    if ($l -match '^API_TOKEN=(.*)$') { $curToken = $Matches[1] }
  }
  Write-Host "Existing installation found in $Dir - this run updates it; data is kept."
}

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

$Token = AskSecret 'API_TOKEN' 'API token for AI/MCP access (Enter = generate one)' ([bool]$curToken)
$TokenGenerated = $false
if ([string]::IsNullOrEmpty($Token)) { $Token = if ($curToken) { $curToken } else { 'generate' } }
if ($Token -eq 'generate') { $Token = NewSecret; $TokenGenerated = $true }
if ($Token.Length -lt 16) { Fail 'API_TOKEN must be at least 16 characters' }
$McpPort = if ($env:FAKTURA_MCP_PORT) { $env:FAKTURA_MCP_PORT } else { '3333' }

# ---------------------------------------------------------------- 3. Write config (secrets only in .env)
$envText = @(
  '# Faktura configuration. Keep this file private: it holds the login password and the API token.',
  "APP_PASSWORD=$Password",
  "API_TOKEN=$Token",
  "FAKTURA_PORT=$Port",
  "FAKTURA_MCP_PORT=$McpPort",
  "FAKTURA_IMAGE=$Image"
) -join "`n"
[IO.File]::WriteAllText($EnvFile, $envText + "`n", (New-Object Text.UTF8Encoding $false))
# Restrict the file to the current user.
try { icacls $EnvFile /inheritance:r /grant:r "$($env:USERNAME):(F)" | Out-Null } catch { }

$compose = @'
# Written by install.ps1. Rerun the installer to change settings; edit by hand if you know compose.
services:
  app:
    image: ${FAKTURA_IMAGE}
    container_name: faktura
    restart: unless-stopped
    ports:
      - "${FAKTURA_PORT}:3000"
    environment:
      APP_PASSWORD: ${APP_PASSWORD}
      API_TOKEN: ${API_TOKEN}
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
    container_name: faktura-mcp
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
      MCP_ALLOWED_HOSTS: localhost:${FAKTURA_MCP_PORT},127.0.0.1:${FAKTURA_MCP_PORT}
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
  docker compose pull --quiet 2>$null | Out-Null
  if ($LASTEXITCODE -ne 0) {
    docker image inspect $Image 2>$null | Out-Null
    if ($LASTEXITCODE -ne 0) { Fail "Could not pull $Image and no local copy exists. Check your network or FAKTURA_IMAGE." }
    Write-Host "Could not pull $Image; using the local copy."
  }
  docker compose up -d --remove-orphans
  if ($LASTEXITCODE -ne 0) { Fail 'docker compose up failed' }
} finally { Pop-Location }

# ---------------------------------------------------------------- 5. Health check
$Url = "http://localhost:$Port"
$ok = $false
for ($i = 0; $i -lt 60 -and -not $ok; $i++) {
  try { $r = Invoke-WebRequest -UseBasicParsing -Uri "$Url/healthz" -TimeoutSec 3; if ($r.StatusCode -eq 200) { $ok = $true } } catch { Start-Sleep -Seconds 1 }
}
if (-not $ok) { Fail "The app did not answer on $Url/healthz within 60 s. Logs: docker compose -f `"$ComposeFile`" logs" }

# ---------------------------------------------------------------- 6. Summary
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
Write-Host 'For a client that only speaks stdio, this runs the MCP server inside the app container (token filled in):'
Write-Host ''
$composePath = $ComposeFile.Replace('\', '/')
$tokenShown = if ($NonInteractive) { "<API_TOKEN from $EnvFile>" } else { $Token }
Write-Host "  { `"mcpServers`": { `"kvit`": { `"command`": `"docker`", `"args`": [`"compose`", `"-f`", `"$composePath`", `"exec`", `"-i`", `"-T`","
Write-Host "      `"-e`", `"FAKTURA_URL=http://127.0.0.1:3000`", `"-e`", `"FAKTURA_API_TOKEN=$tokenShown`", `"app`", `"node`", `"mcp/dist/stdio.js`"] } } }"
Write-Host ''
Write-Host 'Update later: rerun this installer with the same directory. Your data is kept, and the database is copied'
Write-Host "to $(Join-Path $Dir 'data\backups') before any schema change."
Line
