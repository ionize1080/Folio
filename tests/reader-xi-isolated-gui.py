"""Observe the actual XI document view and modal dialogs on a disposable Windows desktop."""
import argparse
import ctypes
from ctypes import wintypes
import json
import re
import subprocess
import time
from pathlib import Path

import pikepdf
import win32clipboard
import win32con
import win32gui
import win32process
from PIL import ImageGrab
from pywinauto import Desktop
from pywinauto.keyboard import send_keys


def read_windows():
    roots = []
    def collect(hwnd, _):
        if win32gui.IsWindowVisible(hwnd) and win32gui.GetClassName(hwnd) == 'AcrobatSDIWindow':
            roots.append(hwnd)
    win32gui.EnumWindows(collect, None)
    return roots


def control_text(hwnd):
    # GetWindowText deliberately omits the text of another process's Edit controls.
    buf = ctypes.create_unicode_buffer(512)
    received = ctypes.c_size_t()
    send = ctypes.windll.user32.SendMessageTimeoutW
    send.argtypes = [wintypes.HWND, wintypes.UINT, wintypes.WPARAM, wintypes.LPARAM,
                     wintypes.UINT, wintypes.UINT, ctypes.POINTER(ctypes.c_size_t)]
    send.restype = wintypes.LPARAM
    if send(hwnd, win32con.WM_GETTEXT, len(buf), ctypes.addressof(buf), 2, 220, ctypes.byref(received)):
        return buf.value
    return win32gui.GetWindowText(hwnd)


def children(hwnd):
    values = []
    def collect(handle, _):
        if win32gui.IsWindowVisible(handle):
            cls = win32gui.GetClassName(handle)
            value = control_text(handle) if cls in ('Edit','Button','Static') else win32gui.GetWindowText(handle)
            values.append((int(handle), cls, value))
    win32gui.EnumChildWindows(hwnd, collect, None)
    return values


def dialogs_for(roots):
    pids = {win32process.GetWindowThreadProcessId(w)[1] for w in roots}
    handles = set()
    def collect(w, _):
        if win32gui.IsWindowVisible(w) and win32gui.GetClassName(w) == '#32770' and win32process.GetWindowThreadProcessId(w)[1] in pids:
            handles.add(w)
    win32gui.EnumWindows(collect, None)
    for root in roots:
        handles.update(w for w, c, _ in children(root) if c == '#32770')
    return [(win32gui.GetWindowText(w), [t[:240] for _, _, t in children(w) if t]) for w in handles]


def screenshot(hwnd, dest):
    x, y, right, bottom = win32gui.GetWindowRect(hwnd)
    if right > x and bottom > y:
        ImageGrab.grab(bbox=(x, y, right, bottom)).save(dest)


def page_number(hwnd):
    return [int(text) for _, cl, text in children(hwnd) if cl == 'Edit' and text.strip().isdigit()]


def uia_controls(hwnd):
    root = Desktop(backend='uia').window(handle=hwnd)
    return [(w.element_info.class_name, w.element_info.name[:120])
            for w in root.descendants() if w.element_info.name]


def clipboard_text():
    try:
        win32clipboard.OpenClipboard()
        if win32clipboard.IsClipboardFormatAvailable(win32con.CF_UNICODETEXT):
            return win32clipboard.GetClipboardData(win32con.CF_UNICODETEXT)
        return ''
    finally:
        win32clipboard.CloseClipboard()


def clear_clipboard():
    try:
        win32clipboard.OpenClipboard()
        win32clipboard.EmptyClipboard()
    finally:
        win32clipboard.CloseClipboard()


def check(viewer, path, evidence):
    with pikepdf.Pdf.open(path) as source:
        pages = len(source.pages)
    proc = subprocess.Popen([str(viewer), '/n', str(path)])
    result = {'file': path.name, 'expectedPages': pages, 'passed': False}
    try:
        deadline = time.monotonic() + 18
        while time.monotonic() < deadline:
            roots = read_windows()
            dialogs = dialogs_for(roots)
            if dialogs:
                break
            if roots and any(path.stem.lower() in win32gui.GetWindowText(w).lower() and any(page_number(w)) for w in roots):
                time.sleep(1.0)
                break
            time.sleep(.35)
        roots = read_windows()
        result['titles'] = [win32gui.GetWindowText(w) for w in roots]
        result['dialogs'] = dialogs_for(roots)
        if not roots:
            return result
        window = next((w for w in roots if path.stem.lower() in win32gui.GetWindowText(w).lower()), roots[0])
        screenshot(window, evidence / (path.stem + '.png'))
        if result['dialogs']:
            return result
        tree = uia_controls(window)
        result['toolbar'] = [(cl, t) for cl, t in tree if cl == 'Edit' or re.search(r'\b(page|of)\b', t, re.I)]
        result['firstPageFields'] = page_number(window)
        app = Desktop(backend='win32').window(handle=window)
        app.set_focus()
        # Focus the document pane before Ctrl+A/Ctrl+C and Ctrl+End.
        client=app.client_rect()
        app.click_input(coords=(client.width()//2, client.height()//2))
        clear_clipboard()
        send_keys('^a^c', pause=.15)
        time.sleep(.6)
        extracted = clipboard_text()
        result['copiedText'] = extracted[:420]
        send_keys('{ESC}^{END}', pause=.2)
        time.sleep(.8)
        result['lastPageFields'] = page_number(window)
        screenshot(window, evidence / (path.stem + '-last.png'))
        result['dialogs'] += dialogs_for(read_windows())
        result['titleMatches'] = any(path.stem.lower() in name.lower() for name in result['titles'])
        result['passed'] = (result['titleMatches'] and 1 in result['firstPageFields'] and
                            pages in result['lastPageFields'] and not result['dialogs'])
        return result
    finally:
        # A clean process exercises every input as a cold open. Only XI was installed.
        subprocess.run(['taskkill','/im','AcroRd32.exe','/f'], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        proc.wait(timeout=15)
        time.sleep(.5)


def main():
    ap=argparse.ArgumentParser()
    ap.add_argument('viewer',type=Path)
    ap.add_argument('pdfs',type=Path)
    ap.add_argument('evidence',type=Path)
    args=ap.parse_args()
    args.evidence.mkdir(parents=True,exist_ok=True)
    report=[]
    for path in sorted(args.pdfs.glob('*.pdf')):
        try:
            record=check(args.viewer,path,args.evidence)
        except Exception as exc:
            record={'file':path.name,'passed':False,'error':str(exc)}
        report.append(record)
        print('XI_DOCUMENT ' + json.dumps(record, ensure_ascii=True),flush=True)
        if any('license agreement' in title.lower() for title,_ in record.get('dialogs',[])):
            break
    (args.evidence/'reader-document-observations.json').write_text(json.dumps(report,indent=2,ensure_ascii=False),encoding='utf8')
    if not report or not all(r['passed'] for r in report if 'legacy' not in r['file'] and 'old-' not in r['file']):
        raise SystemExit(1)


if __name__=='__main__':
    main()
