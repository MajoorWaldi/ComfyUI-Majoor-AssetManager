$ErrorActionPreference = "Stop"

$repoRoot = Split-Path -Parent $PSScriptRoot
$outName = "ComfyUI-Majoor-AssetsManager_release.zip"
$outPath = Join-Path $repoRoot $outName

if (Test-Path $outPath) {
  Remove-Item -Force $outPath
}

$excludeDirs = @(
  ".git",
  ".github",
  ".claude",
  "__pycache__",
  "node_modules",
  "docs/.pytest_cache",
  ".pytest_cache"
)

$excludeFiles = @(
  "node.zip",
  "nul",
  ".gitmodules",
  "clean_pycache.bat",
  "check_sync_await_backend.py",
  "check_sync_await_refined.py",
  "fix_async_defs.py",
  "update_filesystem_handlers.py"
)

function Should-ExcludePath([string]$fullPath) {
  $rel = Resolve-Path $fullPath | ForEach-Object { $_.Path }
  $rel = $rel.Substring($repoRoot.Length).TrimStart("\","/")
  $norm = $rel.Replace("\","/")

  foreach ($d in $excludeDirs) {
    $dn = $d.Replace("\","/")
    if ($norm -eq $dn -or $norm.StartsWith($dn + "/")) { return $true }
  }
  foreach ($f in $excludeFiles) {
    if ($norm -eq $f) { return $true }
  }
  return $false
}

Add-Type -AssemblyName System.IO.Compression.FileSystem | Out-Null
$zip = [System.IO.Compression.ZipFile]::Open($outPath, "Create")
try {
  Get-ChildItem -Path $repoRoot -Recurse -File -Force | ForEach-Object {
    if (Should-ExcludePath $_.FullName) { return }
    $rel = $_.FullName.Substring($repoRoot.Length).TrimStart("\","/")
    $entryName = $rel.Replace("\","/")
    try {
      [System.IO.Compression.ZipFileExtensions]::CreateEntryFromFile($zip, $_.FullName, $entryName, "Optimal") | Out-Null
    } catch {
      Write-Warning ("Skipping file: " + $_.FullName + " (" + $_.Exception.Message + ")")
    }
  }
} finally {
  $zip.Dispose()
}

Write-Host ("Created: " + $outPath)
