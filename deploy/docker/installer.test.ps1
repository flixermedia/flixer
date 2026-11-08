$ErrorActionPreference = 'Stop'
$root = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../..'))
$temp = Join-Path ([IO.Path]::GetTempPath()) ("flixer-wsl-test-" + [guid]::NewGuid())
New-Item -ItemType Directory $temp | Out-Null
$global:wslCalls = [Collections.Generic.List[object]]::new()
$global:failWsl = $false
function global:wsl.exe {
    $scriptText = @($input) -join "`n"
    $global:wslCalls.Add([pscustomobject]@{ Arguments = @($args); Script = $scriptText })
    $global:LASTEXITCODE = 0
    if ($global:failWsl) { $global:LASTEXITCODE = 7; return }
    if (($args -join ' ') -match 'printenv HOME') { return '/home/flixer user' }
}
function global:Invoke-WebRequest {
    param([switch]$UseBasicParsing, [string]$Uri, [string]$OutFile)
    if ($Uri -notmatch '/manage.ps1$') { throw "Unexpected download $Uri" }
    Copy-Item (Join-Path $root 'manage.ps1') $OutFile
}
function Decode([string]$value) { [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($value)) }
try {
    & (Join-Path $root 'install.ps1') -Yes -Distro Ubuntu -NoAi -NoStart -Port 8090 -ManagementDir (Join-Path $temp 'flixer-management')
    $manager = Join-Path $temp 'flixer-management/manage.ps1'
    $config = Get-Content -Raw (Join-Path $temp 'flixer-management/wsl-install.json') | ConvertFrom-Json
    if ($config.distro -ne 'Ubuntu' -or $config.linuxDir -ne '/home/flixer user/flixer') { throw 'WSL configuration was not saved correctly.' }
    $bootstrap = $global:wslCalls | Where-Object { $_.Script -match 'flixermedia/flixer/\$ref/install.sh' } | Select-Object -Last 1
    if (-not $bootstrap) { throw 'WSL installer was not invoked.' }
    $separator = [array]::IndexOf($bootstrap.Arguments, '-s')
    if ($separator -lt 0) { throw "Missing argument separator: $($bootstrap.Arguments -join '|')" }
    $decoded = @($bootstrap.Arguments[($separator + 1)..($bootstrap.Arguments.Length - 1)] | ForEach-Object { Decode $_ })
    if (($decoded -join '|') -ne 'main|--yes|--dir|/home/flixer user/flixer|--port|8090|--ref|main|--no-ai|--no-start') { throw "Incorrect installer arguments: $decoded" }
    foreach ($action in @('start', 'stop', 'restart', 'update', 'status')) { & $manager $action }
    $management = @($global:wslCalls | Where-Object { $_.Script -match 'manage.sh' })
    if ($management.Count -ne 5) { throw 'Not all management actions were invoked.' }
    foreach ($call in $management) {
        $separator = [array]::IndexOf($call.Arguments, '-s')
        if ((Decode $call.Arguments[$separator + 1]) -ne $config.linuxDir) { throw 'WSL path was not preserved.' }
        if (($call.Arguments -join '|') -notmatch '--distribution\|Ubuntu') { throw 'Selected distribution was not preserved.' }
    }
    $global:failWsl = $true
    $failed = $false
    try { & $manager update } catch { $failed = $true }
    if (-not $failed) { throw 'WSL failures must fail management.' }
    $failed = $false
    try { & (Join-Path $root 'install.ps1') -Yes } catch { $failed = $true }
    if (-not $failed) { throw 'WSL preflight failures must fail installation.' }
    Write-Host 'Windows WSL installer and management tests passed.'
} finally {
    Remove-Item -Recurse -Force $temp
    Remove-Item Function:\wsl.exe
    Remove-Item Function:\Invoke-WebRequest
}
