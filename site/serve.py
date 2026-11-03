"""Local preview server for Agreement Machinery: serves this folder with caching turned off,
so edits to .tex files (and the site's scripts) show up on reload.   python3 serve.py [port]

It also compiles the PDF for the page's "Read as PDF" button: POST /build-pdf runs thesis/build.py
(which writes site/agreement-machinery.pdf) and answers with whether it worked and the build's output.
Only requests from this computer can start a build. TinyTeX in ~/Library/TinyTeX is used if it's there."""
import glob, http.server, json, os, shutil, subprocess, sys, threading
HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
os.chdir(HERE)

BUILD_LOCK = threading.Lock()
INSTALL_HINT = """Install LaTeX and the thesis packages (TinyTeX, about 300 MB, no admin password needed):

curl -sL "https://yihui.org/tinytex/install-bin-unix.sh" | sh -s - "$(mktemp -d)" --no-path
~/Library/TinyTeX/bin/*/tlmgr update --self
~/Library/TinyTeX/bin/*/tlmgr install $(grep -v '^#' thesis/texlive-packages.txt)

(run these in the project folder), then press Read as PDF again."""


def build_pdf():
    env = dict(os.environ)
    tinytex = glob.glob(os.path.expanduser("~/Library/TinyTeX/bin/*")) + glob.glob(os.path.expanduser("~/.TinyTeX/bin/*"))
    env["PATH"] = os.pathsep.join(tinytex + [env.get("PATH", ""), "/Library/TeX/texbin"])
    missing = [t for t in ("xelatex", "biber") if not shutil.which(t, path=env["PATH"])]
    if missing:
        return False, f"Couldn't find {' or '.join(missing)}.\n\n{INSTALL_HINT}"
    r = subprocess.run([sys.executable, os.path.join(ROOT, "thesis", "build.py")], cwd=ROOT, env=env,
                       capture_output=True, text=True)
    log = r.stdout + r.stderr
    if r.returncode != 0 and ".sty' not found" in log:
        log = f"A LaTeX package is missing.\n\n{INSTALL_HINT}\n\n--- build output ---\n{log}"
    return r.returncode == 0, log


class Handler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def do_POST(self):
        if self.path != "/build-pdf":
            return self.send_error(404)
        if self.client_address[0] not in ("127.0.0.1", "::1", "::ffff:127.0.0.1"):
            return self.send_error(403, "PDF builds can only be started from this computer")
        with BUILD_LOCK:  # one build at a time; a second press waits for the first
            ok, log = build_pdf()
        body = json.dumps({"ok": ok, "log": log}).encode()
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)


port = int(sys.argv[1]) if len(sys.argv) > 1 else 8765
print(f"Agreement Machinery: http://localhost:{port}")
http.server.ThreadingHTTPServer(("", port), Handler).serve_forever()
