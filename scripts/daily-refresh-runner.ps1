$ErrorActionPreference = 'Continue'
$repo = 'C:\Users\USER\stock-tool'
$logDir = 'C:\Users\USER\stock-tool\logs'
$logFile = Join-Path $logDir ("refresh-" + (Get-Date -Format 'yyyy-MM-dd') + ".log")

function Log($msg) {
    $ts = Get-Date -Format 'yyyy-MM-dd HH:mm:ss'
    "$ts  $msg" | Tee-Object -Append -FilePath $logFile
}

Set-Location $repo
Log "=== Daily refresh started ==="

try {
    Log "Running refresh-daily..."
    & node scripts/refresh-daily.mjs 2>&1 | Tee-Object -Append -FilePath $logFile
    if ($LASTEXITCODE -ne 0) { Log "ERROR: refresh-daily exited with code $LASTEXITCODE" }
    else { Log "refresh-daily completed successfully" }
} catch {
    Log "ERROR: refresh-daily failed: $_"
}

try {
    Log "Running optimize-db..."
    & node scripts/optimize-db.mjs 2>&1 | Tee-Object -Append -FilePath $logFile
    if ($LASTEXITCODE -ne 0) { Log "ERROR: optimize-db exited with code $LASTEXITCODE" }
    else { Log "optimize-db completed successfully" }
} catch {
    Log "ERROR: optimize-db failed: $_"
}

Log "=== Daily refresh finished ==="

# Clean up old logs (keep 30 days)
Get-ChildItem $logDir -Filter "refresh-*.log" | Where-Object { $_.LastWriteTime -lt (Get-Date).AddDays(-30) } | Remove-Item -Force
