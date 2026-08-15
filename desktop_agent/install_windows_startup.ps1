# ENGRAM Desktop Agent - Windows Startup Installer
# This script creates a Task Scheduler task that runs the agent on login
# No admin rights required - runs in user context

param(
    [switch]$Uninstall
)

$TaskName = "ENGRAM-Desktop-Agent"
$AgentPath = Split-Path -Parent $MyInvocation.MyCommand.Path
$PythonExe = (Get-Command python -ErrorAction SilentlyContinue).Source
$AgentScript = Join-Path $AgentPath "agent.py"
$LogPath = Join-Path $AgentPath "agent.log"

if (-not $PythonExe) {
    Write-Host "ERROR: Python not found in PATH. Install Python and try again." -ForegroundColor Red
    exit 1
}

if (-not (Test-Path $AgentScript)) {
    Write-Host "ERROR: agent.py not found at $AgentScript" -ForegroundColor Red
    exit 1
}

if ($Uninstall) {
    Write-Host "Uninstalling ENGRAM Desktop Agent from startup..." -ForegroundColor Yellow
    $task = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
    if ($task) {
        Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
        Write-Host "Task '$TaskName' removed from Task Scheduler" -ForegroundColor Green
    } else {
        Write-Host "Task '$TaskName' not found - nothing to uninstall" -ForegroundColor Yellow
    }
    exit 0
}

Write-Host "Installing ENGRAM Desktop Agent to run on startup..." -ForegroundColor Cyan
Write-Host "  Python:  $PythonExe"
Write-Host "  Script:  $AgentScript"
Write-Host "  Task:    $TaskName"
Write-Host ""

# Remove existing task if present
$existingTask = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
if ($existingTask) {
    Write-Host "Removing existing task..." -ForegroundColor Yellow
    Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
}

# Create scheduled task action (run pythonw.exe to avoid console window)
$PythonWExe = $PythonExe -replace "python\.exe`$", "pythonw.exe"
if (-not (Test-Path $PythonWExe)) {
    Write-Host "WARNING: pythonw.exe not found - using python.exe (console window will appear)" -ForegroundColor Yellow
    $PythonWExe = $PythonExe
}

$Action = New-ScheduledTaskAction -Execute $PythonWExe -Argument "`"$AgentScript`"" -WorkingDirectory $AgentPath

# Trigger: at logon
$Trigger = New-ScheduledTaskTrigger -AtLogOn

# Settings: allow task to run on battery, don't stop if idle ends
$Settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -DontStopOnIdleEnd -StartWhenAvailable -RestartInterval (New-TimeSpan -Minutes 1) -RestartCount 3

# Principal: run as current user (no admin required)
$Principal = New-ScheduledTaskPrincipal -UserId $env:USERNAME -LogonType Interactive -RunLevel Limited

# Register the task
$Task = New-ScheduledTask -Action $Action -Trigger $Trigger -Settings $Settings -Principal $Principal
Register-ScheduledTask -TaskName $TaskName -InputObject $Task -Force | Out-Null

Write-Host ""
Write-Host "ENGRAM Desktop Agent installed successfully!" -ForegroundColor Green
Write-Host ""
Write-Host "The agent will start automatically on next login." -ForegroundColor Cyan
Write-Host "To start it now, run:" -ForegroundColor Cyan
Write-Host "  Start-ScheduledTask -TaskName '$TaskName'" -ForegroundColor White
Write-Host ""
Write-Host "To check if it's running:" -ForegroundColor Cyan
Write-Host "  Get-Process -Name pythonw -ErrorAction SilentlyContinue" -ForegroundColor White
Write-Host ""
Write-Host "To view logs:" -ForegroundColor Cyan
Write-Host "  Get-Content '$LogPath' -Tail 50 -Wait" -ForegroundColor White
Write-Host ""
Write-Host "To uninstall:" -ForegroundColor Cyan
Write-Host "  .\install_windows_startup.ps1 -Uninstall" -ForegroundColor White
Write-Host ""
