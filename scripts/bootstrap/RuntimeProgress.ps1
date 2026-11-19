function Open-DropItRuntimeProgress {
    Add-Type -AssemblyName System.Windows.Forms
    Add-Type -AssemblyName System.Drawing
    $script:runtimeCancelled = $false
    $script:runtimeInstalling = $false
    $script:runtimeForm = New-Object Windows.Forms.Form
    $script:runtimeForm.Text = 'DROP-IT'
    $script:runtimeForm.ClientSize = New-Object Drawing.Size(440, 130)
    $script:runtimeForm.StartPosition = 'CenterScreen'
    $script:runtimeForm.FormBorderStyle = 'FixedDialog'
    $script:runtimeForm.MaximizeBox = $false
    $script:runtimeForm.MinimizeBox = $false
    $script:runtimeLabel = New-Object Windows.Forms.Label
    $script:runtimeLabel.SetBounds(20, 18, 400, 36)
    $script:runtimeLabel.Text = '正在准备运行组件 / Preparing runtime components'
    $bar = New-Object Windows.Forms.ProgressBar
    $bar.SetBounds(20, 60, 400, 14)
    $bar.Style = 'Marquee'
    $script:runtimeCancel = New-Object Windows.Forms.Button
    $script:runtimeCancel.SetBounds(310, 90, 110, 28)
    $script:runtimeCancel.Text = '取消 / Cancel'
    $script:runtimeCancel.Add_Click({ $script:runtimeCancelled = $true })
    $script:runtimeForm.Add_FormClosing({ param($sender, $eventArgs)
        $eventArgs.Cancel = $true
        if (-not $script:runtimeInstalling) { $script:runtimeCancelled = $true }
    })
    $script:runtimeForm.Controls.AddRange(@($script:runtimeLabel, $bar, $script:runtimeCancel))
    $script:runtimeForm.Show()
    [Windows.Forms.Application]::DoEvents()
}

function Update-DropItRuntimeProgress {
    param([string]$Message, [switch]$Installing)
    $script:runtimeInstalling = [bool]$Installing
    if ($script:runtimeForm) {
        if ($Message) { $script:runtimeLabel.Text = $Message }
        $script:runtimeCancel.Enabled = -not $Installing
        [Windows.Forms.Application]::DoEvents()
    }
    if ($script:runtimeCancelled -and -not $Installing) { throw [OperationCanceledException]::new('Setup cancelled.') }
}

function Close-DropItRuntimeProgress {
    if ($script:runtimeForm) { $script:runtimeForm.Dispose(); $script:runtimeForm = $null }
}
