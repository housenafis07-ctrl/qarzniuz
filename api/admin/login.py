import base64
import hashlib
import hmac
import json
import os
import time
from http.server import BaseHTTPRequestHandler

ADMIN_PASSWORD = os.environ.get("ADMIN_PANEL_PASSWORD", "")
COOKIE_NAME = "td_admin_session"
SESSION_TTL = 60 * 60 * 12

class handler(BaseHTTPRequestHandler):
    def do_POST(self):
        if not ADMIN_PASSWORD:
            self.send_json({"ok": False, "error": "ADMIN_PANEL_PASSWORD sozlanmagan"}, 500)
            return
        try:
            length = int(self.headers.get("Content-Length", "0"))
            body = json.loads(self.rfile.read(length).decode("utf-8") if length else "{}")
            password = str(body.get("password", ""))
        except Exception:
            self.send_json({"ok": False, "error": "Noto'g'ri so'rov"}, 400)
            return
        if not hmac.compare_digest(password, ADMIN_PASSWORD):
            self.send_json({"ok": False, "error": "Parol noto'g'ri"}, 401)
            return
        issued = str(int(time.time()))
        signature = hmac.new(ADMIN_PASSWORD.encode(), issued.encode(), hashlib.sha256).hexdigest()
        token = base64.urlsafe_b64encode((issued + "." + signature).encode()).decode()
        self.send_json({"ok": True}, 200, {"Set-Cookie": f"{COOKIE_NAME}={token}; Max-Age={SESSION_TTL}; Path=/; HttpOnly; Secure; SameSite=Strict"})

    def send_json(self, body, status=200, headers=None):
        payload = json.dumps(body, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Cache-Control", "no-store")
        if headers:
            for key, value in headers.items(): self.send_header(key, value)
        self.send_header("Content-Length", str(len(payload)))
        self.end_headers()
        self.wfile.write(payload)
