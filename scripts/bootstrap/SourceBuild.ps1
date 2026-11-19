Set-StrictMode -Version Latest

function Get-FrontendFingerprint {
    param([string]$Frontend)
    $paths = @(Get-ChildItem -LiteralPath (Join-Path $Frontend 'src'), (Join-Path $Frontend 'public') -File -Recurse)
    $paths += @(Get-ChildItem -LiteralPath $Frontend -File | Where-Object { $_.Extension -in @('.json', '.js', '.mjs', '.ts', '.html') })
    $lines = @($paths | Sort-Object FullName | ForEach-Object {
        $_.FullName.Substring($Frontend.Length) + '|' + (Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256).Hash
    })
    return Get-SourceTextHash ($lines -join "`n")
}

function Get-FrontendOutputFingerprint {
    param([string]$Frontend)
    $outputDirectory = Join-Path $Frontend 'dist'
    if (-not (Test-Path -LiteralPath $outputDirectory -PathType Container)) { return '' }
    $lines = @(Get-ChildItem -LiteralPath $outputDirectory -Recurse -File | Sort-Object FullName | ForEach-Object {
        $_.FullName.Substring($outputDirectory.Length) + '|' + (Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256).Hash
    })
    return Get-SourceTextHash ($lines -join "`n")
}

function Initialize-SourceFrontend {
    param([string]$Node, [string]$Version, [string]$EnvironmentRoot, [string]$Root, [string]$Logs, [switch]$Repair)
    $frontend = Join-Path $Root 'frontend'
    $npm = Join-Path (Split-Path -Parent $Node) 'node_modules/npm/bin/npm-cli.js'
    $env:PATH = (Split-Path -Parent $Node) + ';' + $env:PATH
    $env:npm_config_cache = Join-Path $EnvironmentRoot 'npm-cache'
    $dependencyFingerprint = Get-SourceTextHash ($Version + '|' + [IO.File]::ReadAllText((Join-Path $frontend 'package.json')) + '|' + [IO.File]::ReadAllText((Join-Path $frontend 'package-lock.json')))
    $dependencyMarker = Join-Path $EnvironmentRoot 'frontend-dependencies.json'
    $state = Read-SourceState $dependencyMarker
    $dependenciesReady = -not $Repair -and $null -ne $state -and $state.fingerprint -eq $dependencyFingerprint `
        -and (Test-Path -LiteralPath (Join-Path $frontend 'node_modules/vite/bin/vite.js')) `
        -and (Test-Path -LiteralPath (Join-Path $frontend 'node_modules/typescript/bin/tsc'))
    if (-not $dependenciesReady) {
        if ([IO.File]::Exists($dependencyMarker)) { [IO.File]::Delete($dependencyMarker) }
        Write-Host '[4/5] Installing frontend dependencies...'
        Invoke-SourceProcess $Node @($npm, 'ci', '--no-audit', '--no-fund') $frontend $Logs 'frontend-dependencies' | Out-Null
        Write-SourceState $dependencyMarker @{ fingerprint = $dependencyFingerprint; node = $Version }
    } else { Write-Host '[4/5] Frontend dependencies are ready.' }
    $fingerprint = Get-FrontendFingerprint $frontend
    $buildMarker = Join-Path $EnvironmentRoot 'frontend-build.json'
    $buildState = Read-SourceState $buildMarker
    $indexPath = Join-Path $frontend 'dist/index.html'
    $buildReady = -not $Repair -and $dependenciesReady -and $null -ne $buildState -and $buildState.fingerprint -eq $fingerprint `
        -and $buildState.PSObject.Properties['output'] -and (Test-Path -LiteralPath $indexPath -PathType Leaf) `
        -and $buildState.output -eq (Get-FrontendOutputFingerprint $frontend)
    if (-not $buildReady) {
        if ([IO.File]::Exists($buildMarker)) { [IO.File]::Delete($buildMarker) }
        Write-Host '[5/5] Building the application interface...'
        Invoke-SourceProcess $Node @($npm, 'run', 'build') $frontend $Logs 'frontend-build' | Out-Null
        if (-not (Test-Path -LiteralPath $indexPath -PathType Leaf)) { throw 'The frontend build finished without producing index.html.' }
        if ((Get-FrontendFingerprint $frontend) -ne $fingerprint) { throw 'Source files changed during the build. Run the launcher again to rebuild.' }
        Write-SourceState $buildMarker @{ fingerprint = $fingerprint; output = (Get-FrontendOutputFingerprint $frontend); node = $Version }
    } else { Write-Host '[5/5] The interface is already built.' }
}
