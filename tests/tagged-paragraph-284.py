"""Regression for a producer role mapped to P around a separately raised footnote."""
from pathlib import Path
from types import SimpleNamespace
import sys
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "native"))
from structure_scope import annotate_paragraphs, block_owner


class TaggedParagraph(unittest.TestCase):
    def test_role_aliases_and_inline_boundaries(self):
        roles = {"/Introduction": "/TemplateBody", "/TemplateBody": "/P"}
        paragraph = {"/S": "/Introduction"}
        plain = {"/S": "/Span", "/P": paragraph}
        footnote = {"/S": "/Span", "/P": paragraph, "/A": {"/BaselineShift": 3.8}}
        self.assertIs(block_owner(plain, roles), paragraph)
        self.assertIsNone(block_owner(footnote, roles))
        self.assertIsNone(block_owner({"/S": "/Link"}, {"/Link": "/P"}))
        self.assertIsNone(block_owner(paragraph, {"/Introduction": "/Introduction"}))

        class Page(dict):
            pass
        page = Page({"/StructParents": 0})
        page.pdf = SimpleNamespace(root_object={
            "/StructTreeRoot": {"/RoleMap": roles,
                                "/ParentTree": {"/Nums": [0, [paragraph, plain, footnote, paragraph]]}}})
        entries = [{"structureScopes": [{"mcid": i}]} for i in range(4)]
        descriptions = [{"type": "text", "text": t, "flowEditable": True}
                        for t in ("Start", " continued", "1", " end")]
        annotate_paragraphs(page, entries, descriptions)
        a, b, note, c = descriptions
        self.assertEqual(a["structureParagraph"], b["structureParagraph"])
        self.assertNotIn("structureParagraph", note)
        self.assertNotEqual(a["structureParagraph"], c["structureParagraph"])
        self.assertEqual(a["structureOwner"], c["structureOwner"])


if __name__ == "__main__":
    unittest.main()
