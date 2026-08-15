# ENGRAM Desktop Agent — Windows Service Installer (using NSSM)
# Requires: NSSM (Non-Sucking Service Manager) — download from https://nssm.cc/download
# Requires: Administrator privileges
#
# This creates a proper Windows Service that:
# - Starts automatically on boot (before login)
# - Restarts automatically if it crashes
# - Can be controlled via Services.msc

#Requires -RunAsAdministrator

param(
    [switch]$Uninstall,
    [string]$NssmPath = ""
)

$ServiceName = "ENGRAM-Desktop-Agent"
$AgentPath = Split-Path -Parent $MyInvocation.MyCommand.Path
$PythonExe = (Get-Command python -ErrorAction SilentlyContinue).Source
$AgentScript = Join-Path $AgentPath "agent.py"
$LogPath = Join-Path $AgentPath "agent.log"

if (-not $PythonExe) {
    Write-Host "ERROR: Python not found in PATH." -ForegroundColor Red
    exit 1
}

# Find NSSM
if (-not $NssmPath) {
    $NssmPath = Get-Command nssm -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Source
}

if (-not $NssmPath -or -not (Test-Path $NssmPath)) {
    Write-Host "ERROR: NSSM not found." -ForegroundColor Red
    Write-Host ""
    Write-Host "Download NSSM from: https://nssm.cc/download" -ForegroundColor Yellow
    Write-Host "Extract nssm.exe to a folder in your PATH, or specify with -NssmPath" -ForegroundColor Yellow
    Write-Host ""
    Write-Host "Example:" -ForegroundColor Cyan
    Write-Host "  .\install_windows_service.ps1 -NssmPath 'C:\tools\nssm\win64\nssm.exe'" -ForegroundColor White
    exit 1
}

if ($Uninstall) {
    Write-Host "Uninstalling ENGRAM Desktop Agent service..." -ForegroundColor Yellow
    $service = Get-Service -Name $ServiceName -ErrorAction SilentlyContinue
    if ($service) {
        & $NssmPath stop $ServiceName
        & $NssmPath remove $ServiceName confirm
        Write-Host "✓ Service '$ServiceName' removed" -ForegroundColor Green
    } else {
        Write-Host "Service '$ServiceName' not found" -ForegroundColor Yellow
    }
    exit 0
}

Write-Host "Installing ENGRAM Desktop Agent as Windows Service..." -ForegroundColor Cyan
Write-Host "  NSSM:    $NssmPath"
Write-Host "  Python:  $PythonExe"
Write-Host "  Script:  $AgentScript"
Write-Host "  Service: $ServiceName"
Write-Host ""

# Remove existing service if present
$existingService = Get-Service -Name $ServiceName -ErrorAction SilentlyContinue
if ($existingService) {
    Write-Host "Stopping and removing existing service..." -ForegroundColor Yellow
    & $NssmPath stop $ServiceName
    & $NssmPath remove $ServiceName confirm
}

# Install service
& $NssmPath install $ServiceName $PythonExe "`"$AgentScript`""
& $NssmPath set $ServiceName AppDirectory $AgentPath
& $NssmPath set $ServiceName DisplayName "ENGRAM Desktop Agent"
& $NssmPath set $ServiceName Description "Passively captures desktop activity for ENGRAM knowledge graph"
& $NssmPath set $ServiceName Start SERVICE_AUTO_START
& $NssmPath set $ServiceName AppStdout $LogPath
& $NssmPath set $ServiceName AppStderr $LogPath
& $NssmPath set $ServiceName AppRotateFiles 1
& $NssmPath set $ServiceName AppRotateBytes 10485760  # 10 MB
& $NssmPath set $ServiceName AppRestartDelay 5000     # 5 seconds

Write-Host ""
Write-Host "✓ Service installed successfully!" -ForegroundColor Green
Write-Host ""
Write-Host "To start the service:" -ForegroundColor Cyan
Write-Host "  Start-Service -Name '$ServiceName'" -ForegroundColor White
Write-Host ""
Write-Host "To check status:" -ForegroundColor Cyan
Write-Host "  Get-Service -Name '$ServiceName'" -ForegroundColor White
Write-Host ""
Write-Host "To view logs:" -ForegroundColor Cyan
Write-Host "  Get-Content '$LogPath' -Tail 50 -Wait" -ForegroundColor White
Write-Host ""
Write-Host "To uninstall:" -ForegroundColor Cyan
Write-Host "  .\install_windows_service.ps1 -Uninstall" -ForegroundColor White
Write-Host ""
Write-Host "Starting service now..." -ForegroundColor Cyan
Start-Service -Name $ServiceName
Write-Host "✓ Service started" -ForegroundColor Green
