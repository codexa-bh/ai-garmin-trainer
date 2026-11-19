"""Analysis-only Vulture protocol names; never imported or executed."""

from http.server import BaseHTTPRequestHandler
from socketserver import ThreadingMixIn

# BaseHTTPRequestHandler dispatches HTTP methods through getattr('do_' + command).
BaseHTTPRequestHandler.do_POST
# BaseHTTPRequestHandler calls the override when logging requests/errors.
BaseHTTPRequestHandler.log_message
# ThreadingMixIn reads this subclass attribute when starting request threads.
ThreadingMixIn.daemon_threads
