param(
  [string]$TaskName = "StockTool-DailyRefresh",
  [string]$RunAt = "18:00"
)

$ErrorActionPreference = "Stop"

$repo = Split-Path -Parent $PSScriptRoot
$logDir = Join-Path $repo "logs"
if (-not (Test-Path $logDir)) { New-Item -ItemType Directory -Path $logDir | Out-Null }

# The wrapper script that the scheduler calls: runs refresh then optimize, with logging
$wrapperScript = @"
`$ErrorActionPreference = 'Continue'
`$repo = '$repo'
`$logDir = '$logDir'
`$logFile = Join-Path `$logDir ("refresh-" + (Get-Date -Format 'yyyy-MM-dd') + ".log")

function Log(`$msg) {
    `$ts = Get-Date -Format 'yyyy-MM-dd HH:mm:ss'
    "`$ts  `$msg" | Tee-Object -Append -FilePath `$logFile
}

Set-Location `$repo
Log "=== Daily refresh started ==="

try {
    Log "Running refresh-daily..."
    & node scripts/refresh-daily.mjs 2>&1 | Tee-Object -Append -FilePath `$logFile
    if (`$LASTEXITCODE -ne 0) { Log "ERROR: refresh-daily exited with code `$LASTEXITCODE" }
    else { Log "refresh-daily completed successfully" }
} catch {
    Log "ERROR: refresh-daily failed: `$_"
}

try {
    Log "Running optimize-db..."
    & node scripts/optimize-db.mjs 2>&1 | Tee-Object -Append -FilePath `$logFile
    if (`$LASTEXITCODE -ne 0) { Log "ERROR: optimize-db exited with code `$LASTEXITCODE" }
    else { Log "optimize-db completed successfully" }
} catch {
    Log "ERROR: optimize-db failed: `$_"
}

Log "=== Daily refresh finished ==="

# Clean up old logs (keep 30 days)
Get-ChildItem `$logDir -Filter "refresh-*.log" | Where-Object { `$_.LastWriteTime -lt (Get-Date).AddDays(-30) } | Remove-Item -Force
"@

$wrapperPath = Join-Path $repo "scripts" "daily-refresh-runner.ps1"
Set-Content -Path $wrapperPath -Value $wrapperScript -Encoding UTF8

$command = "powershell.exe -NoProfile -ExecutionPolicy Bypass -File `"$wrapperPath`""

Write-Host "Creating/updating scheduled task '$TaskName' at $RunAt (daily, weekdays)..."

# Create the task to run Mon-Fri at the specified time
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
Write-Host "To run once now:"
Write-Host "  schtasks /Run /TN `"$TaskName`""
Write-Host ""
Write-Host "To check status:"
Write-Host "  schtasks /Query /TN `"$TaskName`" /V /FO LIST"
Write-Host ""
Write-Host "To remove:"
Write-Host "  schtasks /Delete /TN `"$TaskName`" /F"
