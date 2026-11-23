#!/usr/bin/env python3
"""Zero-dependency local dev server for Gere (serves ./public on port 8080)."""

import http.server
import mimetypes
import os
import socketserver
import sys
from pathlib import Path

PORT = 8080
PUBLIC_DIR = Path(__file__).resolve().parent / "public"

mimetypes.add_type("application/javascript; charset=utf-8", ".js")
mimetypes.add_type("text/css; charset=utf-8", ".css")
mimetypes.add_type("image/svg+xml", ".svg")
mimetypes.add_type("application/manifest+json; charset=utf-8", ".json")


class GereRequestHandler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(PUBLIC_DIR), **kwargs)

    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        super().end_headers()

    def log_message(self, format_str, *args):
        sys.stdout.write(f"[Gere] {self.address_string()} - {format_str % args}\n")


if __name__ == "__main__":
    if not PUBLIC_DIR.is_dir():
        sys.exit(f"Error: {PUBLIC_DIR} not found.")
    os.chdir(PUBLIC_DIR)
    socketserver.TCPServer.allow_reuse_address = True
    with socketserver.TCPServer(("127.0.0.1", PORT), GereRequestHandler) as httpd:
        print(f"Gere local server running at http://localhost:{PORT}")
        print("Note: Online multiplayer & live reviews require `npx wrangler dev --port 8080`.")
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            print("\nShutting down.")