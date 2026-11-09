"""Keep the pinned upstream cold-import test isolated in each pytest worker."""
import importlib
import sys

import pytest


@pytest.fixture(autouse=True)
def restore_cold_import_modules(request):
    if (request.node.path.name != "test_registry.py"
            or request.node.name != "test_registry_lazy_no_pdf_tools_import"):
        yield
        return

    # That test removes these modules to check lazy loading, but does not restore
    # them. Later mocks then patch a different module from the one collected by
    # the agentic tests. Restore both import lookup paths after its assertions.
    package = importlib.import_module("pdf_mcp")
    missing = object()
    names = ("registry", "pdf_tools")
    modules = {name: sys.modules.get("pdf_mcp." + name, missing) for name in names}
    attributes = {name: getattr(package, name, missing) for name in names}
    try:
        yield
    finally:
        for name in names:
            if modules[name] is missing:
                sys.modules.pop("pdf_mcp." + name, None)
            else:
                sys.modules["pdf_mcp." + name] = modules[name]
            if attributes[name] is missing:
                package.__dict__.pop(name, None)
            else:
                setattr(package, name, attributes[name])
