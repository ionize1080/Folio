$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent
$cache = Join-Path $root '.ai-runtime/conversion-downloads'
$engines = Join-Path $root 'native/engines'
New-Item -ItemType Directory -Force $cache,$engines | Out-Null
function Fetch-Verified($name,$url,$hash) {
  $target = Join-Path $cache $name
  if (!(Test-Path -LiteralPath $target) -or (Get-FileHash -LiteralPath $target -Algorithm SHA256).Hash -ne $hash) {
    Invoke-WebRequest -Uri $url -OutFile $target
  }
  if ((Get-FileHash -LiteralPath $target -Algorithm SHA256).Hash -ne $hash) { throw "Checksum mismatch: $name" }
  return $target
}
$gs = Fetch-Verified 'ghostscript.exe' 'https://github.com/ArtifexSoftware/ghostpdl-downloads/releases/download/gs10080/gs10080w64.exe' '52a91b8bf09298788d7a57b9206127026c23eacd75405f0a131e26dc381dce50'
$jre = Fetch-Verified 'java.zip' 'https://github.com/adoptium/temurin21-binaries/releases/download/jdk-21.0.13%2B9/OpenJDK21U-jre_x64_windows_hotspot_21.0.13_9.zip' '2332c0b4cff6bed722da3567c91d5e47568bcba863fa4945d0a8d6fc76158628'
$lo = Fetch-Verified 'libreoffice.msi' 'https://download.documentfoundation.org/libreoffice/stable/26.2.7/win/x86_64/LibreOffice_26.2.7_Win_x86-64.msi' '480fecf759fc6393bd614fbf43753eb95a8198fc1a065d41b727e3b664cd1e59'
$vera = Fetch-Verified 'verapdf.zip' 'https://software.verapdf.org/releases/1.30/verapdf-greenfield-1.30.3-installer.zip' 'b512bf24945503a33fc10738ecffc1f2dccaaf8593a448e94ee9ac86a9559a59'
$seven = Get-Command 7z.exe -ErrorAction SilentlyContinue
if ($seven) { $sevenPath=$seven.Source } else {
  $bootstrap=Fetch-Verified '7zr.exe' 'https://www.7-zip.org/a/7zr.exe' '256feca8e274e5da655e2a284fabafd9f554365eb164862089dacd4e8276d282'
  $archive=Fetch-Verified '7z-full.exe' 'https://www.7-zip.org/a/7z2501-x64.exe' '78afa2a1c773caf3cf7edf62f857d2a8a5da55fb0fff5da416074c0d28b2b55f'
  & $bootstrap x $archive "-o$cache/7zip-full" -y | Out-Null
  if($LASTEXITCODE) {throw 'Archive bootstrap failed'}
  $sevenPath=Join-Path $cache '7zip-full/7z.exe'
}
& $sevenPath x $gs "-o$engines/ghostscript" -y | Out-Null
if($LASTEXITCODE) {throw 'Ghostscript extraction failed'}
Expand-Archive -LiteralPath $jre -DestinationPath "$engines/java" -Force
if (!(Test-Path "$engines/libreoffice/program/soffice.exe")) {
  $target=Join-Path $engines 'libreoffice'
  # Administrative extraction only: does not install Office or alter file associations.
  $proc=Start-Process msiexec.exe -ArgumentList @('/a',('"'+$lo+'"'),'/qn',('TARGETDIR="'+$target+'"')) -WindowStyle Hidden -Wait -PassThru
  if($proc.ExitCode -ne 0){throw "LibreOffice extraction failed: $($proc.ExitCode)"}
}
Expand-Archive -LiteralPath $vera -DestinationPath "$cache/verapdf" -Force
$xml=@"
<AutomatedInstallation langpack="eng"><com.izforge.izpack.panels.htmlhello.HTMLHelloPanel id="welcome"/><com.izforge.izpack.panels.target.TargetPanel id="install_dir"><installpath>$engines/verapdf</installpath></com.izforge.izpack.panels.target.TargetPanel><com.izforge.izpack.panels.packs.PacksPanel id="sdk_pack_select"><pack index="0" name="veraPDF GUI" selected="true"/><pack index="1" name="veraPDF CLI" selected="true"/><pack index="2" name="veraPDF Documentation" selected="true"/><pack index="3" name="veraPDF Sample Plugins" selected="false"/></com.izforge.izpack.panels.packs.PacksPanel><com.izforge.izpack.panels.install.InstallPanel id="install"/><com.izforge.izpack.panels.finish.FinishPanel id="finish"/></AutomatedInstallation>
"@
$xml | Set-Content -LiteralPath "$cache/verapdf-install.xml" -Encoding utf8
& "$engines/java/jdk-21.0.13+9-jre/bin/java.exe" -jar "$cache/verapdf/verapdf-greenfield-1.30.3/verapdf-izpack-installer-1.30.3.jar" "$cache/verapdf-install.xml"
if($LASTEXITCODE) {throw 'veraPDF staging failed'}
Write-Output 'Verified portable conversion engines ready.'
