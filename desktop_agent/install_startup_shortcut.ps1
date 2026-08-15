# ENGRAM Desktop Agent — Startup Folder Shortcut Installer
# Simplest method: creates a shortcut in the Windows Startup folder
# Agent will run automatically when you log in

param(
    [switch]$Uninstall
)

$StartupFolder = [Environment]::GetFolderPath("Startup")
$ShortcutPath = Join-Path $StartupFolder "ENGRAM Desktop Agent.lnk"
$AgentPath = Split-Path -Parent $MyInvocation.MyCommand.Path
$PythonExe = (Get-Command python -ErrorAction SilentlyContinue).Source
$AgentScript = Join-Path $AgentPath "agent.py"

if (-not $PythonExe) {
    Write-Host "ERROR: Python not found in PATH." -ForegroundColor Red
    exit 1
}

# Use pythonw.exe to avoid console window
$PythonWExe = $PythonExe -replace "python\.exe$", "pythonw.exe"
if (-not (Test-Path $PythonWExe)) {
    Write-Host "WARNING: pythonw.exe not found — using python.exe (console will appear)" -ForegroundColor Yellow
    $PythonWExe = $PythonExe
}

if ($Uninstall) {
    if (Test-Path $ShortcutPath) {
        Remove-Item $ShortcutPath -Force
        Write-Host "✓ Shortcut removed from Startup folder" -ForegroundColor Green
    } else {
        Write-Host "Shortcut not found — nothing to uninstall" -ForegroundColor Yellow
    }
    exit 0
}

Write-Host "Creating startup shortcut..." -ForegroundColor Cyan
Write-Host "  Startup folder: $StartupFolder"
Write-Host "  Python:         $PythonWExe"
Write-Host "  Agent:          $AgentScript"
Write-Host ""

# Create shortcut using WScript.Shell COM object
$WScriptShell = New-Object -ComObject WScript.Shell
$Shortcut = $WScriptShell.CreateShortcut($ShortcutPath)
$Shortcut.TargetPath = $PythonWExe
$Shortcut.Arguments = "`"$AgentScript`""
$Shortcut.WorkingDirectory = $AgentPath
$Shortcut.IconLocation = "$PythonWExe,0"
$Shortcut.Description = "ENGRAM Desktop Agent — Passive Knowledge Capture"
$Shortcut.Save()

Write-Host "✓ Shortcut created at: $ShortcutPath" -ForegroundColor Green
Write-Host ""
Write-Host "The agent will start automatically on next login." -ForegroundColor Cyan
Write-Host "To start it now, double-click the shortcut or run:" -ForegroundColor Cyan
Write-Host "  Start-Process '$ShortcutPath'" -ForegroundColor White
Write-Host ""
Write-Host "To uninstall:" -ForegroundColor Cyan
Write-Host "  .\install_startup_shortcut.ps1 -Uninstall" -ForegroundColor White
Write-Host ""
