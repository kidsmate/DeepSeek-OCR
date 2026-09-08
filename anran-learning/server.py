#!/usr/bin/env python3
"""HTTP server that forces download for .zip files"""
import http.server
import os
from urllib.parse import unquote

PORT = 8080
ROOT = os.path.dirname(os.path.abspath(__file__))


class Handler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        # Force download for zip files
        if self.path.endswith('.zip'):
            filename = os.path.basename(unquote(self.path))
            self.send_header('Content-Disposition', f'attachment; filename="{filename}"')
            self.send_header('Content-Type', 'application/zip')
        super().end_headers()

    def log_message(self, format, *args):
        print(f"[{self.log_date_time_string()}] {args[0]}")


if __name__ == '__main__':
    os.chdir(ROOT)
    server = http.server.HTTPServer(('', PORT), Handler)
    print(f"Serving {ROOT} on port {PORT}")
    server.serve_forever()
