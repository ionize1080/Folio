import ctypes as C
from ctypes import wintypes as W
import sys, subprocess, json
class Entry(C.Structure):
    _fields_=[('size',W.DWORD),('usage',W.DWORD),('pid',W.DWORD),('heap',C.c_size_t),('module',W.DWORD),('threads',W.DWORD),('parent',W.DWORD),('priority',W.LONG),('flags',W.DWORD),('exe',W.WCHAR*260)]
k=C.WinDLL('kernel32',use_last_error=True)
k.CreateToolhelp32Snapshot.argtypes=[W.DWORD,W.DWORD];k.CreateToolhelp32Snapshot.restype=W.HANDLE
k.Process32FirstW.argtypes=[W.HANDLE,C.POINTER(Entry)];k.Process32NextW.argtypes=[W.HANDLE,C.POINTER(Entry)];k.CloseHandle.argtypes=[W.HANDLE]
h=k.CreateToolhelp32Snapshot(2,0);e=Entry();e.size=C.sizeof(e);rows=[]
ok=k.Process32FirstW(h,C.byref(e))
while ok:
    rows.append((e.pid,e.parent,e.exe));ok=k.Process32NextW(h,C.byref(e))
k.CloseHandle(h)
ids={int(sys.argv[1])}
while True:
    new=ids|{pid for pid,parent,name in rows if parent in ids}
    if new==ids:break
    ids=new
assert not [name for pid,parent,name in rows if pid in ids and name.lower() in ('powershell.exe','pwsh.exe','msedgewebview2.exe')]
listeners=[]
for line in subprocess.check_output(['netstat.exe','-ano','-p','tcp'],creationflags=0x08000000,text=True).splitlines():
    fields=line.split()
    if len(fields)==5 and fields[-1].isdigit() and int(fields[-1]) in ids and fields[-2]=='LISTENING':
        listeners.append(dict(address=fields[1],pid=int(fields[-1])))
print(json.dumps(listeners))
