param(
  [string]$TaskName = "StockTool-DailyDBSync",
  [string]$RunAt = "18:00"
)

$ErrorActionPreference = "Stop"

$repo = Split-Path -Parent $PSScriptRoot
$logDir = Join-Path $repo "logs"
if (-not (Test-Path $logDir)) { New-Item -ItemType Directory -Path $logDir | Out-Null }

# The wrapper script that the scheduler calls: downloads latest DB artifact, with logging
$wrapperScript = @"
`$ErrorActionPreference = 'Continue'
`$repo = '$repo'
`$logDir = '$logDir'
`$logFile = Join-Path `$logDir ("db-sync-" + (Get-Date -Format 'yyyy-MM-dd') + ".log")

function Log(`$msg) {
    `$ts = Get-Date -Format 'yyyy-MM-dd HH:mm:ss'
    "`$ts  `$msg" | Tee-Object -Append -FilePath `$logFile
}

Set-Location `$repo
Log "=== DB sync started ==="

try {
    Log "Downloading latest DB artifact from GitHub..."
    & node scripts/download-latest-db.mjs 2>&1 | Tee-Object -Append -FilePath `$logFile
    if (`$LASTEXITCODE -ne 0) { Log "ERROR: download-latest-db exited with code `$LASTEXITCODE" }
    else { Log "DB sync completed successfully" }
} catch {
    Log "ERROR: download-latest-db failed: `$_"
}

Log "=== DB sync finished ==="

# Clean up old logs (keep 30 days)
Get-ChildItem `$logDir -Filter "db-sync-*.log" | Where-Object { `$_.LastWriteTime -lt (Get-Date).AddDays(-30) } | Remove-Item -Force
"@

$wrapperPath = Join-Path (Join-Path $repo "scripts") "daily-db-sync-runner.ps1"
Set-Content -Path $wrapperPath -Value $wrapperScript -Encoding UTF8

$command = "powershell.exe -NoProfile -ExecutionPolicy Bypass -File `"$wrapperPath`""

# Remove the old refresh task if it exists
$oldTaskName = "StockTool-DailyRefresh"
$oldTask = schtasks /Query /TN $oldTaskName 2>&1
if ($LASTEXITCODE -eq 0) {
  Write-Host "Removing old task '$oldTaskName'..."
  schtasks /Delete /TN $oldTaskName /F | Out-Null
  Write-Host "  Removed."
}

Write-Host "Creating/updating scheduled task '$TaskName' at $RunAt (daily, weekdays)..."

schtasks /Create `
  /TN $TaskName `
  /TR $command `
  /SC WEEKLY `
  /D MON,TUE,WED,THU,FRI `
  /ST $RunAt `
  /F | Out-Null

Write-Host ""
Write-Host "Task '$TaskName' is configured to run at $RunAt on weekdays."
Write-Host "Wrapper script: $wrapperPath"
Write-Host "Logs directory: $logDir"
Write-Host ""
Write-Host "Prerequisites:"
Write-Host "  gh auth login   (GitHub CLI must be authenticated)"
Write-Host ""
Write-Host "To run once now:"
Write-Host "  schtasks /Run /TN `"$TaskName`""
Write-Host ""
Write-Host "To check status:"
Write-Host "  schtasks /Query /TN `"$TaskName`" /V /FO LIST"
Write-Host ""
Write-Host "To remove:"
Write-Host "  schtasks /Delete /TN `"$TaskName`" /F"
