$ErrorActionPreference = 'Stop'
$root = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$releaseDir = Join-Path $root 'release'
$zipPath = Join-Path $releaseDir '漫游旅行助手-Docker本地运行包.zip'
New-Item -ItemType Directory -Force -Path $releaseDir | Out-Null
if (Test-Path -LiteralPath $zipPath) { Remove-Item -LiteralPath $zipPath -Force }

$excludedDirectories = @('.git', 'node_modules', 'data', 'uploads', 'release', 'dist', 'coverage')
$excludedFiles = @('.env', '.env.local', '.env.production', '.env.development')
$files = Get-ChildItem -LiteralPath $root -File -Recurse -Force | Where-Object {
  $relative = $_.FullName.Substring($root.Length).TrimStart('\')
  $parts = $relative -split '[\\/]'
  $isExcludedDirectory = @($parts | Where-Object { $excludedDirectories -contains $_ }).Count -gt 0
  $isExcludedFile = $excludedFiles -contains $_.Name -or ($_.Name -like '.env.*' -and $_.Name -notlike '*.example')
  -not $isExcludedDirectory -and -not $isExcludedFile
}

if (-not ($files | Where-Object { $_.Name -eq 'Dockerfile' })) { throw 'Dockerfile is missing from package input.' }
if (-not ($files | Where-Object { $_.Name -eq 'docker-compose.yml' })) { throw 'docker-compose.yml is missing from package input.' }
if (-not ($files | Where-Object { $_.Name -eq 'package-lock.json' })) { throw 'package-lock.json is missing from package input.' }

Add-Type -AssemblyName System.IO.Compression.FileSystem
$archive = [System.IO.Compression.ZipFile]::Open($zipPath, [System.IO.Compression.ZipArchiveMode]::Create)
try {
  foreach ($file in $files) {
    $relative = $file.FullName.Substring($root.Length).TrimStart('\').Replace('\', '/')
    [System.IO.Compression.ZipFileExtensions]::CreateEntryFromFile(
      $archive,
      $file.FullName,
      $relative,
      [System.IO.Compression.CompressionLevel]::Optimal
    ) | Out-Null
  }
} finally {
  $archive.Dispose()
}
Write-Host "Package created: $zipPath"
Write-Host ("Included files: {0}" -f $files.Count)
