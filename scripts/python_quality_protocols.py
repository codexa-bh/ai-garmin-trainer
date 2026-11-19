"""Analysis-only Vulture protocol/public-entry names; never imported or executed."""

from http.server import BaseHTTPRequestHandler
from socketserver import ThreadingMixIn
from scripts.desktop import ordinary_smoke

# BaseHTTPRequestHandler dispatches HTTP methods through getattr('do_' + command).
BaseHTTPRequestHandler.do_POST
# BaseHTTPRequestHandler calls the override when logging requests/errors.
BaseHTTPRequestHandler.log_message
# ThreadingMixIn reads this subclass attribute when starting request threads.
ThreadingMixIn.daemon_threads
# Public entry for operator-authored imported compositions, not a test-only helper.
# docs/smoke/protocol.md promises this factory to external run_scenarios callers.
ordinary_smoke.densify_scenario
