"""Independent top-level sidebar: preserve Chromium's native activation/IME path.

Never SetParent across Electron processes. Uses only bundled Python and Win32.
"""
import ctypes as C
from ctypes import wintypes as W
import json
import sys
import queue
import threading

u = C.WinDLL('user32', use_last_error=True)
def api(name, result, *args):
    fn = getattr(u, name)
    fn.restype, fn.argtypes = result, args
    return fn

get = api('GetWindowLongPtrW', C.c_ssize_t, W.HWND, C.c_int)
put = api('SetWindowLongPtrW', C.c_ssize_t, W.HWND, C.c_int, C.c_ssize_t)
pos = api('SetWindowPos', W.BOOL, W.HWND, W.HWND, C.c_int, C.c_int, C.c_int, C.c_int, W.UINT)
show = api('ShowWindow', W.BOOL, W.HWND, C.c_int)
valid = api('IsWindow', W.BOOL, W.HWND)
screen = api('ClientToScreen', W.BOOL, W.HWND, C.POINTER(W.POINT))
api('SetThreadDpiAwarenessContext', C.c_void_p, C.c_void_p)(C.c_void_p(-4))
original = {}
foreground = api('GetForegroundWindow', W.HWND)
iconic = api('IsIconic', W.BOOL, W.HWND)
visible = api('IsWindowVisible', W.BOOL, W.HWND)
thread_pid = api('GetWindowThreadProcessId', W.DWORD, W.HWND, C.POINTER(W.DWORD))
def pid(hwnd):
    value = W.DWORD()
    thread_pid(hwnd, C.byref(value))
    return value.value
messages = queue.Queue()
def read_messages():
    for line in sys.stdin:
        messages.put(line)
    messages.put(None)
threading.Thread(target=read_messages, daemon=True).start()
last = None
last_shown = None
last_zstate = None
while True:
    try:
        try:
            line = messages.get(timeout=.03)
        except queue.Empty:
            if last and last['mode'] == 'sidebar':
                child, owner = int(last['child']), int(last['parent'])
                if not valid(child) or not valid(owner):
                    break
                active = pid(foreground()) in (pid(child), pid(owner))
                shown = visible(owner) and not iconic(owner) and not last.get('hidden', False)
                if shown != last_shown:
                    show(child, 4 if shown else 0)  # SHOWNOACTIVATE
                    last_shown = shown
                zstate = (shown, active, foreground())
                if zstate == last_zstate:
                    continue
                last_zstate = zstate
                if shown and active:
                    pos(child, W.HWND(-1), 0, 0, 0, 0, 0x0013) # topmost without activation/move/size
                elif shown:
                    pos(child, W.HWND(-2), 0, 0, 0, 0, 0x0013)
                    pos(child, foreground(), 0, 0, 0, 0, 0x0013)
            continue
        if line is None:
            break
        m = json.loads(line)
        last, last_shown, last_zstate = m, None, None
        child, owner = int(m['child']), int(m['parent'])
        if not valid(child) or not valid(owner):
            continue
        if child not in original:
            original[child] = (get(child, -16), get(child, -8))
        style, previous_owner = original[child]
        side = m['mode'] == 'sidebar'
        # Independent activation queues. Visibility follows the host while docked.
        put(child, -8, previous_owner)
        put(child, -16, (style & ~0xC0C40000) if side else style)
        point = W.POINT(int(m['x']), int(m['y']))
        if side and not screen(owner, C.byref(point)):
            raise C.WinError(C.get_last_error())
        hidden = m.get('hidden', False)
        if hidden:
            show(child, 0)
        # FRAMECHANGED | NOACTIVATE | NOZORDER; never steal focus during resize.
        if not pos(child, None, point.x, point.y, int(m['width']), int(m['height']),
                   0x0034 | (0 if hidden else 0x0040)):
            raise C.WinError(C.get_last_error())
        if not side:
            pos(child, W.HWND(-2), 0, 0, 0, 0, 0x0013)
    except Exception as error:
        print(str(error), file=sys.stderr, flush=True)
