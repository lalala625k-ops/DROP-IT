# Shared by source preparation and the installed application's runtime setup.
function Get-DropItBootstrapRoot {
    if ($env:DROPIT_BOOTSTRAP_HOME) { return [IO.Path]::GetFullPath($env:DROPIT_BOOTSTRAP_HOME) }
    return Join-Path ([Environment]::GetFolderPath('LocalApplicationData')) 'DropIt\bootstrap'
}

function Test-DropItDownload {
    param([string]$Path, [string]$Sha256, [string]$PublisherPattern)
    if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) { return $false }
    if ((Get-Item -LiteralPath $Path).Length -eq 0) { return $false }
    if ($Sha256 -and (Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash -ne $Sha256) { return $false }
    if ($PublisherPattern) {
        $signature = Get-AuthenticodeSignature -LiteralPath $Path
        if ($signature.Status -ne 'Valid' -or -not $signature.SignerCertificate -or
            $signature.SignerCertificate.Subject -notmatch $PublisherPattern) { return $false }
    }
    return $true
}

function Get-VerifiedDownload {
    param(
        [Parameter(Mandatory=$true)][string]$Uri,
        [Parameter(Mandatory=$true)][string]$Destination,
        [string]$Sha256,
        [string]$PublisherPattern,
        [scriptblock]$OnProgress
    )
    if (([Uri]$Uri).Scheme -ne 'https') { throw 'Component downloads require HTTPS.' }
    if (-not $Sha256 -and -not $PublisherPattern) { throw 'A checksum or trusted publisher is required.' }
    if ($Sha256 -and $Sha256 -notmatch '^[a-fA-F0-9]{64}$') { throw 'Invalid SHA-256 checksum.' }
    $Destination = [IO.Path]::GetFullPath($Destination)
    if (Test-DropItDownload $Destination $Sha256 $PublisherPattern) { return $Destination }
    [IO.Directory]::CreateDirectory([IO.Path]::GetDirectoryName($Destination)) | Out-Null
    $part = $Destination + '.' + [Guid]::NewGuid().ToString('N') + '.part'
    $oldTls = [Net.ServicePointManager]::SecurityProtocol
    try {
        [Net.ServicePointManager]::SecurityProtocol = $oldTls -bor [Net.SecurityProtocolType]::Tls12
        for ($attempt = 1; $attempt -le 3; $attempt++) {
            $response = $null; $inputStream = $null; $outputStream = $null
            try {
                $request = [Net.HttpWebRequest]::Create($Uri)
                $request.Timeout = 30000
                $request.ReadWriteTimeout = 30000
                $request.UserAgent = 'DropIt-Setup/0.1'
                $response = $request.GetResponse()
                if ($response.ResponseUri.Scheme -ne 'https') { throw 'The download redirected outside HTTPS.' }
                $inputStream = $response.GetResponseStream()
                $outputStream = [IO.File]::Open($part, [IO.FileMode]::Create, [IO.FileAccess]::Write, [IO.FileShare]::None)
                $buffer = New-Object byte[] 65536
                $received = 0L
                while (($count = $inputStream.Read($buffer, 0, $buffer.Length)) -gt 0) {
                    $outputStream.Write($buffer, 0, $count)
                    $received += $count
                    if ($OnProgress) { & $OnProgress $received $response.ContentLength }
                }
                $outputStream.Dispose(); $outputStream = $null
                if (-not (Test-DropItDownload $part $Sha256 $PublisherPattern)) {
                    throw 'The downloaded component failed checksum or publisher verification.'
                }
                Move-Item -LiteralPath $part -Destination $Destination -Force
                return $Destination
            } catch {
                if ($_.Exception -is [OperationCanceledException] -or $attempt -eq 3) { throw }
                Start-Sleep -Seconds $attempt
            } finally {
                if ($outputStream) { $outputStream.Dispose() }
                if ($inputStream) { $inputStream.Dispose() }
                if ($response) { $response.Dispose() }
            }
        }
    } finally {
        [Net.ServicePointManager]::SecurityProtocol = $oldTls
        if (Test-Path -LiteralPath $part) { Remove-Item -LiteralPath $part -Force }
    }
}

function ConvertTo-DropItArgument {
    param([AllowEmptyString()][string]$Value)
    # Windows CommandLineToArgvW quoting, including spaces and trailing slashes.
    if ($Value.Length -gt 0 -and $Value -notmatch '[\s"]') { return $Value }
    $escaped = [regex]::Replace($Value, '(\\*)"', '${1}${1}\"')
    $escaped = [regex]::Replace($escaped, '(\\+)$', '${1}${1}')
    return '"' + $escaped + '"'
}

function Invoke-DropItInstaller {
    param([string]$Path, [string[]]$Arguments, [switch]$Elevated, [scriptblock]$OnWaiting)
    $start = @{
        FilePath = $Path
        ArgumentList = (($Arguments | ForEach-Object { ConvertTo-DropItArgument $_ }) -join ' ')
        PassThru = $true
        WindowStyle = 'Hidden'
    }
    if ($Elevated) { $start.Verb = 'RunAs' }
    $process = Start-Process @start
    try {
        # Keep a process handle before a short-lived installer can exit (PowerShell 5.1).
        $handle = $process.Handle
        while (-not $process.WaitForExit(200)) {
            if ($OnWaiting) { & $OnWaiting }
        }
        $process.WaitForExit()
        return $process.ExitCode
    } finally { $process.Dispose() }
}
