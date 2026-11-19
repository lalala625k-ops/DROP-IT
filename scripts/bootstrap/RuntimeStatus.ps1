function Get-DropItRegistryValue {
    param([Microsoft.Win32.RegistryHive]$Hive, [Microsoft.Win32.RegistryView]$View,
          [string]$Key, [string]$Name)
    $base = $null; $entry = $null
    try {
        $base = [Microsoft.Win32.RegistryKey]::OpenBaseKey($Hive, $View)
        $entry = $base.OpenSubKey($Key)
        if ($entry) { return $entry.GetValue($Name, $null) }
    } catch { return $null }
    finally { if ($entry) { $entry.Dispose() }; if ($base) { $base.Dispose() } }
}

function Get-DropItVcRuntimeVersion {
    # This floor is the runtime used to validate the locked native Python wheels.
    $minimum = [Version]'14.40.33816.0'
    $lowest = $null
    $systemDirectory = Join-Path $env:SystemRoot 'System32'
    if (-not [Environment]::Is64BitProcess) { $systemDirectory = Join-Path $env:SystemRoot 'Sysnative' }
    foreach ($name in @('msvcp140.dll', 'msvcp140_1.dll', 'vcruntime140.dll', 'vcruntime140_1.dll')) {
        $path = Join-Path $systemDirectory $name
        if (-not [IO.File]::Exists($path)) { return $null }
        try {
            $info = [Diagnostics.FileVersionInfo]::GetVersionInfo($path)
            $version = [Version]('{0}.{1}.{2}.{3}' -f $info.FileMajorPart, $info.FileMinorPart, $info.FileBuildPart, $info.FilePrivatePart)
            if ($version -lt $minimum) { return $null }
            if (-not $lowest -or $version -lt $lowest) { $lowest = $version }
        } catch { return $null }
    }
    return $lowest.ToString()
}

function Get-DropItRuntimeStatus {
    $views = @([Microsoft.Win32.RegistryView]::Registry32, [Microsoft.Win32.RegistryView]::Registry64)
    $webview = $null
    $release = 0
    foreach ($view in $views) {
        $number = Get-DropItRegistryValue LocalMachine $view 'SOFTWARE\Microsoft\NET Framework Setup\NDP\v4\Full' 'Release'
        if ($number -and [int]$number -gt $release) { $release = [int]$number }
        foreach ($hive in @('CurrentUser', 'LocalMachine')) {
            $value = Get-DropItRegistryValue $hive $view 'SOFTWARE\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}' 'pv'
            $parsed = $null
            if ([Version]::TryParse([string]$value, [ref]$parsed) -and $parsed -gt [Version]'0.0.0.0') {
                if (-not $webview -or $parsed -gt [Version]$webview) { $webview = $parsed.ToString() }
            }
        }
    }
    $vcRuntime = Get-DropItVcRuntimeVersion
    return [pscustomobject]@{ WebView2 = $webview; NetFrameworkRelease = $release; VcRuntimeVersion = $vcRuntime; Ready = [bool]($webview -and $release -ge 394802 -and $vcRuntime) }
}

function Assert-DropItWindows {
    $architecture = if ($env:PROCESSOR_ARCHITEW6432) { $env:PROCESSOR_ARCHITEW6432 } else { $env:PROCESSOR_ARCHITECTURE }
    if ([Environment]::OSVersion.Platform -ne [PlatformID]::Win32NT -or $architecture -ne 'AMD64') {
        throw 'DROP-IT currently supports Windows 10/11 x64 only.'
    }
    $build = Get-DropItRegistryValue LocalMachine Registry64 'SOFTWARE\Microsoft\Windows NT\CurrentVersion' 'CurrentBuildNumber'
    if (-not $build -or [int]$build -lt 10240) { throw 'DROP-IT requires Windows 10 or later.' }
}
