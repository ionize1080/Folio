param([Parameter(Mandatory=$true)][string]$Manifest)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.IO.Compression.FileSystem
$m = Get-Content -LiteralPath $Manifest -Raw -Encoding UTF8 | ConvertFrom-Json
$parent = Split-Path -Parent $m.target
$stage = Join-Path $parent ('.folio-update-' + [Guid]::NewGuid().ToString('N'))
$backup = $m.target + '.backup-' + (Get-Date -Format 'yyyyMMdd-HHmmss')
$log = Join-Path (Split-Path -Parent $Manifest) 'install.log'
$moved = $false
function File-SHA([string]$file) {
  $stream = [IO.File]::OpenRead($file)
  $algorithm = [Security.Cryptography.SHA256]::Create()
  try { return ([BitConverter]::ToString($algorithm.ComputeHash($stream))).Replace('-','').ToLowerInvariant() }
  finally { $stream.Dispose(); $algorithm.Dispose() }
}
try {
  if ((File-SHA $m.file) -ne $m.hash) { throw 'Update checksum mismatch' }
  New-Item -ItemType Directory -Path $stage | Out-Null
  $zip = [IO.Compression.ZipFile]::OpenRead($m.file)
  try {
    [long]$size = 0
    $names = [Collections.Generic.HashSet[string]]::new([StringComparer]::OrdinalIgnoreCase)
    foreach ($entry in $zip.Entries) {
      $name = $entry.FullName.Replace('\','/')
      if (!$name.StartsWith('Folio-PDF-Studio/') -or $name -match '(^|/)\.\.?(/|$)|:|\x00' -or !$names.Add($name)) { throw 'Unsafe archive path' }
      if (($entry.ExternalAttributes -shr 16 -band 0xF000) -eq 0xA000) { throw 'Archive symlink rejected' }
      $size += $entry.Length
      if ($size -gt 16GB) { throw 'Expanded archive exceeds budget' }
    }
  } finally { $zip.Dispose() }
  [IO.Compression.ZipFile]::ExtractToDirectory($m.file,$stage)
  $new = Join-Path $stage 'Folio-PDF-Studio'
  $info = Get-Content -LiteralPath (Join-Path $new 'BUILD-INFO.json') -Raw -Encoding UTF8 | ConvertFrom-Json
  foreach ($pair in @(@('Folio.exe','exe_sha256'),@('resources/app.asar','asar_sha256'))) {
    if ((File-SHA (Join-Path $new $pair[0])) -ne $info.($pair[1])) { throw 'Packaged binary checksum mismatch' }
  }
  $fullVersion = $info.version + $(if ($info.releaseChannel) { '-' + $info.releaseChannel } else { '' })
  if ($fullVersion -ne $m.version.TrimStart('v')) { throw 'Packaged version mismatch' }
  Wait-Process -Id $m.pid -ErrorAction SilentlyContinue
  # A second running instance or a locked directory fails before touching the old copy.
  Move-Item -LiteralPath $m.target -Destination $backup
  $moved = $true
  Move-Item -LiteralPath $new -Destination $m.target
  Start-Process -FilePath (Join-Path $m.target 'Folio.exe') -WorkingDirectory $m.target
  "Updated; rollback copy: $backup" | Set-Content -LiteralPath $log -Encoding UTF8
} catch {
  if ($moved) {
    if (Test-Path -LiteralPath $m.target) { Move-Item -LiteralPath $m.target -Destination ($stage + '-failed') }
    Move-Item -LiteralPath $backup -Destination $m.target
  }
  "Update failed; original retained: $_" | Set-Content -LiteralPath $log -Encoding UTF8
  if (Test-Path -LiteralPath (Join-Path $m.target 'Folio.exe')) { Start-Process -FilePath (Join-Path $m.target 'Folio.exe') -WorkingDirectory $m.target }
} finally {
  if (Test-Path -LiteralPath $stage) { Remove-Item -LiteralPath $stage -Recurse -Force }
}
