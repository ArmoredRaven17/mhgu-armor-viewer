"""Dev server for the viewer: serves docs/ with caching off, and accepts screenshots.

    python dev/serve.py            # http://localhost:5584/

POST /shot?run=<run>&name=<scene> with a PNG data URL (or raw base64) as the body writes
dev/shots/<run>/<scene>.png. The page's ?scene= harness (index.html) uses it so before/after
renders can be diffed offline. Nothing under dev/ is published; docs/ is what GitHub Pages
serves.
"""
import base64
import http.server
import json
import os
import re
import sys
import urllib.parse

HERE = os.path.dirname(os.path.abspath(__file__))
DOCS = os.path.normpath(os.path.join(HERE, "..", "docs"))
SHOTS = os.path.join(HERE, "shots")
PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 5584
SAFE = re.compile(r"^[A-Za-z0-9_.-]{1,64}$")


class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *a, **k):
        super().__init__(*a, directory=DOCS, **k)

    def end_headers(self):
        # revalidate rather than refetch: the browser sends If-Modified-Since and gets a 304
        # for the multi-megabyte pose and model files, while an edited index.html still lands
        self.send_header("Cache-Control", "no-cache")
        super().end_headers()

    def do_POST(self):
        u = urllib.parse.urlparse(self.path)
        q = urllib.parse.parse_qs(u.query)
        if u.path != "/shot":
            self.send_error(404)
            return
        run = q.get("run", ["default"])[0]
        name = q.get("name", ["shot"])[0]
        if not (SAFE.match(run) and SAFE.match(name)):
            self.send_error(400, "bad run/name")
            return
        n = int(self.headers.get("Content-Length", 0))
        body = self.rfile.read(n)
        if body.startswith(b"data:"):
            body = body.split(b",", 1)[1]
        try:
            png = base64.b64decode(body)
        except Exception:
            self.send_error(400, "not base64")
            return
        folder = os.path.join(SHOTS, run)
        os.makedirs(folder, exist_ok=True)
        path = os.path.join(folder, name + ".png")
        with open(path, "wb") as f:
            f.write(png)
        out = json.dumps({"saved": path, "bytes": len(png)}).encode()
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(out)))
        self.end_headers()
        self.wfile.write(out)

    def log_message(self, fmt, *args):
        if "/shot" in (args[0] if args else ""):
            sys.stderr.write("%s\n" % (fmt % args))


if __name__ == "__main__":
    os.makedirs(SHOTS, exist_ok=True)
    srv = http.server.ThreadingHTTPServer(("127.0.0.1", PORT), Handler)
    print("serving %s on http://localhost:%d/  (shots -> %s)" % (DOCS, PORT, SHOTS), flush=True)
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        pass
