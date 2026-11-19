[CmdletBinding()]
param([switch]$Dev, [switch]$PrepareOnly, [switch]$Repair, [switch]$NonInteractive)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
# A launcher invoked from PowerShell 7 can inherit its incompatible module path.
# Use Windows PowerShell's built-in modules for hashing and archive extraction.
$env:PSModulePath = (Join-Path $PSHOME 'Modules') + ';' + (Join-Path ([Environment]::GetFolderPath('ProgramFiles')) 'WindowsPowerShell/Modules')
. (Join-Path $PSScriptRoot 'RuntimeCommon.ps1')
. (Join-Path $PSScriptRoot 'RuntimeStatus.ps1')
. (Join-Path $PSScriptRoot 'SourceProcess.ps1')
. (Join-Path $PSScriptRoot 'SourceEnvironment.ps1')
. (Join-Path $PSScriptRoot 'SourceBuild.ps1')

$sourceRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../..')).TrimEnd('\', '/')
$sourceIdentity = (Get-SourceTextHash $sourceRoot.ToLowerInvariant()).Substring(0, 20)
$bootstrapRoot = Get-DropItBootstrapRoot
$sourceHome = Join-Path $bootstrapRoot ('source-' + $sourceIdentity)
$logs = Join-Path $sourceHome 'logs'
$powershell = Join-Path $env:SystemRoot 'System32/WindowsPowerShell/v1.0/powershell.exe'
$lock = $null
$exitCode = 1
$env:PYTHONUTF8 = '1'
$env:PYTHONDONTWRITEBYTECODE = '1'
$env:PYTHONNOUSERSITE = '1'
$env:PYTHONHOME = $null
$env:PYTHONPATH = $null
$env:DROPIT_BOOTSTRAPPED = '1'
[IO.Directory]::CreateDirectory($sourceHome) | Out-Null

try {
    Assert-DropItWindows
    try {
        $lock = [IO.File]::Open((Join-Path $sourceHome 'prepare.lock'), [IO.FileMode]::OpenOrCreate, [IO.FileAccess]::ReadWrite, [IO.FileShare]::None)
    } catch [IO.IOException] {
        Write-Host 'DROP-IT is already preparing this source folder. Use the first launcher window.'
        exit 0
    }
    while ($true) {
        try {
            $readyMarker = Join-Path $sourceHome 'ready.json'
            if ([IO.File]::Exists($readyMarker)) { [IO.File]::Delete($readyMarker) }
            Write-Host 'DROP-IT - preparing this source folder. The first launch needs an internet connection.'
            Write-Host ('Preparation logs: ' + $logs)
            $toolchain = Get-Content -LiteralPath (Join-Path $PSScriptRoot 'toolchain.json') -Raw -Encoding UTF8 | ConvertFrom-Json
            Write-Host '[1/5] Checking Windows runtime components...'
            $runtime = Invoke-SourceProcess $powershell @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', (Join-Path $PSScriptRoot 'Ensure-Runtime.ps1'), '-NonInteractive') $sourceRoot $logs 'windows-runtime' -AllowFailure
            if ($runtime.ExitCode -eq 3010) {
                Write-Host 'Windows needs to restart before DROP-IT can open. Restart and run this launcher again.'
                $exitCode = 3010
                break
            }
            if ($runtime.ExitCode -ne 0) { throw ('Windows runtime setup did not finish. Details: ' + $runtime.LogPath) }
            Write-Host '[2/5] Checking Python and Node.js...'
            $python = Get-SourcePython $toolchain.python $sourceHome $sourceRoot $logs -Repair:$Repair
            $pythonVersion = Get-SourcePythonVersion $python $sourceRoot $logs
            $node = Get-SourceNode $toolchain.node $sourceHome $sourceRoot $logs -Repair:$Repair
            $interpreter = Get-SourceVenv $python $pythonVersion $sourceHome $sourceRoot $logs -Repair:$Repair
            Initialize-SourceFrontend $node $toolchain.node.version $sourceHome $sourceRoot $logs -Repair:$Repair
            Write-SourceState $readyMarker @{ source = $sourceRoot; python = $interpreter; node = $node; ready = $true }
            $exitCode = 0
            break
        } catch {
            Write-Host ('Preparation failed: ' + $_.Exception.Message) -ForegroundColor Red
            Write-Host ('Logs: ' + $logs)
            if ($_.Exception.Data.Contains('DropItExitCode') -and $_.Exception.Data['DropItExitCode'] -eq 3010) { $exitCode = 3010; break }
            if ($PrepareOnly -or $NonInteractive -or [Console]::IsInputRedirected) { break }
            $answer = Read-Host 'Press Enter to retry, or type Q to cancel'
            if ($answer -match '^(q|quit|cancel)$') { break }
        }
    }
} catch {
    Write-Host $_.Exception.Message -ForegroundColor Red
} finally {
    if ($null -ne $lock) { $lock.Dispose() }
}

if ($exitCode -eq 0 -and -not $PrepareOnly) {
    try {
        Write-Host 'Opening DROP-IT...'
        $appArguments = @('-I', (Join-Path $sourceRoot 'desktop/app.py'))
        if ($Dev) { $appArguments += '--dev' } else { $appArguments += '--production' }
        $result = Invoke-SourceProcess $interpreter $appArguments $sourceRoot $logs 'application' -AllowFailure
        $exitCode = $result.ExitCode
        if ($exitCode -ne 0) { Write-Host ('DROP-IT could not start. Details: ' + $result.LogPath) -ForegroundColor Red }
    } catch { Write-Host $_.Exception.Message -ForegroundColor Red; $exitCode = 1 }
} elseif ($exitCode -eq 0) { Write-Host 'DROP-IT is ready. No application window was opened.' }
exit $exitCode
