Set-StrictMode -Version Latest

function Test-SourcePython {
    param([string]$Path, [string]$Version, [string]$Root, [string]$Logs)
    if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) { return $false }
    try {
        $probe = Invoke-SourceProcess $Path @('-I', '-c', 'import sys,struct,sysconfig; print("%s|%s|%s|%s" % (".".join(map(str,sys.version_info[:3])),struct.calcsize("P")*8,sys.implementation.name,int(bool(sysconfig.get_config_var("Py_GIL_DISABLED")))))') $Root $Logs 'python-version' -AllowFailure
        if ($probe.ExitCode -ne 0 -or $probe.Output -notmatch '^([0-9]+\.[0-9]+\.[0-9]+)\|64\|cpython\|0$') { return $false }
        $actual = [Version]$Matches[1]
        $minimum = [Version]$Version
        return $actual.Major -eq $minimum.Major -and $actual.Minor -eq $minimum.Minor -and $actual -ge $minimum
    } catch { return $false }
}

function Get-SourcePythonVersion {
    param([string]$Python, [string]$Root, [string]$Logs)
    $probe = Invoke-SourceProcess $Python @('-I', '-c', 'import sys; print(".".join(map(str,sys.version_info[:3])))') $Root $Logs 'python-version'
    return $probe.Output
}

function Get-SourcePython {
    param($Tool, [string]$EnvironmentRoot, [string]$Root, [string]$Logs, [switch]$Repair)
    $directory = Join-Path $EnvironmentRoot ('python-' + $Tool.version)
    $privatePython = Join-Path $directory 'tools/python.exe'
    $marker = Join-Path $directory 'dropit-extracted.json'
    $state = Read-SourceState $marker
    $candidates = @()
    if (-not $Repair) {
        if ($null -ne $state -and $state.fingerprint -eq $Tool.sha256) { $candidates += $privatePython }
        $commands = @(Get-Command python.exe -CommandType Application -All -ErrorAction SilentlyContinue)
        $candidates += @($commands | Where-Object { $_.Source -notmatch '\\WindowsApps\\' } | ForEach-Object { $_.Source })
        foreach ($hive in @('HKCU:', 'HKLM:')) {
            $registry = $hive + '\Software\Python\PythonCore\' + (($Tool.version -split '\.')[0..1] -join '.') + '\InstallPath'
            try {
                $candidate = (Get-ItemProperty -LiteralPath $registry -Name ExecutablePath -ErrorAction Stop).ExecutablePath
                if ($candidate) { $candidates += $candidate }
            } catch { }
        }
    }
    foreach ($candidate in ($candidates | Select-Object -Unique)) {
        if (Test-SourcePython $candidate $Tool.version $Root $Logs) { return $candidate }
    }
    Write-Host '[2/5] Downloading the verified private Python runtime...'
    # PSF's NuGet distribution includes pip/venv; it is not the embeddable ZIP.
    # Store the verified NuGet archive as .zip for Windows PowerShell's Expand-Archive.
    $archive = Join-Path $EnvironmentRoot ('downloads/python-' + $Tool.version + '.zip')
    Get-VerifiedDownload -Uri $Tool.url -Destination $archive -Sha256 $Tool.sha256 -OnProgress {
        param($received, $total)
        if ($total -gt 0) { Write-Progress -Activity 'Downloading Python' -PercentComplete ([int](100 * $received / $total)) }
    } | Out-Null
    Write-Progress -Activity 'Downloading Python' -Completed
    if ([IO.File]::Exists($marker)) { [IO.File]::Delete($marker) }
    Expand-Archive -LiteralPath $archive -DestinationPath $directory -Force
    if (-not (Test-DropItDownload -Path $privatePython -PublisherPattern 'Python Software Foundation')) { throw 'The extracted Python interpreter failed publisher verification.' }
    if (-not (Test-SourcePython $privatePython $Tool.version $Root $Logs)) { throw 'Python extraction did not produce the expected interpreter.' }
    Write-SourceState $marker @{ fingerprint = $Tool.sha256; version = $Tool.version }
    return $privatePython
}

function Test-SourceNode {
    param([string]$Path, [string]$Version, [string]$Root, [string]$Logs)
    if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) { return $false }
    $npm = Join-Path (Split-Path -Parent $Path) 'node_modules/npm/bin/npm-cli.js'
    if (-not (Test-Path -LiteralPath $npm -PathType Leaf)) { return $false }
    try {
        $probe = Invoke-SourceProcess $Path @('-p', 'process.versions.node + "|" + process.arch') $Root $Logs 'node-version' -AllowFailure
        return $probe.ExitCode -eq 0 -and $probe.Output -eq ($Version + '|x64')
    } catch { return $false }
}

