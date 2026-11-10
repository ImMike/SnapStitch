# Builds the upload for the Chrome Web Store and Edge Add-ons:
# dist\SnapStitch-<version>.zip with only what the extension runs (manifest.json,
# src\, icons\) and nothing else from this repo (no desktop app, tests or docs).
# Run from anywhere: powershell -File tools\package-extension.ps1
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.IO.Compression, System.IO.Compression.FileSystem

$root = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$version = (Get-Content (Join-Path $root 'manifest.json') -Raw | ConvertFrom-Json).version
$outDir = Join-Path $root 'dist'
New-Item -ItemType Directory -Force $outDir | Out-Null
$zipPath = Join-Path $outDir "SnapStitch-$version.zip"
if (Test-Path $zipPath) { Remove-Item $zipPath }

$files = @(Get-Item (Join-Path $root 'manifest.json')) +
  @(Get-ChildItem (Join-Path $root 'src'), (Join-Path $root 'icons') -Recurse -File)
# Not Compress-Archive: Windows PowerShell writes backslashes into entry names,
# which the stores can reject. Zip entries use forward slashes.
$zip = [System.IO.Compression.ZipFile]::Open($zipPath, 'Create')
try {
  foreach ($file in $files) {
    $name = $file.FullName.Substring($root.Length + 1).Replace('\', '/')
    [void][System.IO.Compression.ZipFileExtensions]::CreateEntryFromFile($zip, $file.FullName, $name, 'Optimal')
  }
} finally {
  $zip.Dispose()
}
Write-Output "wrote $zipPath ($($files.Count) files, $([math]::Round((Get-Item $zipPath).Length / 1KB)) KB)"
