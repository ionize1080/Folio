"""Full upstream tool registry on synchronous stdio; no sockets or listeners.
Avoid asyncio's Windows TCP socketpair wakeup, preserving upstream schemas,
argument validation and tool implementations. Hosted AI runs only in Chatbox.
"""
import contextlib
import json
import socket
import sys
import os
import tempfile
from pathlib import Path

def denied(*args, **kwargs):
    raise PermissionError('PDF MCP is local-only. External model work must use Chatbox.')
# Windows asyncio normally creates a loopback TCP wakeup pair. Use AF_UNIX
# filesystem sockets for optional upstream internals, never a network port.
_bind, _connect, _listen = socket.socket.bind, socket.socket.connect, socket.socket.listen
def local_socketpair(*args, **kwargs):
    name = tempfile.mktemp(prefix='folio-sock-')
    listener = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
    client = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
    try:
        _bind(listener, name); _listen(listener, 1); _connect(client, name)
        accepted, _ = listener.accept()
        return accepted, client
    except Exception:
        client.close(); raise
    finally:
        listener.close()
        if os.path.exists(name): os.unlink(name)
socket.socketpair = local_socketpair
for method in ('connect', 'connect_ex', 'bind', 'listen', 'sendto'):
    setattr(socket.socket, method, denied)
socket.create_connection = denied
socket.getaddrinfo = denied
with contextlib.redirect_stdout(sys.stderr):
    import pytesseract
    portable = Path(__file__).resolve().parent / 'tesseract' / 'tesseract.exe'
    if not portable.exists(): portable = Path(__file__).resolve().parent.parent / '.ai-runtime' / 'tesseract' / 'tesseract.exe'
    if portable.exists():
        pytesseract.pytesseract.tesseract_cmd = str(portable)
        os.environ['TESSDATA_PREFIX'] = str(portable.parent / 'tessdata')
    from pdf_mcp.server import mcp
from pdf_objects import install
install(mcp)
registry = {tool.name: tool for tool in mcp._tool_manager.list_tools()}
if any(tool.is_async for tool in registry.values()):
    raise RuntimeError('Pinned upstream now has async tools; review the stdio adapter.')

def dispatch(method, params):
    if method == 'initialize':
        return {'protocolVersion': '2025-03-26', 'capabilities': {'tools': {}}, 'serverInfo': {'name': 'Folio PDF (upstream registry)', 'version': '2.0.0'}}
    if method == 'ping': return {}
    if method == 'tools/list':
        return {'tools': [{'name': t.name, 'description': t.description, 'inputSchema': t.parameters} for t in registry.values()]}
    if method == 'tools/call':
        try:
            tool = registry[params['name']]
            arguments = tool.fn_metadata.validate_arguments(params.get('arguments') or {})
            with contextlib.redirect_stdout(sys.stderr): result = tool.fn(**arguments)
            if isinstance(result,dict) and isinstance(result.get('content'),list): return result
            if isinstance(result, dict) and 'error' in result:
                return {'isError': True, 'content': [{'type': 'text', 'text': str(result['error'])}]}
            return tool.fn_metadata.convert_result(result).model_dump(mode='json', by_alias=True, exclude_none=True)
        except Exception as error:
            return {'isError': True, 'content': [{'type': 'text', 'text': str(error)}]}
    raise ValueError('Method not found')

for line in iter(lambda: sys.stdin.buffer.readline(16 * 1024 * 1024 + 1), b''):
    if len(line) > 16 * 1024 * 1024: raise RuntimeError('Request exceeds budget')
    request = None
    try:
        request = json.loads(line)
        if 'id' not in request: continue
        result = dispatch(request.get('method'), request.get('params') or {})
        response = {'jsonrpc': '2.0', 'id': request['id'], 'result': result}
    except Exception as error:
        response = {'jsonrpc': '2.0', 'id': request.get('id') if isinstance(request, dict) else None, 'error': {'code': -32603, 'message': str(error)}}
    print(json.dumps(response, ensure_ascii=True), flush=True)
