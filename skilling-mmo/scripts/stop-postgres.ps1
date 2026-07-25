# Stop the local Postgres cluster started by start-postgres.ps1.
$ErrorActionPreference = "Stop"
$pgBin = "C:\Program Files\PostgreSQL\16\bin"
$skillingRoot = Split-Path $PSScriptRoot -Parent
$repoRoot = Split-Path $skillingRoot -Parent
$dataDir = Join-Path $repoRoot ".postgres-data"

if (-not (Test-Path $dataDir)) {
  Write-Host "No data directory at $dataDir"
  exit 0
}

& "$pgBin\pg_ctl.exe" -D $dataDir status 2>&1 | Out-Null
if ($LASTEXITCODE -ne 0) {
  Write-Host "Postgres is not running"
  exit 0
}

& "$pgBin\pg_ctl.exe" -D $dataDir stop -m fast
