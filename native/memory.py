import os,ctypes as C

def resident_bytes():
    try:
        if os.name=='nt':
            class Memory(C.Structure):
                _fields_=[('cb',C.c_ulong),('PageFaultCount',C.c_ulong),('PeakWorkingSetSize',C.c_size_t),('WorkingSetSize',C.c_size_t),('QuotaPeakPagedPoolUsage',C.c_size_t),('QuotaPagedPoolUsage',C.c_size_t),('QuotaPeakNonPagedPoolUsage',C.c_size_t),('QuotaNonPagedPoolUsage',C.c_size_t),('PagefileUsage',C.c_size_t),('PeakPagefileUsage',C.c_size_t)]
            m=Memory();m.cb=C.sizeof(m);kernel=C.WinDLL('kernel32');kernel.GetCurrentProcess.restype=C.c_void_p
            ps=C.WinDLL('psapi');ps.GetProcessMemoryInfo.argtypes=[C.c_void_p,C.c_void_p,C.c_ulong]
            if ps.GetProcessMemoryInfo(kernel.GetCurrentProcess(),C.byref(m),m.cb):return m.WorkingSetSize
        else:
            return int(open('/proc/self/statm').read().split()[1])*os.sysconf('SC_PAGE_SIZE')
    except Exception:pass
    return 0
