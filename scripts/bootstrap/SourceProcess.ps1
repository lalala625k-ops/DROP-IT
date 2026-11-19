Set-StrictMode -Version Latest

function Get-SourceTextHash {
    param([Parameter(Mandatory = $true)][string]$Text)
    $sha = [Security.Cryptography.SHA256]::Create()
    try {
        return ([BitConverter]::ToString($sha.ComputeHash([Text.Encoding]::UTF8.GetBytes($Text)))).Replace('-', '').ToLowerInvariant()
    } finally { $sha.Dispose() }
}

function ConvertTo-SourceArgument {
    param([AllowEmptyString()][string]$Value)
    # CommandLineToArgvW quoting, including quotes and trailing backslashes.
    return '"' + ([regex]::Replace([regex]::Replace($Value, '(\\*)"', '$1$1\"'), '(\\+)$', '$1$1')) + '"'
}

function Invoke-SourceProcess {
    param(
        [Parameter(Mandatory = $true)][string]$Executable,
        [string[]]$Arguments = @(),
        [Parameter(Mandatory = $true)][string]$WorkingDirectory,
        [Parameter(Mandatory = $true)][string]$LogDirectory,
        [string]$Label = 'process',
        [switch]$AllowFailure
    )
    [IO.Directory]::CreateDirectory($LogDirectory) | Out-Null
    $name = '{0}-{1}-{2}' -f (Get-Date -Format 'yyyyMMdd-HHmmss'), $Label, ([guid]::NewGuid().ToString('N').Substring(0, 8))
    $stdout = Join-Path $LogDirectory ($name + '.out.log')
    $stderr = Join-Path $LogDirectory ($name + '.err.log')
    $quoted = @($Arguments | ForEach-Object { ConvertTo-SourceArgument $_ }) -join ' '
    $process = $null
    $timer = [Diagnostics.Stopwatch]::StartNew()
    try {
        $process = Start-Process -FilePath $Executable -ArgumentList $quoted -WorkingDirectory $WorkingDirectory `
            -WindowStyle Hidden -PassThru -RedirectStandardOutput $stdout -RedirectStandardError $stderr
        # Keep the OS handle open; Windows PowerShell otherwise loses ExitCode for short processes.
        $handle = $process.Handle
        while (-not $process.WaitForExit(250)) {
            if ($Label -ne 'application' -and $timer.Elapsed.TotalSeconds -ge 3) {
                Write-Progress -Activity ('DROP-IT: ' + $Label) -Status ('Working... ' + [int]$timer.Elapsed.TotalSeconds + ' s. Press Ctrl+C to cancel.')
            }
        }
        $process.WaitForExit()
        $exitCode = $process.ExitCode
        $outputText = [IO.File]::ReadAllText($stdout).Trim()
        $errorText = [IO.File]::ReadAllText($stderr).Trim()
        $result = [pscustomobject]@{
            ExitCode = $exitCode
            Output = $outputText
            Error = $errorText
            LogPath = $(if ($errorText) { $stderr } else { $stdout })
        }
        if (-not $AllowFailure -and $exitCode -ne 0) {
            throw ('{0} failed (exit {1}). Details: {2}' -f $Label, $exitCode, $result.LogPath)
        }
        return $result
    } finally {
        Write-Progress -Activity ('DROP-IT: ' + $Label) -Completed
        $timer.Stop()
        if ($null -ne $process) {
            if (-not $process.HasExited) {
                # Only stop the process tree created by this invocation on cancellation.
                $stopper = Start-Process -FilePath (Join-Path $env:SystemRoot 'System32/taskkill.exe') `
                    -ArgumentList @('/PID', [string]$process.Id, '/T', '/F') -WindowStyle Hidden -PassThru
                $stopper.WaitForExit()
            }
            $process.Dispose()
        }
    }
}

function Read-SourceState {
    param([string]$Path)
    if (Test-Path -LiteralPath $Path -PathType Leaf) {
        try {
            $state = Get-Content -LiteralPath $Path -Raw -Encoding UTF8 | ConvertFrom-Json
            if ($null -ne $state -and $state.PSObject.Properties['fingerprint'] -and $state.fingerprint -is [string]) { return $state }
        } catch { }
    }
    return $null
}

function Write-SourceState {
    param([string]$Path, $Value)
    $temporary = $Path + '.' + [guid]::NewGuid().ToString('N') + '.tmp'
    try {
        [IO.File]::WriteAllText($temporary, ($Value | ConvertTo-Json -Depth 10), (New-Object Text.UTF8Encoding($false)))
        if ([IO.File]::Exists($Path)) { [IO.File]::Replace($temporary, $Path, [System.Management.Automation.Language.NullString]::Value) }
        else { [IO.File]::Move($temporary, $Path) }
    } finally { if ([IO.File]::Exists($temporary)) { [IO.File]::Delete($temporary) } }
}
