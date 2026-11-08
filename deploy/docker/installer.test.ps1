$ErrorActionPreference = 'Stop'
$root = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../..'))
$temp = Join-Path ([IO.Path]::GetTempPath()) ("flixer-wsl-test-" + [guid]::NewGuid())
New-Item -ItemType Directory $temp | Out-Null
$global:wslCalls = [Collections.Generic.List[object]]::new()
$global:failWsl = $false
$global:resetAnswer = 'yes'
function global:wsl.exe {
    $scriptText = @($input) -join "`n"
    $global:wslCalls.Add([pscustomobject]@{ Arguments = @($args); Script = $scriptText })
    $global:LASTEXITCODE = 0
    if ($global:failWsl) { $global:LASTEXITCODE = 7; return }
    if (($args -join ' ') -match 'printenv HOME') { return '/home/flixer user' }
    if ($scriptText -match 'echo existing; else echo new') { return 'existing' }
}
function global:Read-Host { param([string]$Prompt) return $global:resetAnswer }
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
    if (($decoded -join '|') -ne 'main|--yes|--dir|/home/flixer user/flixer|--ref|main|--port|8090|--no-ai|--no-start') { throw "Incorrect installer arguments: $decoded" }
    & (Join-Path $root 'install.ps1') -Yes -Distro Ubuntu -Update -ManagementDir (Join-Path $temp 'flixer-management')
    $bootstrap = $global:wslCalls | Where-Object { $_.Script -match 'flixermedia/flixer/\$ref/install.sh' } | Select-Object -Last 1
    $separator = [array]::IndexOf($bootstrap.Arguments, '-s')
    $decoded = @($bootstrap.Arguments[($separator + 1)..($bootstrap.Arguments.Length - 1)] | ForEach-Object { Decode $_ })
    if (($decoded -join '|') -ne 'main|--yes|--dir|/home/flixer user/flixer|--ref|main|--update') { throw "Incorrect update arguments: $decoded" }
    & (Join-Path $root 'install.ps1') -Yes -Distro Ubuntu -Fresh -ConfirmReset -ManagementDir (Join-Path $temp 'flixer-management')
    $bootstrap = $global:wslCalls | Where-Object { $_.Script -match 'flixermedia/flixer/\$ref/install.sh' } | Select-Object -Last 1
    $separator = [array]::IndexOf($bootstrap.Arguments, '-s')
    $decoded = @($bootstrap.Arguments[($separator + 1)..($bootstrap.Arguments.Length - 1)] | ForEach-Object { Decode $_ })
    if (($decoded -join '|') -notmatch '\|--fresh\|--confirm-reset') { throw "Reset confirmation was not forwarded: $decoded" }
    & (Join-Path $root 'install.ps1') -Distro Ubuntu -Fresh -NoAi -ManagementDir (Join-Path $temp 'flixer-management')
    $bootstraps = @($global:wslCalls | Where-Object { $_.Script -match 'flixermedia/flixer/\$ref/install.sh' })
    $preview = $bootstraps[$bootstraps.Count - 2]
    $separator = [array]::IndexOf($preview.Arguments, '-s')
    $decoded = @($preview.Arguments[($separator + 1)..($preview.Arguments.Length - 1)] | ForEach-Object { Decode $_ })
    if (($decoded -join '|') -notmatch '\|--confirm-reset\|--dry-run\|--no-start') { throw "Missing reset preview: $decoded" }
    $bootstrap = $bootstraps[$bootstraps.Count - 1]
    $separator = [array]::IndexOf($bootstrap.Arguments, '-s')
    $decoded = @($bootstrap.Arguments[($separator + 1)..($bootstrap.Arguments.Length - 1)] | ForEach-Object { Decode $_ })
    if (($decoded -join '|') -notmatch '\|--confirm-reset') { throw "Interactive confirmation was not forwarded: $decoded" }
    $global:resetAnswer = 'no'
    $failed = $false
    $before = @($global:wslCalls | Where-Object { $_.Script -match 'flixermedia/flixer/\$ref/install.sh' }).Count
    try { & (Join-Path $root 'install.ps1') -Distro Ubuntu -Fresh -NoAi -ManagementDir (Join-Path $temp 'flixer-management') } catch { $failed = $true }
    $after = @($global:wslCalls | Where-Object { $_.Script -match 'flixermedia/flixer/\$ref/install.sh' }).Count
    if (-not $failed -or $after -ne ($before + 1)) { throw 'Declined reset must run only the preview and fail.' }
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
    # The deliberately failed WSL mock leaves a nonzero native exit code.
    $global:LASTEXITCODE = 0
    Write-Host 'Windows WSL installer and management tests passed.'
} finally {
    Remove-Item -Recurse -Force $temp
    Remove-Item Function:\wsl.exe
    Remove-Item Function:\Invoke-WebRequest
    Remove-Item Function:\Read-Host
}
