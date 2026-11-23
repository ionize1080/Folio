"""Drive the Windows desktop on the isolated test runner and measure the Folio HWND."""
import ctypes
import json
import sys
import time
from ctypes import wintypes as w

user = ctypes.WinDLL("user32", use_last_error=True)
user.SetProcessDpiAwarenessContext.argtypes = [w.HANDLE]
user.SetProcessDpiAwarenessContext(ctypes.c_void_p(-4))  # Per-monitor v2, physical pixels.
user.GetWindowRect.argtypes = user.GetClientRect.argtypes = [w.HWND, ctypes.POINTER(w.RECT)]
user.ClientToScreen.argtypes = [w.HWND, ctypes.POINTER(w.POINT)]
user.GetAncestor.argtypes = [w.HWND, w.UINT]
user.GetAncestor.restype = w.HWND
user.WindowFromPoint.argtypes = [w.POINT]
user.WindowFromPoint.restype = w.HWND
user.SendMessageW.argtypes = [w.HWND, w.UINT, w.WPARAM, w.LPARAM]
user.SendMessageW.restype = w.LPARAM
user.SetCursorPos.argtypes = [ctypes.c_int, ctypes.c_int]
user.mouse_event.argtypes = [w.DWORD, w.DWORD, w.DWORD, w.DWORD, ctypes.c_size_t]

hwnd = int(sys.argv[1])
gesture = sys.argv[2]
edge_codes = {"left": 10, "right": 11, "top": 12, "top-left": 13,
              "top-right": 14, "bottom": 15, "bottom-left": 16, "bottom-right": 17}


def bounds():
    r = w.RECT()
    if user.GetWindowRect(hwnd, ctypes.byref(r)):
        return [r.left, r.top, r.right, r.bottom]
    return None


def belongs(x, y):
    window = user.WindowFromPoint(w.POINT(x, y))
    return bool(window) and user.GetAncestor(window, 2) == hwnd


def hit(x, y):
    return user.SendMessageW(hwnd, 0x84, 0, ((y & 0xffff) << 16) | (x & 0xffff))


def resize_point(edge, rect):
    left, top, right, bottom = rect
    for inset in range(12):
        x = left + inset if "left" in edge else right - 1 - inset if "right" in edge else (left + right) // 2
        y = top + inset if "top" in edge else bottom - 1 - inset if "bottom" in edge else (top + bottom) // 2
        if belongs(x, y) and hit(x, y) == edge_codes[edge]:
            return x, y
    raise AssertionError(f"No Windows resize handle for {edge} in {rect}")


def position(x, y):
    if not user.SetCursorPos(x, y):
        raise ctypes.WinError(ctypes.get_last_error())


before = bounds()
if not before:
    raise RuntimeError("The Folio window no longer exists")
if gesture in edge_codes:
    x, y = resize_point(gesture, before)
else:
    r = w.RECT()
    p = w.POINT()
    if not user.GetClientRect(hwnd, ctypes.byref(r)) or not user.ClientToScreen(hwnd, ctypes.byref(p)):
        raise ctypes.WinError(ctypes.get_last_error())
    x = p.x + round(float(sys.argv[3]) * r.right)
    y = p.y + round(float(sys.argv[4]) * r.bottom)
if not belongs(x, y):
    raise AssertionError(f"The point {(x, y)} is outside the foreground Folio window {before}")

dx, dy = map(int, sys.argv[5:7])
hit_code = hit(x, y)
position(x, y)
time.sleep(.08)
user.mouse_event(2, 0, 0, 0, 0)  # Left down.
try:
    time.sleep(.06)
    for step in range(1, 11) if dx or dy else ():
        position(x + round(dx * step / 10), y + round(dy * step / 10))
        time.sleep(.025)
finally:
    user.mouse_event(4, 0, 0, 0, 0)  # Left up, including if input failed.
time.sleep(.18)
print(json.dumps({"before": before, "after": bounds(), "start": [x, y], "hit": hit_code}))

