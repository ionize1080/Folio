$ErrorActionPreference = 'Stop'
# WScript.Shell's shortcut automation rejects some paths outside the system
# ANSI code page. Exercise real Unicode shortcuts using IShellLinkW instead.
# https://learn.microsoft.com/windows/win32/api/shobjidl_core/nn-shobjidl_core-ishelllinkw
Add-Type -TypeDefinition @'
using System;
using System.Text;
using System.Runtime.InteropServices;
using System.Runtime.InteropServices.ComTypes;
[ComImport, Guid("00021401-0000-0000-C000-000000000046")]
class ShellLinkObject {}
[ComImport, Guid("000214F9-0000-0000-C000-000000000046"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IShellLinkUnicode {
  void GetPath([Out, MarshalAs(UnmanagedType.LPWStr)] StringBuilder path, int count, IntPtr data, uint flags);
  void GetIDList(out IntPtr list);
  void SetIDList(IntPtr list);
  void GetDescription([Out, MarshalAs(UnmanagedType.LPWStr)] StringBuilder value, int count);
  void SetDescription([MarshalAs(UnmanagedType.LPWStr)] string value);
  void GetWorkingDirectory([Out, MarshalAs(UnmanagedType.LPWStr)] StringBuilder value, int count);
  void SetWorkingDirectory([MarshalAs(UnmanagedType.LPWStr)] string value);
  void GetArguments([Out, MarshalAs(UnmanagedType.LPWStr)] StringBuilder value, int count);
  void SetArguments([MarshalAs(UnmanagedType.LPWStr)] string value);
  void GetHotkey(out short key);
  void SetHotkey(short key);
  void GetShowCmd(out int command);
  void SetShowCmd(int command);
  void GetIconLocation([Out, MarshalAs(UnmanagedType.LPWStr)] StringBuilder value, int count, out int index);
  void SetIconLocation([MarshalAs(UnmanagedType.LPWStr)] string value, int index);
  void SetRelativePath([MarshalAs(UnmanagedType.LPWStr)] string value, uint reserved);
  void Resolve(IntPtr window, uint flags);
  void SetPath([MarshalAs(UnmanagedType.LPWStr)] string value);
}
public static class UnicodeShortcut {
  public static void Create(string shortcut, string target) {
    object instance = new ShellLinkObject();
    try {
      IShellLinkUnicode link = (IShellLinkUnicode)instance;
      link.SetPath(target);
      link.SetWorkingDirectory(System.IO.Path.GetDirectoryName(target));
      ((IPersistFile)instance).Save(shortcut, true);
    } finally { Marshal.FinalReleaseComObject(instance); }
  }
}
'@
$link = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($env:FOLIO_TEST_LINK_B64))
$exe = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($env:FOLIO_TEST_EXE_B64))
[UnicodeShortcut]::Create($link, $exe)
