param()
Add-Type @"
using System;
using System.Runtime.InteropServices;
public static class FolioDock {
 [DllImport("user32.dll")] public static extern IntPtr SetThreadDpiAwarenessContext(IntPtr value);
 [DllImport("user32.dll")] public static extern IntPtr SetParent(IntPtr child,IntPtr parent);
 [DllImport("user32.dll")] public static extern bool SetWindowPos(IntPtr h,IntPtr a,int x,int y,int w,int ht,uint flags);
 [DllImport("user32.dll")] public static extern int GetWindowLong(IntPtr h,int n);
 [DllImport("user32.dll")] public static extern int SetWindowLong(IntPtr h,int n,int value);
 [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h,int n);
}
"@
[void][FolioDock]::SetThreadDpiAwarenessContext([IntPtr](-4))
$original=@{}
while($line=[Console]::ReadLine()) {
 try {
  $m=$line|ConvertFrom-Json
  $childHandle=[IntPtr]([long]$m.child)
  $key=[string]$m.child
  if(-not $original.ContainsKey($key)){$original[$key]=[FolioDock]::GetWindowLong($childHandle,-16);[void][FolioDock]::ShowWindow($childHandle,9)}
  $flags=0x0070
  if($m.hidden -eq $true){$flags=0x0030}
  if($m.mode -eq 'sidebar') {
   [void][FolioDock]::SetParent($childHandle,[IntPtr]([long]$m.parent))
   [void][FolioDock]::SetWindowLong($childHandle,-16,($original[$key] -band (-bnot 0x00C40000) -bor 0x40000000))
   [void][FolioDock]::SetWindowPos($childHandle,[IntPtr]::Zero,$m.x,$m.y,$m.width,$m.height,$flags)
  } else {
   [void][FolioDock]::SetParent($childHandle,[IntPtr]::Zero)
   [void][FolioDock]::SetWindowLong($childHandle,-16,$original[$key])
   [void][FolioDock]::SetWindowPos($childHandle,[IntPtr]::Zero,$m.x,$m.y,$m.width,$m.height,$flags)
  }
  if($m.hidden -eq $true){[void][FolioDock]::ShowWindow($childHandle,0)}
 }catch{[Console]::Error.WriteLine($_.Exception.Message)}
}
