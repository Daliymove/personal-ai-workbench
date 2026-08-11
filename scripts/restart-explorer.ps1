# One-click restart of Windows Explorer.
# Reloading the shell also refreshes the icon cache display.

$ErrorActionPreference = 'SilentlyContinue'

$explorer = Get-Process -Name explorer
if ($explorer) {
    Stop-Process -Name explorer -Force
    Start-Sleep -Milliseconds 800
}

Start-Process explorer.exe
Write-Host 'Explorer has been restarted.'
