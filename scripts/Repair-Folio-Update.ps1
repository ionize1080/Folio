param([string]$InstallDir, [string]$Archive, [string]$UserData, [switch]$Headless)
$ErrorActionPreference = 'Stop'
# Run directly, never with DETACHED_PROCESS. This bridges the broken launchers
# shipped in 1.3 through 1.6 without modifying an installed app.asar in place.
try {
  $config = Get-Content -LiteralPath (Join-Path $PSScriptRoot 'repair-config.json') -Raw -Encoding UTF8 | ConvertFrom-Json
  if (!$InstallDir -or !$Archive) { Add-Type -AssemblyName System.Windows.Forms }
  if (!$InstallDir) {
    $picker = New-Object Windows.Forms.OpenFileDialog
    $picker.Title = 'Select the existing Folio.exe'; $picker.Filter = 'Folio application|Folio.exe'
    if ($picker.ShowDialog() -ne 'OK') { exit 1 }
    $InstallDir = Split-Path -Parent $picker.FileName; $picker.Dispose()
  }
  if (!$Archive) {
    $picker = New-Object Windows.Forms.OpenFileDialog
    $picker.Title = 'Select the downloaded Folio 1.6.2 portable ZIP'; $picker.Filter = 'Portable ZIP|*.zip'
    if ($picker.ShowDialog() -ne 'OK') { exit 1 }
    $Archive = $picker.FileName; $picker.Dispose()
  }
  $InstallDir = (Resolve-Path -LiteralPath $InstallDir).Path
  $Archive = (Resolve-Path -LiteralPath $Archive).Path
  $installed = Get-Content -LiteralPath (Join-Path $InstallDir 'BUILD-INFO.json') -Raw -Encoding UTF8 | ConvertFrom-Json
  if ($installed.product -ne 'Folio PDF Studio' -or !(Test-Path -LiteralPath (Join-Path $InstallDir 'Folio.exe'))) { throw 'Select a complete Folio portable installation.' }
  if ([version]$installed.version -gt [version]$config.version.TrimStart('v')) { throw 'A newer version is installed; downgrade refused.' }
  $running = Get-CimInstance Win32_Process | Where-Object { $_.ExecutablePath -and $_.ExecutablePath.StartsWith($InstallDir + '\', [StringComparison]::OrdinalIgnoreCase) }
  if ($running) { throw 'Save your documents and close Folio before running the repair.' }
  if ((Get-FileHash -LiteralPath $Archive -Algorithm SHA256).Hash -ne $config.sha256) { throw 'The ZIP does not match the verified 1.6.2 release. Download it again.' }
  if (!$UserData) { $UserData = Join-Path $env:APPDATA 'Folio PDF Studio' }
  $UserData = [IO.Path]::GetFullPath($UserData)
  $updates = Join-Path $userData 'updates'
  New-Item -ItemType Directory -Path $updates -Force | Out-Null
  $manifest = Join-Path $updates ('install-' + [guid]::NewGuid().ToString() + '.json')
  $token = [guid]::NewGuid().ToString()
  $m = @{file=$Archive;hash=$config.sha256;version=$config.version;target=$InstallDir;pid=2147483646;userData=$userData;language='zh-Hans';headless=[bool]$Headless;statusFile=($manifest+'.status.json');healthFile=($manifest+'.health.json');commitFile=($manifest+'.commit.json');token=$token}
  $m | ConvertTo-Json | Set-Content -LiteralPath $manifest -Encoding UTF8
  @{token=$token} | ConvertTo-Json | Set-Content -LiteralPath $m.commitFile -Encoding UTF8
  @{manifest=(Split-Path -Leaf $manifest)} | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $updates 'last-install.json') -Encoding UTF8
  & (Join-Path $PSScriptRoot 'portable-update.ps1') -Manifest $manifest
  $result = Get-Content -LiteralPath $m.statusFile -Raw -Encoding UTF8 | ConvertFrom-Json
  if ($result.phase -ne 'complete') { throw $result.message }
  Write-Output $result.message
} catch {
  Write-Error $_ -ErrorAction Continue
  exit 1
}
