"""Finite task-owned fake Ollama service for captured native chat evidence only."""
import http.client
import json
import threading
from concurrent.futures import ThreadPoolExecutor
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

HOST = '127.0.0.1'
PORT = 11435
OLD = 'qwen3.5:4b'
NEW = 'Synthetic/Local:two'
ANSWER = 'Synthetic local snapshot retained.'


class LiveProvider:
    def __init__(self, port=PORT):
        if port not in [0, PORT]:
            raise ValueError('Only fixed native fixture or isolated unit-test ephemeral port')
        self.entered = threading.Event()
        self.release = threading.Event()
        self.models = []
        owner = self

        class Handler(BaseHTTPRequestHandler):
            def log_message(self, *_args):
                pass  # Never log request bodies, headers, prompts or credentials.

            def do_POST(self):
                self.connection.settimeout(5)
                length = self.headers.get('Content-Length', '')
                if self.path != '/v1/chat/completions' or not length.isdigit() or not 0 < int(length) <= 256 * 1024 or self.headers.get('Transfer-Encoding'):
                    self.send_error(400)
                    return
                try:
                    body = json.loads(self.rfile.read(int(length)))
                    if body.get('model') not in [OLD, NEW] or body.get('stream') is True or not isinstance(body.get('messages'), list):
                        raise ValueError('Fixed synthetic protocol only')
                except (ValueError, TypeError, AttributeError):
                    self.send_error(400)
                    return
                if len(owner.models) >= 2:
                    self.send_error(409)
                    return
                model = body['model']
                owner.models.append(model)
                if len(owner.models) == 1:
                    owner.entered.set()
                    if not owner.release.wait(20):
                        self.send_error(504)
                        return
                completion = {'kind': 'coaching', 'answer': ANSWER, 'claims': [], 'missingEvidence': []}
                value = {'id': 'synthetic-completion', 'object': 'chat.completion', 'created': 1, 'model': model,
                         'choices': [{'index': 0, 'finish_reason': 'tool_calls', 'message': {'role': 'assistant', 'content': None, 'tool_calls': [{'id': 'synthetic-terminal', 'type': 'function', 'function': {'name': 'completeTrainerTurn', 'arguments': json.dumps(completion)}}]}}],
                         'usage': {'prompt_tokens': 1, 'completion_tokens': 1, 'total_tokens': 2}}
                raw = json.dumps(value).encode()
                self.send_response(200)
                self.send_header('Content-Type', 'application/json')
                self.send_header('Content-Length', str(len(raw)))
                self.end_headers()
                self.wfile.write(raw)

        self.server = ThreadingHTTPServer((HOST, port), Handler)
        self.server.daemon_threads = True
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()

    def stop(self):
        self.release.set()
        self.server.shutdown()
        self.server.server_close()
        self.thread.join(2)
        if hasattr(self, 'pool'):
            self.pool.shutdown(wait=True)
        if self.thread.is_alive():
            raise RuntimeError('Owned synthetic provider did not settle')

    def chat(self, run, conversation, stream):
        client = http.client.HTTPConnection(HOST, int(run.origin.rsplit(':', 1)[1]), timeout=25)
        try:
            client.request('POST', '/api/chat', json.dumps({'conversationId': conversation, 'message': 'T0257 synthetic local configuration retention check.', 'stream': stream}), {'Content-Type': 'application/json'})
            response = client.getresponse()
            raw = response.read(256 * 1024 + 1)
            if response.status != 200 or len(raw) > 256 * 1024 or ANSWER.encode() not in raw:
                raise ValueError('Actual synthetic chat did not complete')
            if stream:
                events = [json.loads(line) for line in raw.splitlines() if line]
                if not any(event.get('type') == 'done' for event in events) or any(event.get('type') == 'error' for event in events):
                    raise ValueError('Actual native stream did not settle successfully')
            return True
        finally:
            client.close()

    def begin(self, run, conversation):
        self.pool = ThreadPoolExecutor(max_workers=1)
        self.pending = self.pool.submit(self.chat, run, conversation, True)
        if not self.entered.wait(8):
            self.release.set()
            self.pool.shutdown(wait=False)
            raise ValueError('Actual native generation never reached owned synthetic barrier')
        if self.models != [OLD]:
            raise ValueError('First operation did not capture startup model')

    def finish(self, run, second_conversation):
        try:
            if not self.chat(run, second_conversation, False) or self.models != [OLD, NEW]:
                raise ValueError('Subsequent native generation did not use new model')
            self.release.set()
            if not self.pending.result(timeout=8):
                raise ValueError('Captured stream failed after live Save')
            return {'capturedStreamCompleted': True, 'oldModelRetained': True, 'subsequentModelUpdated': True, 'provider': 'fixed task-owned loopback synthetic; no real service'}
        finally:
            self.release.set()
            self.pool.shutdown(wait=True)
