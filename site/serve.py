"""Local preview server for Agreement Machinery: serves this folder with caching turned off,
so edits to .tex files (and the site's scripts) show up on reload.   python3 serve.py [port]"""
import http.server, sys, os
os.chdir(os.path.dirname(os.path.abspath(__file__)))
class NoCache(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()
port = int(sys.argv[1]) if len(sys.argv) > 1 else 8765
print(f"Agreement Machinery: http://localhost:{port}")
http.server.ThreadingHTTPServer(("", port), NoCache).serve_forever()
