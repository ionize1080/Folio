"""Preserve document structure with a bounded object-graph recursion budget.

pypdf's documented cloning limit is Python's recursion limit, not a page limit.
Keep the complete root (tags, forms, outlines, attachments); never discard it to
make a difficult file save. Worker processes isolate this setting from the UI.
"""
import sys
from pypdf import PdfWriter

def clone_document(reader):
    before=sys.getrecursionlimit()
    try:
        sys.setrecursionlimit(max(before,5000))
        return PdfWriter(clone_from=reader)
    except RecursionError as exc:
        raise ValueError('PDF 对象层级超过安全写入预算；原文件和编辑草稿已保留') from exc
    finally:
        sys.setrecursionlimit(before)
