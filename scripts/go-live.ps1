# Go-live script: stage all files and show next steps for pushing to GitHub.
# Run from repo root: .\scripts\go-live.ps1
# Then create a repo on GitHub, add remote, and push (see docs/GO_LIVE.md).

$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot\..

# Ensure we're in a git repo
if (-not (Test-Path .git)) {
    Write-Error "Not a git repository. Run 'git init' first."
}

# Warn if .env exists (should not be committed)
if (Test-Path .env) {
    Write-Warning ".env exists; it is in .gitignore and will not be committed."
}
if (Test-Path .env.local) {
    Write-Warning ".env.local exists; it is in .gitignore and will not be committed."
}

# Stage all tracked and untracked (respects .gitignore)
git add -A
$status = git status --short
if (-not $status) {
    Write-Host "Nothing to commit (working tree clean)."
    exit 0
}

Write-Host "Staged files:"
git status --short
Write-Host ""

$msg = "Go live: CI, Render blueprint, deploy docs, prebuilt screens"
git commit -m $msg
if ($LASTEXITCODE -ne 0) {
    Write-Host "Commit failed or nothing to commit."
    exit $LASTEXITCODE
}

Write-Host ""
Write-Host "Commit created. Next steps:" -ForegroundColor Green
Write-Host "1. Create a new repo at https://github.com/new (no README/.gitignore)."
Write-Host "2. Add remote: git remote add origin https://github.com/YOUR_USERNAME/REPO_NAME.git"
Write-Host "3. Push: git push -u origin master   (or 'main' if that is your branch)"
Write-Host ""
Write-Host "Full instructions: docs/GO_LIVE.md"