function Get-SourceNode {
    param($Tool, [string]$EnvironmentRoot, [string]$Root, [string]$Logs, [switch]$Repair)
    $directory = Join-Path $EnvironmentRoot ('node-v' + $Tool.version + '-win-x64')
    $privateNode = Join-Path $directory 'node.exe'
    $marker = Join-Path $directory 'dropit-extracted.json'
    $state = Read-SourceState $marker
    $candidates = @()
    if (-not $Repair) {
        if ($null -ne $state -and $state.fingerprint -eq $Tool.sha256) { $candidates += $privateNode }
        $candidates += @(Get-Command node.exe -CommandType Application -All -ErrorAction SilentlyContinue | ForEach-Object { $_.Source })
    }
    foreach ($candidate in ($candidates | Select-Object -Unique)) {
        if (Test-SourceNode $candidate $Tool.version $Root $Logs) { return $candidate }
    }
    Write-Host '[2/5] Downloading the verified Node.js runtime...'
    $archive = Join-Path $EnvironmentRoot ('downloads/node-v' + $Tool.version + '-win-x64.zip')
    Get-VerifiedDownload -Uri $Tool.url -Destination $archive -Sha256 $Tool.sha256 -OnProgress {
        param($received, $total)
        if ($total -gt 0) { Write-Progress -Activity 'Downloading Node.js' -PercentComplete ([int](100 * $received / $total)) }
    } | Out-Null
    Write-Progress -Activity 'Downloading Node.js' -Completed
    # An interrupted extraction remains unready; extraction is safe to repeat.
    if ([IO.File]::Exists($marker)) { [IO.File]::Delete($marker) }
    Expand-Archive -LiteralPath $archive -DestinationPath $EnvironmentRoot -Force
    if (-not (Test-SourceNode $privateNode $Tool.version $Root $Logs)) { throw 'Node.js extraction did not produce the expected runtime.' }
    Write-SourceState $marker @{ fingerprint = $Tool.sha256; version = $Tool.version }
    return $privateNode
}

function Get-SourceVenv {
    param([string]$Python, [string]$Version, [string]$EnvironmentRoot, [string]$Root, [string]$Logs, [switch]$Repair)
    $requirements = Join-Path $Root 'backend/requirements-runtime.lock.txt'
    $buildRequirements = Join-Path $Root 'backend/requirements-bootstrap.lock.txt'
    if (-not (Test-Path -LiteralPath $requirements -PathType Leaf) -or -not (Test-Path -LiteralPath $buildRequirements -PathType Leaf)) { throw 'The dependency locks are missing from this source archive.' }
    $fingerprint = Get-SourceTextHash ($Version + '|' + [IO.File]::ReadAllText($requirements) + '|' + [IO.File]::ReadAllText($buildRequirements))
    $directory = Join-Path $EnvironmentRoot ('venv-' + $fingerprint.Substring(0, 16))
    $interpreter = Join-Path $directory 'Scripts/python.exe'
    $marker = Join-Path $directory 'dropit-ready.json'
    $state = Read-SourceState $marker
    $ready = -not $Repair -and $null -ne $state -and $state.fingerprint -eq $fingerprint -and (Test-SourcePython $interpreter $Version $Root $Logs)
    if ($ready) {
        $check = Invoke-SourceProcess $interpreter @('-I', '-c', 'import importlib.util; names=["fastapi","uvicorn","webview","requests","bs4","multipart","PIL","rapidocr_onnxruntime","websocket","pypdfium2"]; assert all(importlib.util.find_spec(n) for n in names)') $Root $Logs 'python-check' -AllowFailure
        $ready = $check.ExitCode -eq 0
    }
    if (-not $ready) {
        if ([IO.File]::Exists($marker)) { [IO.File]::Delete($marker) }
        Write-Host '[3/5] Preparing the isolated Python environment...'
        Invoke-SourceProcess $Python @('-I', '-m', 'venv', $directory) $Root $Logs 'venv' | Out-Null
        $env:PIP_CONFIG_FILE = 'NUL'
        $env:PIP_INDEX_URL = 'https://pypi.org/simple'
        $env:PIP_EXTRA_INDEX_URL = ''
        $env:PIP_TRUSTED_HOST = ''
        $env:PIP_DISABLE_PIP_VERSION_CHECK = '1'
        $env:PIP_CACHE_DIR = Join-Path $EnvironmentRoot 'pip-cache'
        Invoke-SourceProcess $interpreter @('-I', '-m', 'pip', 'install', '--require-hashes', '--only-binary=:all:', '--no-input', '--index-url', 'https://pypi.org/simple', '-r', $buildRequirements) $Root $Logs 'python-build-tools' | Out-Null
        $install = @('-I', '-m', 'pip', 'install', '--require-hashes', '--no-build-isolation', '--only-binary=:all:', '--no-binary=proxy-tools', '--no-input', '--force-reinstall', '--index-url', 'https://pypi.org/simple', '-r', $requirements)
        Invoke-SourceProcess $interpreter $install $Root $Logs 'python-dependencies' | Out-Null
        Invoke-SourceProcess $interpreter @('-I', '-m', 'pip', 'check') $Root $Logs 'python-dependency-check' | Out-Null
        Invoke-SourceProcess $interpreter @('-I', '-c', 'import fastapi,uvicorn,webview,requests,bs4,multipart,PIL,rapidocr_onnxruntime,websocket,pypdfium2,clr') $Root $Logs 'python-native-check' | Out-Null
        $currentFingerprint = Get-SourceTextHash ($Version + '|' + [IO.File]::ReadAllText($requirements) + '|' + [IO.File]::ReadAllText($buildRequirements))
        if ($currentFingerprint -ne $fingerprint) { throw 'Dependency locks changed during installation. Run the launcher again.' }
        Write-SourceState $marker @{ fingerprint = $fingerprint; python = $Version }
    } else { Write-Host '[3/5] Python dependencies are ready.' }
    return $interpreter
}
