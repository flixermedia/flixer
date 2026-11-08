# Windows installer using a WSL 2 Linux distribution and its local Docker Engine.
[CmdletBinding()]
param(
    [string]$Distro = '',
    [string]$LinuxDir = '',
    [string]$ManagementDir = (Join-Path $HOME 'flixer-management'),
    [string]$Data = '',
    [string]$Media = '',
    [int]$Port = 8080,
    [string]$Version = '',
    [string]$Ref = 'main',
    [switch]$Fresh,
    [switch]$Update,
    [switch]$NoAi,
    [switch]$Yes,
    [switch]$NoStart
)
$ErrorActionPreference = 'Stop'
if (-not (Get-Command wsl.exe -ErrorAction SilentlyContinue)) {
    throw 'WSL 2 is required. Install Ubuntu with wsl --install -d Ubuntu, then install and start Docker Engine inside Ubuntu.'
}
if ($Port -lt 1 -or $Port -gt 65535) { throw 'Port must be between 1 and 65535.' }
if ($Ref -notmatch '^[A-Za-z0-9._/-]+$' -or $Ref -match '\.\.') { throw 'Invalid Git ref.' }
if ($Fresh -and $Update) { throw 'Choose either -Fresh or -Update.' }
$wslArgs = @()
if ($Distro) { $wslArgs += @('--distribution', $Distro) }
$preflight = @'
set -eu
command -v docker >/dev/null && docker compose version >/dev/null || { echo "Install Docker Engine and its Compose plugin inside this WSL distribution." >&2; exit 1; }
command -v curl >/dev/null || { echo "Install curl inside this WSL distribution." >&2; exit 1; }
endpoint=$(docker context inspect --format '{{.Endpoints.docker.Host}}')
[ "$endpoint" = unix:///var/run/docker.sock ] || { echo "Use a local Docker Engine inside WSL, not a remote Docker context." >&2; exit 1; }
os=$(docker info --format '{{.OperatingSystem}}') || { echo "Start Docker Engine in WSL and grant your user access." >&2; exit 1; }
case "$os" in *"Docker Desktop"*) echo "Docker Desktop is not supported by this installer; use a local Docker Engine inside WSL." >&2; exit 1 ;; esac
'@
(($preflight -replace "`r`n", "`n") + "`n#") | & wsl.exe @wslArgs --exec bash -s
if ($LASTEXITCODE -ne 0) { throw 'WSL Docker preflight failed. See the error above.' }
if (-not $Distro) {
    $Distro = (& wsl.exe --exec printenv WSL_DISTRO_NAME | Select-Object -First 1)
    if ($LASTEXITCODE -ne 0 -or -not $Distro) { throw 'Unable to determine the WSL distribution name.' }
    $wslArgs = @('--distribution', $Distro)
}
if (-not $LinuxDir) {
    $linuxHome = (& wsl.exe @wslArgs --exec printenv HOME | Select-Object -First 1)
    if ($LASTEXITCODE -ne 0 -or -not $linuxHome) { throw 'Unable to determine the WSL home directory.' }
    $LinuxDir = "$linuxHome/flixer"
}
foreach ($path in @($LinuxDir, $Data, $Media)) {
    if ($path -and ($path -notmatch '^/' -or $path -match '[\r\n]')) { throw 'Linux paths must be absolute WSL paths without newlines.' }
}
if (-not $Yes -and -not $Fresh -and -not $Update) {
    $encodedDir = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($LinuxDir))
    $detect = 'dir=$(printf "%s" "$1" | base64 -d) || exit; if [ -e "$dir/.env" ] || [ -e "$dir/docker-compose.yml" ]; then echo update; else echo fresh; fi'
    $detected = (($detect + "`n#") | & wsl.exe @wslArgs --exec bash -s -- $encodedDir | Select-Object -Last 1)
    if ($LASTEXITCODE -ne 0 -or $detected -notin @('fresh', 'update')) { throw 'Unable to detect the WSL installation.' }
    $choice = Read-Host "Install fresh or update an existing installation? [$detected]"
    if (-not $choice) { $choice = $detected }
    switch ($choice.ToLowerInvariant()) {
        'fresh' { $Fresh = $true }
        'update' { $Update = $true }
        default { throw 'Choose fresh or update.' }
    }
}
if (-not $Yes -and -not $NoAi -and -not $Update) {
    $answer = Read-Host 'Enable Flixer AI (may download models)? [Y/n]'
    if ($answer -match '^(n|no)$') { $NoAi = $true }
}
New-Item -ItemType Directory -Force -Path $ManagementDir | Out-Null
$manager = Join-Path $ManagementDir 'manage.ps1'
$temp = "$manager.tmp"
try {
    Invoke-WebRequest -UseBasicParsing -Uri "https://raw.githubusercontent.com/flixermedia/flixer/$Ref/manage.ps1" -OutFile $temp
    $installerArgs = @('--yes', '--dir', $LinuxDir, '--ref', $Ref)
    if ($Fresh) { $installerArgs += '--fresh' }
    if ($Update) { $installerArgs += '--update' }
    if ($Data) { $installerArgs += @('--data', $Data) }
    if ($Media) { $installerArgs += @('--media', $Media) }
    if ($PSBoundParameters.ContainsKey('Port')) { $installerArgs += @('--port', "$Port") }
    if ($Version) { $installerArgs += @('--version', $Version) }
    if ($NoAi) { $installerArgs += '--no-ai' }
    if ($NoStart) { $installerArgs += '--no-start' }
    $bootstrap = @'
set -euo pipefail
ref=$(printf '%s' "$1" | base64 -d)
shift
args=()
for arg in "$@"; do args+=("$(printf '%s' "$arg" | base64 -d)"); done
curl -fsSL "https://raw.githubusercontent.com/flixermedia/flixer/$ref/install.sh" | bash -s -- "${args[@]}"
'@
    $encodedArgs = @($Ref) + $installerArgs | ForEach-Object { [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($_)) }
    (($bootstrap -replace "`r`n", "`n") + "`n#") | & wsl.exe @wslArgs --exec bash -s -- @encodedArgs
    if ($LASTEXITCODE -ne 0) { throw "Flixer installation failed inside WSL (exit $LASTEXITCODE)." }
    $config = @{ distro = $Distro; linuxDir = $LinuxDir } | ConvertTo-Json
    [IO.File]::WriteAllText((Join-Path $ManagementDir 'wsl-install.json'), $config, [Text.UTF8Encoding]::new($false))
    Move-Item -Force $temp $manager
} finally {
    if (Test-Path $temp) { Remove-Item -Force $temp }
}
Write-Host "Manage Flixer with: powershell -ExecutionPolicy Bypass -File `"$manager`""
