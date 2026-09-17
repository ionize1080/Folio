"""Linux-only QA runner: prohibit all IPv4/IPv6 sockets in this process and descendants.
Used to ensure bundled browser / model runtime tests cannot send telemetry or document data.
"""
import ctypes as C,ctypes.util,errno,os,socket,sys
lib=C.CDLL(ctypes.util.find_library('seccomp'),use_errno=True)
lib.seccomp_init.argtypes=[C.c_uint32];lib.seccomp_init.restype=C.c_void_p
lib.seccomp_syscall_resolve_name.argtypes=[C.c_char_p];lib.seccomp_syscall_resolve_name.restype=C.c_int
class Arg(C.Structure):_fields_=[('arg',C.c_uint),('op',C.c_uint),('datum_a',C.c_uint64),('datum_b',C.c_uint64)]
lib.seccomp_rule_add_array.argtypes=[C.c_void_p,C.c_uint32,C.c_int,C.c_uint,C.POINTER(Arg)]
lib.seccomp_load.argtypes=[C.c_void_p];lib.seccomp_release.argtypes=[C.c_void_p]
ctx=lib.seccomp_init(0x7fff0000)
assert ctx
for family in (socket.AF_INET,socket.AF_INET6):
 arg=Arg(0,4,family,0)
 assert lib.seccomp_rule_add_array(ctx,0x00050000|errno.EPERM,lib.seccomp_syscall_resolve_name(b'socket'),1,C.byref(arg))==0
assert lib.seccomp_load(ctx)==0;lib.seccomp_release(ctx)
for family in (socket.AF_INET,socket.AF_INET6):
 try:socket.socket(family,socket.SOCK_STREAM)
 except PermissionError:pass
 else:raise RuntimeError('Offline enforcement failed')
print('Verified: IPv4 and IPv6 socket creation denied by kernel; inherited by all test processes.',flush=True)
os.execvp(sys.argv[1],sys.argv[1:])
