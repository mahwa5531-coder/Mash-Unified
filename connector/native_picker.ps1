# Mash Native Windows Folder Picker (QA-BUG-7)
param(
    [string]$Title = "Select Workspace Folder",
    [string]$InitialDirectory = ""
)

try {
    Add-Type -AssemblyName System.Windows.Forms
    $dialog = New-Object System.Windows.Forms.FolderBrowserDialog
    $dialog.Description = $Title
    $dialog.ShowNewFolderButton = $true
    if ($InitialDirectory -and (Test-Path $InitialDirectory)) {
        $dialog.SelectedPath = $InitialDirectory
    }
    if ($dialog.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) {
        [Console]::WriteLine($dialog.SelectedPath)
        exit 0
    }
} catch {
    exit 1
}
exit 0
