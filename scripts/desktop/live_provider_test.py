"""Finite synthetic provider admission/result/owned-shutdown contracts, no native launch."""
import http.client
import json
import unittest
from live_provider import LiveProvider, HOST, OLD, NEW, ANSWER


class LiveProviderTests(unittest.TestCase):
    def test_closed_protocol_and_exact_two_model_results(self):
        provider = LiveProvider(port=0)
        provider.release.set()

        def send(body, path='/v1/chat/completions'):
            client = http.client.HTTPConnection(HOST, provider.server.server_address[1], timeout=2)
            try:
                client.request('POST', path, json.dumps(body), {'Content-Type': 'application/json'})
                response = client.getresponse()
                return response.status, response.read()
            finally:
                client.close()

        try:
            for value in [None, [], {'model': 'arbitrary', 'messages': []}, {'model': OLD, 'messages': [], 'stream': True}]:
                self.assertEqual(send(value)[0], 400)
            self.assertEqual(send({'model': OLD, 'messages': []}, '/arbitrary')[0], 400)
            self.assertEqual(provider.models, [])
            for model in [OLD, NEW]:
                status, raw = send({'model': model, 'messages': []})
                self.assertEqual(status, 200)
                value = json.loads(raw)
                self.assertEqual(value['model'], model)
                terminal = value['choices'][0]['message']['tool_calls'][0]['function']
                self.assertEqual(terminal['name'], 'completeTrainerTurn')
                self.assertEqual(json.loads(terminal['arguments'])['answer'], ANSWER)
            self.assertEqual(provider.models, [OLD, NEW])
            self.assertEqual(send({'model': NEW, 'messages': []})[0], 409)
        finally:
            provider.stop()
        self.assertFalse(provider.thread.is_alive())


if __name__ == '__main__':
    unittest.main()
