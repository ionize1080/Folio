param([Parameter(Mandatory=$true)][string]$Manifest, [switch]$Bootstrap)
$ErrorActionPreference = 'Stop'
if ($Bootstrap) {
  # Start-Process creates a separate hidden console on Windows. Node's detached
  # flag can prevent PowerShell from executing; sharing Folio's console instead
  # can terminate the helper when Folio exits. Keep both lifetimes independent.
  try {
    $arguments = @('-NoProfile','-STA','-NonInteractive','-WindowStyle','Hidden','-ExecutionPolicy','Bypass','-File',('"'+$PSCommandPath+'"'),'-Manifest',('"'+$Manifest+'"'))
    $helper = Start-Process -FilePath (Join-Path $PSHOME 'powershell.exe') -ArgumentList $arguments -WindowStyle Hidden -PassThru -RedirectStandardOutput ($Manifest+'.helper.log') -RedirectStandardError ($Manifest+'.helper-error.log')
    @{pid=$helper.Id} | ConvertTo-Json | Set-Content -LiteralPath ($Manifest+'.helper.json') -Encoding UTF8
    exit 0
  } catch { Write-Error $_ -ErrorAction Continue; exit 1 }
}
$m = $null; $stage = $null; $moved = $false; $newProcess = $null; $form = $null
$log = Join-Path (Split-Path -Parent $Manifest) 'install.log'
function Localized([string]$english, [string]$simplified, [string]$traditional) {
  if ($m.language -eq 'zh-Hans') { return $simplified }
  if ($m.language -eq 'zh-Hant') { return $traditional }
  return $english
}
function Report([string]$phase, [string]$message) {
  ('{0:o} [{1}] {2}' -f (Get-Date),$phase,$message) | Add-Content -LiteralPath $log -Encoding UTF8
  if ($m.statusFile) {
    $temporary = $m.statusFile + '.tmp'
    @{phase=$phase;message=$message;version=$m.version;target=$m.target;backup=$backup;log=$log} | ConvertTo-Json | Set-Content -LiteralPath $temporary -Encoding UTF8
    Move-Item -LiteralPath $temporary -Destination $m.statusFile -Force
  }
  if ($form) { $label.Text = $message; [Windows.Forms.Application]::DoEvents() }
}
function File-SHA([string]$file) {
  $stream = [IO.File]::OpenRead($file); $algorithm = [Security.Cryptography.SHA256]::Create()
  try { return ([BitConverter]::ToString($algorithm.ComputeHash($stream))).Replace('-','').ToLowerInvariant() }
  finally { $stream.Dispose(); $algorithm.Dispose() }
}
function Move-WithRetry([string]$source, [string]$destination) {
  $until = (Get-Date).AddSeconds(20)
  while ($true) {
    try { Move-Item -LiteralPath $source -Destination $destination; return }
    catch { if ((Get-Date) -gt $until) { throw }; Start-Sleep -Milliseconds 300; if ($form) { [Windows.Forms.Application]::DoEvents() } }
  }
}
function Start-Folio([bool]$checkHealth) {
  $options = @{FilePath=(Join-Path $m.target 'Folio.exe');WorkingDirectory=$m.target;PassThru=$true}
  $arguments = @()
  if ($m.userData) { $arguments += ('"--user-data-dir=' + $m.userData + '"') }
  if ($checkHealth) { $arguments += ('"--folio-update-health=' + $m.healthFile + '"') }
  if ($arguments.Count) { $options.ArgumentList = $arguments }
  return Start-Process @options
}
try {
  $m = Get-Content -LiteralPath $Manifest -Raw -Encoding UTF8 | ConvertFrom-Json
  Add-Type -AssemblyName System.IO.Compression.FileSystem
  if ($m.statusFile -and !$m.headless) {
    Add-Type -AssemblyName System.Windows.Forms
    $form = New-Object Windows.Forms.Form
    $form.Text = Localized 'Folio PDF Studio Update' 'Folio PDF Studio 更新' 'Folio PDF Studio 更新'; $form.Width=480; $form.Height=150
    $form.StartPosition='CenterScreen'; $form.ControlBox=$false
    $label=New-Object Windows.Forms.Label; $label.SetBounds(20,15,425,48); $form.Controls.Add($label)
    $progress=New-Object Windows.Forms.ProgressBar; $progress.SetBounds(20,70,425,20); $progress.Style='Marquee'; $form.Controls.Add($progress)
    $form.Show()
  }
  $parent = Split-Path -Parent $m.target
  $stage = Join-Path $parent ('.folio-update-' + [Guid]::NewGuid().ToString('N'))
  $backup = $m.target + '.backup-' + (Get-Date -Format 'yyyyMMdd-HHmmss-fff') + '-' + [Guid]::NewGuid().ToString('N').Substring(0,6)
  Report 'preparing' (Localized 'Verifying and extracting the update. Keep Folio open.' '正在校验并解压更新，请保持 Folio 打开。' '正在驗證並解壓縮更新，請保持 Folio 開啟。')
  if ((File-SHA $m.file) -ne $m.hash) { throw 'Update checksum mismatch' }
  New-Item -ItemType Directory -Path $stage | Out-Null
  $zip = [IO.Compression.ZipFile]::OpenRead($m.file)
  try {
    [long]$size=0; $names=[Collections.Generic.HashSet[string]]::new([StringComparer]::OrdinalIgnoreCase)
    foreach ($entry in $zip.Entries) {
      $name=$entry.FullName.Replace('\','/')
      if (!$name.StartsWith('Folio-PDF-Studio/') -or $name -match '(^|/)\.\.?(/|$)|:|\x00' -or !$names.Add($name)) { throw 'Unsafe archive path' }
      if (($entry.ExternalAttributes -shr 16 -band 0xF000) -eq 0xA000) { throw 'Archive symlink rejected' }
      $size += $entry.Length
      if ($size -gt 16GB) { throw 'Expanded archive exceeds budget' }
    }
  } finally { $zip.Dispose() }
  [IO.Compression.ZipFile]::ExtractToDirectory($m.file,$stage)
  $new=Join-Path $stage 'Folio-PDF-Studio'
  $info=Get-Content -LiteralPath (Join-Path $new 'BUILD-INFO.json') -Raw -Encoding UTF8 | ConvertFrom-Json
  foreach ($pair in @(@('Folio.exe','exe_sha256'),@('resources/app.asar','asar_sha256'))) {
    if ((File-SHA (Join-Path $new $pair[0])) -ne $info.($pair[1])) { throw 'Packaged binary checksum mismatch' }
  }
  $fullVersion=$info.version + $(if ($info.releaseChannel) { '-'+$info.releaseChannel } else { '' })
  if ($fullVersion -ne $m.version.TrimStart('v')) { throw 'Packaged version mismatch' }
  Report 'ready' (Localized 'Verified. Waiting for Folio to close…' '校验完成，正在等待 Folio 关闭…' '驗證完成，正在等候 Folio 關閉…')
  $until=(Get-Date).AddSeconds(120)
  while (Get-Process -Id $m.pid -ErrorAction SilentlyContinue) {
    if ((Get-Date) -gt $until) { throw 'Folio did not close; installation cancelled safely' }
    Start-Sleep -Milliseconds 250; if ($form) { [Windows.Forms.Application]::DoEvents() }
  }
  if ($m.commitFile) {
    $commit = Get-Content -LiteralPath $m.commitFile -Raw -Encoding UTF8 | ConvertFrom-Json
    if (!$m.token -or $commit.token -ne $m.token) { throw 'Installation was not acknowledged; original retained' }
  }
  Report 'replacing' (Localized 'Installing in the original folder. Shortcuts remain valid.' '正在原目录安装，桌面快捷方式保持有效。' '正在原資料夾安裝，桌面捷徑保持有效。')
  Move-WithRetry $m.target $backup; $moved=$true
  Move-WithRetry $new $m.target
  if ($m.healthFile) {
    Remove-Item -LiteralPath $m.healthFile -Force -ErrorAction SilentlyContinue
    $newProcess=Start-Folio $true
    Report 'starting' (Localized 'Starting the new version and checking its window…' '正在启动新版并检查窗口…' '正在啟動新版本並檢查視窗…')
    $until=(Get-Date).AddSeconds(45)
    while (!(Test-Path -LiteralPath $m.healthFile)) {
      if ((Get-Date) -gt $until -or $newProcess.HasExited) { throw 'The new Folio window did not become ready' }
      Start-Sleep -Milliseconds 250; if ($form) { [Windows.Forms.Application]::DoEvents() }
    }
    $health=Get-Content -LiteralPath $m.healthFile -Raw | ConvertFrom-Json
    if ($health.version -ne $fullVersion -or $health.pid -ne $newProcess.Id) { throw 'Restarted version or process does not match the download' }
  } else { $newProcess=Start-Folio $false }
  Report 'complete' ((Localized 'Updated. Rollback copy: ' '更新完成。回滚副本：' '更新完成。回復副本：') + $backup)
} catch {
  $failure=$_.Exception.Message
  try {
    if ($newProcess -and !$newProcess.HasExited) {
      # Only the process tree started by this updater, never an unrelated Folio.
      & taskkill.exe /PID $newProcess.Id /T /F 2>&1 | Out-Null
    }
    if ($moved) {
      if (Test-Path -LiteralPath $m.target) { Move-WithRetry $m.target ($stage+'-failed') }
      Move-WithRetry $backup $m.target
    }
    Report 'failed' ((Localized 'Update failed; original retained: ' '更新失败，已保留原版本：' '更新失敗，已保留原版本：') + $failure)
    if ($m -and !(Get-Process -Id $m.pid -ErrorAction SilentlyContinue) -and (Test-Path -LiteralPath (Join-Path $m.target 'Folio.exe'))) {
      Start-Folio $false | Out-Null
      'Restarted previous installation after failure' | Add-Content -LiteralPath $log -Encoding UTF8
    }
  } catch { Report 'failed' ((Localized 'Update and recovery failed. Check the log and backup: ' '更新与恢复失败，请检查日志和备份：' '更新與復原失敗，請檢查記錄與備份：') + "$failure. $_. $backup") }
  if ($form) { [Windows.Forms.MessageBox]::Show(((Localized 'Update failed. Check the log for recovery details.' '更新失败，请查看日志了解恢复情况。' '更新失敗，請查看記錄了解復原情況。') + "`n$failure`nLog: $log"),'Folio update') | Out-Null }
} finally {
  if ($stage -and (Test-Path -LiteralPath $stage)) { Remove-Item -LiteralPath $stage -Recurse -Force -ErrorAction SilentlyContinue }
  if ($form) { $form.Close(); $form.Dispose() }
}
