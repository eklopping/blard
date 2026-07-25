# Start the local Postgres cluster used for npm run dev:* (not Docker).
$ErrorActionPreference = "Stop"
$pgBin = "C:\Program Files\PostgreSQL\16\bin"
$skillingRoot = Split-Path $PSScriptRoot -Parent
$repoRoot = Split-Path $skillingRoot -Parent
$dataDir = Join-Path $repoRoot ".postgres-data"
$logFile = Join-Path $repoRoot ".postgres.log"

if (-not (Test-Path "$pgBin\pg_ctl.exe")) {
  throw "PostgreSQL 16 binaries not found at $pgBin"
}
if (-not (Test-Path $dataDir)) {
  throw "Data directory missing: $dataDir"
}

& "$pgBin\pg_ctl.exe" -D $dataDir status 2>&1 | Out-Null
if ($LASTEXITCODE -eq 0) {
  Write-Host "Postgres already running ($dataDir)"
  exit 0
}

& "$pgBin\pg_ctl.exe" -D $dataDir -l $logFile start
if ($LASTEXITCODE -ne 0) { throw "pg_ctl start failed" }
& "$pgBin\pg_isready.exe" -h 127.0.0.1 -p 5432
