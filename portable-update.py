"""Transactional portable update, run by a private copy of bundled Python."""
import ctypes
from ctypes import wintypes
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import time
import uuid
import zipfile

def digest(file):
    with open(file, 'rb') as stream:
        return hashlib.file_digest(stream, 'sha256').hexdigest()

def write(file, value):
    file = Path(file)
    tmp = file.with_name(file.name + '.tmp')
    tmp.write_text(json.dumps(value), encoding='utf-8')
    os.replace(tmp, file)

def move(source, target):
    until = time.monotonic() + 20
    while True:
        try:
            Path(source).rename(target)
            return
        except OSError:
            if time.monotonic() >= until:
                raise
            time.sleep(.3)

def extract(archive, stage):
    names, total = set(), 0
    with zipfile.ZipFile(archive) as z:
        for item in z.infolist():
            name = item.filename.replace('\\', '/')
            parts = name.rstrip('/').split('/')
            if (not name.startswith('Folio-PDF-Studio/') or any(p in ('', '.', '..') or ':' in p or p.endswith((' ', '.')) for p in parts)
                    or name.lower() in names or (item.external_attr >> 16) & 0xF000 == 0xA000):
                raise ValueError('Unsafe archive path')
            names.add(name.lower())
            total += item.file_size
            if total > 16 * 1024**3:
                raise ValueError('Expanded archive exceeds budget')
        z.extractall(stage)

def run(manifest):
    m = json.loads(Path(manifest).read_text(encoding='utf-8-sig'))
    target = Path(m['target']).resolve()
    if target == target.parent or not (target / 'Folio.exe').is_file():
        raise ValueError('Invalid installation directory')
    stage = target.parent / ('.folio-update-' + uuid.uuid4().hex)
    backup = target.with_name(target.name + '.backup-' + uuid.uuid4().hex)
    assert stage.parent == target.parent and backup.parent == target.parent
    log = Path(manifest).parent / 'install.log'
    moved, child = False, None
    kernel = ctypes.WinDLL('kernel32', use_last_error=True)
    kernel.OpenProcess.argtypes = [wintypes.DWORD, wintypes.BOOL, wintypes.DWORD]
    kernel.OpenProcess.restype = wintypes.HANDLE
    kernel.WaitForSingleObject.argtypes = [wintypes.HANDLE, wintypes.DWORD]
    kernel.CloseHandle.argtypes = [wintypes.HANDLE]
    parent = kernel.OpenProcess(0x100000, False, int(m['pid']))
    if not parent:
        raise OSError('Cannot monitor original process')
    def report(phase, message):
        write(m['statusFile'], dict(phase=phase, message=message, version=m['version'], target=str(target), backup=str(backup), log=str(log)))
        with log.open('a', encoding='utf-8') as f:
            f.write(phase + ': ' + message + '\n')
    def start(health=False):
        args = [str(target / 'Folio.exe')]
        if m.get('userData'):
            args.append('--user-data-dir=' + m['userData'])
        if health:
            args.append('--folio-update-health=' + m['healthFile'])
        return subprocess.Popen(args, cwd=target)
    write(str(manifest) + '.helper.json', {'pid': os.getpid()})
    try:
        report('preparing', 'Verifying and extracting the update. Keep Folio open.')
        if digest(m['file']) != m['hash']:
            raise ValueError('Update checksum mismatch')
        stage.mkdir()
        extract(m['file'], stage)
        new = stage / 'Folio-PDF-Studio'
        info = json.loads((new / 'BUILD-INFO.json').read_text(encoding='utf-8'))
        for file, key in [('Folio.exe', 'exe_sha256'), ('resources/app.asar', 'asar_sha256')]:
            if digest(new / file) != info[key]:
                raise ValueError('Packaged binary checksum mismatch')
        version = info['version'] + ('-' + info['releaseChannel'] if info.get('releaseChannel') else '')
        if version.lower() != m['version'].lstrip('v').lower():
            raise ValueError('Packaged version mismatch')
        report('ready', 'Verified. Waiting for Folio to close.')
        if kernel.WaitForSingleObject(parent, 120000) != 0:
            raise TimeoutError('Folio did not close; installation cancelled')
        commit = json.loads(Path(m['commitFile']).read_text(encoding='utf-8'))
        if not m.get('token') or commit.get('token') != m['token']:
            raise ValueError('Installation was not acknowledged')
        report('replacing', 'Installing in the original folder.')
        move(target, backup)
        moved = True
        move(new, target)
        Path(m['healthFile']).unlink(missing_ok=True)
        child = start(True)
        report('starting', 'Starting the new version and checking its window.')
        until = time.monotonic() + 45
        while not Path(m['healthFile']).exists():
            if time.monotonic() >= until or child.poll() is not None:
                raise RuntimeError('The new Folio window did not become ready')
            time.sleep(.25)
        health = json.loads(Path(m['healthFile']).read_text(encoding='utf-8-sig'))
        if health['version'].lower() != version.lower() or health['pid'] != child.pid:
            raise ValueError('Restarted version or process mismatch')
        report('complete', 'Updated. Rollback copy: ' + str(backup))
    except Exception as error:
        if child and child.poll() is None:
            subprocess.run(['taskkill.exe', '/PID', str(child.pid), '/T', '/F'], creationflags=0x08000000, capture_output=True)
        if moved:
            if target.exists():
                move(target, str(stage) + '-failed')
            move(backup, target)
        report('failed', 'Original retained: ' + str(error))
        if kernel.WaitForSingleObject(parent, 0) == 0:
            start()
        raise
    finally:
        kernel.CloseHandle(parent)
        if stage.exists():
            shutil.rmtree(stage)

if __name__ == '__main__':
    run(sys.argv[1])
