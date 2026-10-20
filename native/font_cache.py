"""Publish content-addressed fonts without exposing partial files to workers."""
import hashlib
import errno
import json
import os
import re
import tempfile
import time
from pathlib import Path


def sharing_violation(error):
    # pathlib's Windows read-open failures can have errno=EACCES without a
    # winerror, whereas replace reports Win32 sharing/access-denied codes.
    return os.name == 'nt' and (
        getattr(error, 'winerror', None) in (5, 32, 33)
        or isinstance(error, PermissionError) and error.errno == errno.EACCES)


def _matches(path, data):
    try:
        return path.stat().st_size == len(data) and path.read_bytes() == data
    except OSError:
        return False


def _publish(path, data):
    if _matches(path, data):
        return
    fd, temporary = tempfile.mkstemp(dir=path.parent, suffix='.font.tmp')
    try:
        with os.fdopen(fd, 'wb') as stream:
            stream.write(data)
        # A concurrent worker may already have published the identical file.
        # Avoid replacing a live font program on Windows in that case.
        for attempt in range(7):
            if _matches(path, data):
                break
            try:
                os.replace(temporary, path)
                break
            except OSError as error:
                if _matches(path, data):
                    break
                # Windows readers may briefly deny delete/replace sharing.
                # Keep the complete temporary file and bound that wait to
                # 126 ms; permission and I/O failures still surface otherwise.
                if not sharing_violation(error) or attempt == 6:
                    raise
                time.sleep(.002 * 2**attempt)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)


def _valid_metadata(info):
    return (isinstance(info, dict) and isinstance(info.get('name'), str)
            and isinstance(info.get('coverage'), list)
            and all(type(cp) is int and 0 <= cp <= 0x10ffff for cp in info['coverage']))


def publish_font(cache, key, blob, info):
    """Repair interrupted old entries; publish the complete program before JSON.

    Readers use JSON as the availability marker. Identical entries retain their
    timestamps, so repeated selections do not invalidate loaded coverage caches.
    """
    if not isinstance(key, str) or not re.fullmatch('[0-9a-f]{32}', key):
        raise ValueError('Invalid font cache key')
    if hashlib.sha256(blob).hexdigest()[:32] != key:
        raise ValueError('Font cache content does not match its key')
    if not _valid_metadata(info):
        raise ValueError('Invalid font cache metadata')
    cache = Path(cache)
    cache.mkdir(parents=True, exist_ok=True)
    _publish(cache/(key+'.ttf'), blob)
    path = cache/(key+'.json')
    # Existing writers used different JSON whitespace/order. Semantic equality
    # keeps their valid entries stable too; malformed JSON is atomically repaired.
    try:
        previous = json.loads(path.read_text(encoding='utf-8'))
        if _valid_metadata(previous):
            # Names can be aliases of the same content and codepoint order is
            # irrelevant. Retain those valid entries, including their timestamp.
            if (previous.get('coverageVersion') == info.get('coverageVersion')
                    and set(previous['coverage']) == set(info['coverage'])):
                return
            # A system/builtin writer has not validated subset metrics. Its
            # broader legacy coverage must never replace verified v2 coverage.
            if previous.get('coverageVersion') == 2 and info.get('coverageVersion') != 2:
                return
    except (OSError, ValueError):
        pass
    _publish(path, json.dumps(info, ensure_ascii=True, sort_keys=True).encode('utf-8'))
