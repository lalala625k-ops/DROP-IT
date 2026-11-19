param([switch]$CheckOnly, [switch]$Quiet, [switch]$NonInteractive)

$ErrorActionPreference = 'Stop'
# A PowerShell 7 parent may pass incompatible module paths to Windows PowerShell.
# Use only built-in/shared Windows modules in this child process.
$env:PSModulePath = (Join-Path $PSHOME 'Modules') + ';' + (Join-Path $env:ProgramFiles 'WindowsPowerShell/Modules')
. (Join-Path $PSScriptRoot 'RuntimeCommon.ps1')
. (Join-Path $PSScriptRoot 'RuntimeStatus.ps1')
. (Join-Path $PSScriptRoot 'RuntimeProgress.ps1')

function Write-RuntimeStatus {
    param([string]$Message)
    if (-not $Quiet) { Write-Host $Message }
    if ($script:runtimeLog) {
        Add-Content -LiteralPath $script:runtimeLog -Value ("{0:u} {1}" -f (Get-Date), $Message) -Encoding UTF8
    }
}

function Install-DropItRuntimeComponent {
    param([string]$Name, [string]$Uri, [string]$Filename, [string[]]$Arguments, [switch]$Elevated)
    Write-RuntimeStatus ("Downloading and verifying {0}..." -f $Name)
    Update-DropItRuntimeProgress ("正在下载 / Downloading {0}" -f $Name)
    $download = Get-VerifiedDownload -Uri $Uri -Destination (Join-Path $script:runtimeCache $Filename) `
        -PublisherPattern '(^|,\s*)CN=Microsoft Corporation(,|$)' -OnProgress {
            param($received, $total)
            Update-DropItRuntimeProgress
        }
    Write-RuntimeStatus ("Installing {0}..." -f $Name)
    Update-DropItRuntimeProgress ("正在安装 / Installing {0}" -f $Name) -Installing
    $code = Invoke-DropItInstaller -Path $download -Arguments $Arguments -Elevated:$Elevated -OnWaiting {
        Update-DropItRuntimeProgress -Installing
    }
    if ($code -in @(1641, 3010)) { return 3010 }
    if ($code -ne 0) { throw ("{0} installer failed (exit {1})." -f $Name, $code) }
    return 0
}

$mutex = $null; $ownsMutex = $false; $result = 1
try {
    Assert-DropItWindows
    $status = Get-DropItRuntimeStatus
    if ($CheckOnly) {
        $status | ConvertTo-Json -Compress
        if ($status.Ready) { exit 0 }; exit 1
    }
    if ($status.Ready) { if (-not $Quiet) { Write-Host 'Runtime components are ready.' }; exit 0 }
    $root = Get-DropItBootstrapRoot
    $script:runtimeCache = Join-Path $root 'downloads'
    [IO.Directory]::CreateDirectory((Join-Path $root 'logs')) | Out-Null
    $script:runtimeLog = Join-Path $root 'logs\runtime-setup.log'
    $mutex = New-Object Threading.Mutex($false, 'Local\DropItRuntimeSetup')
    try { $ownsMutex = $mutex.WaitOne(1200000) } catch [Threading.AbandonedMutexException] { $ownsMutex = $true }
    if (-not $ownsMutex) { throw 'Another runtime setup is still running. Please retry when it finishes.' }
    do {
        $retry = $false
        try {
            $status = Get-DropItRuntimeStatus
            if ($status.Ready) { $result = 0; break }
            if (-not $NonInteractive) { Open-DropItRuntimeProgress }
            if ($status.NetFrameworkRelease -lt 394802) {
                $result = Install-DropItRuntimeComponent '.NET Framework 4.8' `
                    'https://go.microsoft.com/fwlink/?linkid=2088631' 'ndp48-installer.exe' @('/q', '/norestart') -Elevated
                if ($result -eq 3010) { break }
                if ((Get-DropItRuntimeStatus).NetFrameworkRelease -lt 394802) { throw '.NET Framework is still unavailable after installation.' }
            }
            if (-not (Get-DropItRuntimeStatus).VcRuntimeVersion) {
                $result = Install-DropItRuntimeComponent 'Microsoft Visual C++ x64 Runtime' `
                    'https://aka.ms/vs/17/release/vc_redist.x64.exe' 'vc_redist.x64.exe' @('/install', '/quiet', '/norestart') -Elevated
                if ($result -eq 3010) { break }
                if (-not (Get-DropItRuntimeStatus).VcRuntimeVersion) { throw 'Microsoft Visual C++ x64 Runtime is still unavailable after installation.' }
            }
            if (-not (Get-DropItRuntimeStatus).WebView2) {
                $result = Install-DropItRuntimeComponent 'Microsoft Edge WebView2 Runtime' `
                    'https://go.microsoft.com/fwlink/p/?LinkId=2124703' 'MicrosoftEdgeWebview2Setup.exe' @('/silent', '/install')
                if ($result -eq 3010) { break }
            }
            $status = Get-DropItRuntimeStatus
            if (-not $status.Ready) { throw 'Runtime verification failed after installation. A Windows restart or administrator policy change may be needed.' }
            $result = 0
            Write-RuntimeStatus 'Runtime components are ready.'
        } catch {
            $result = 1
            Close-DropItRuntimeProgress
            Write-RuntimeStatus $_.Exception.Message
            if (-not $NonInteractive -and $_.Exception -isnot [OperationCanceledException]) {
                Add-Type -AssemblyName System.Windows.Forms
                $message = "运行组件准备失败 / Runtime setup failed.`n`n$($_.Exception.Message)`n`n日志 / Log: $script:runtimeLog"
                $retry = [Windows.Forms.MessageBox]::Show($message, 'DROP-IT', 'RetryCancel', 'Error') -eq 'Retry'
            }
        } finally { Close-DropItRuntimeProgress }
    } while ($retry)
    if ($result -eq 3010) {
        Write-RuntimeStatus 'Restart Windows, then launch DROP-IT again.'
        if (-not $NonInteractive) {
            Add-Type -AssemblyName System.Windows.Forms
            [Windows.Forms.MessageBox]::Show('请重启 Windows 后再次启动 DROP-IT。 / Restart Windows, then launch DROP-IT again.', 'DROP-IT') | Out-Null
        }
    }
} catch {
    Write-Error -Message $_.Exception.Message -ErrorAction Continue
    $result = 1
} finally {
    Close-DropItRuntimeProgress
    if ($ownsMutex) { $mutex.ReleaseMutex() }
    if ($mutex) { $mutex.Dispose() }
}
exit $result
