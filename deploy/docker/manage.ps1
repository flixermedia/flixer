# Windows management entry point for a Flixer installation in WSL.
param([string]$Action)
$ErrorActionPreference = 'Stop'
$configFile = Join-Path $PSScriptRoot 'wsl-install.json'
if (-not (Test-Path $configFile -PathType Leaf)) { throw 'Windows management configuration not found. Run the Windows installer first.' }
if (-not (Get-Command wsl.exe -ErrorAction SilentlyContinue)) { throw 'WSL is required to manage this installation.' }
$config = Get-Content -Raw $configFile | ConvertFrom-Json
if (-not $config.linuxDir -or $config.linuxDir -notmatch '^/') { throw 'Invalid WSL installation directory in management configuration.' }
if (-not $Action) {
    Write-Host "Flixer management`n  1) Start`n  2) Stop`n  3) Restart`n  4) Update`n  5) Status"
    $Action = Read-Host 'Choose an action'
}
if ($Action.ToLowerInvariant() -notin @('1', '2', '3', '4', '5', 'start', 'stop', 'restart', 'update', 'status')) {
    throw 'Usage: .\manage.ps1 [start|stop|restart|update|status]'
}
$wslArgs = @()
if ($config.distro) { $wslArgs += @('--distribution', $config.distro) }
$encodedDir = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes([string]$config.linuxDir))
$script = 'dir=$(printf "%s" "$1" | base64 -d) || exit; exec "$dir/manage.sh" "$2"'
($script + "`n#") | & wsl.exe @wslArgs --exec bash -s -- $encodedDir $Action
if ($LASTEXITCODE -ne 0) { throw "Flixer management failed inside WSL (exit $LASTEXITCODE)." }
