<#
.SYNOPSIS
  Sets up a GitHub Actions self-hosted runner for the stock-tool repo.
  Use this for the one-time seed of the Daily Data Refresh workflow.

.DESCRIPTION
  Downloads, extracts, and configures the GitHub Actions runner.
  You must get the runner token from GitHub first:
    1. Go to https://github.com/anisjnasr/stock-screener/settings/actions/runners/new
    2. Copy the token from the "Configure" step
    3. Run this script and paste the token when prompted

.PARAMETER Token
  The runner token from GitHub (Configure step). If not provided, you'll be prompted.

.PARAMETER InstallAsService
  If set, installs the runner as a Windows service (runs at startup). Otherwise runs interactively.

.PARAMETER RunnerDir
  Directory to install the runner. Default: $env:USERPROFILE\actions-runner

.EXAMPLE
  .\setup-github-runner.ps1
  # Prompts for token, runs interactively

.EXAMPLE
  .\setup-github-runner.ps1 -Token "ABCD1234..." -InstallAsService
  # Uses token, installs as service
#>

param(
  [string]$Token = "",
  [switch]$InstallAsService,
  [string]$RunnerDir = ""
)

$ErrorActionPreference = "Stop"

# Detect repo from git remote (PSScriptRoot = scripts/, repo root = parent)
$RepoUrl = ""
$RepoRoot = Split-Path -Parent $PSScriptRoot
if (Test-Path (Join-Path $RepoRoot ".git")) {
  $remote = git -C $RepoRoot remote get-url origin 2>$null
  if ($remote) {
    $RepoUrl = $remote -replace "\.git$", "" -replace "^git@github\.com:", "https://github.com/"
  }
}
if (-not $RepoUrl) {
  $RepoUrl = "https://github.com/anisjnasr/stock-screener"
  Write-Host "Could not detect repo from git; using $RepoUrl" -ForegroundColor Yellow
}
$RunnerVersion = "2.332.0"
$ZipName = "actions-runner-win-x64-$RunnerVersion.zip"
$DownloadUrl = "https://github.com/actions/runner/releases/download/v$RunnerVersion/$ZipName"

if (-not $RunnerDir) {
  $RunnerDir = Join-Path $env:USERPROFILE "actions-runner"
}

Write-Host "=== GitHub Actions Self-Hosted Runner Setup ===" -ForegroundColor Cyan
Write-Host ""
Write-Host "Repo: $RepoUrl"
Write-Host "Runner dir: $RunnerDir"
Write-Host ""

# Create runner directory
if (-not (Test-Path $RunnerDir)) {
  New-Item -ItemType Directory -Path $RunnerDir -Force | Out-Null
  Write-Host "Created $RunnerDir"
} else {
  Write-Host "Using existing $RunnerDir"
}

Set-Location $RunnerDir

# Download runner if not present
$ZipPath = Join-Path $RunnerDir $ZipName
if (-not (Test-Path $ZipPath)) {
  Write-Host "Downloading runner v$RunnerVersion..."
  try {
    Invoke-WebRequest -Uri $DownloadUrl -OutFile $ZipPath -UseBasicParsing
  } catch {
    Write-Host "Download failed. Try manually: $DownloadUrl" -ForegroundColor Yellow
    exit 1
  }
  Write-Host "Downloaded."
} else {
  Write-Host "Runner zip already present."
}

# Extract if not already extracted
if (-not (Test-Path (Join-Path $RunnerDir "config.cmd"))) {
  Write-Host "Extracting..."
  Expand-Archive -Path $ZipPath -DestinationPath $RunnerDir -Force
  Write-Host "Extracted."
} else {
  Write-Host "Runner already extracted."
}

# Get token
if (-not $Token) {
  $RunnersUrl = $RepoUrl + "/settings/actions/runners/new"
  Write-Host ""
  Write-Host "Get your runner token from:" -ForegroundColor Yellow
  Write-Host "  $RunnersUrl" -ForegroundColor Yellow
  Write-Host ""
  Write-Host "Copy the token from the 'Configure' step, then paste it below."
  $Token = Read-Host "Token"
  if (-not $Token) {
    Write-Host "No token provided. Exiting." -ForegroundColor Red
    exit 1
  }
}

# Configure
Write-Host ""
Write-Host "Configuring runner..."
& .\config.cmd --url $RepoUrl --token $Token --unattended

if ($LASTEXITCODE -ne 0) {
  Write-Host "Config failed. Check the token (it expires in ~1 hour)." -ForegroundColor Red
  exit 1
}

Write-Host ""
Write-Host "Runner configured successfully." -ForegroundColor Green
Write-Host ""

if ($InstallAsService) {
  Write-Host "Installing as Windows service..."
  & .\svc.cmd install
  & .\svc.cmd start
  Write-Host ""
  Write-Host "Runner is installed and running as a service." -ForegroundColor Green
  Write-Host "It will start automatically with Windows."
} else {
  Write-Host "To run the runner now, execute:" -ForegroundColor Cyan
  Write-Host "  cd $RunnerDir"
  Write-Host "  .\run.cmd"
  Write-Host ""
  Write-Host "Or run this script again with -InstallAsService to run as a Windows service."
  Write-Host ""
  $run = Read-Host "Start runner now? (y/n)"
  if ($run -eq "y" -or $run -eq "Y") {
    Write-Host "Starting runner (Ctrl+C to stop)..."
    & .\run.cmd
  }
}
