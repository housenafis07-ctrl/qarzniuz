import base64
import hashlib
import hmac
import json
import os
import time
import urllib.parse
import urllib.request
from http.server import BaseHTTPRequestHandler

SUPABASE_URL = os.environ.get("SUPABASE_URL", "https://yzicsoyufdghwiezqjsa.supabase.co")
SUPABASE_SERVICE_KEY = os.environ.get("SUPABASE_SERVICE_KEY", "")
ADMIN_PASSWORD = os.environ.get("ADMIN_PANEL_PASSWORD", "")
COOKIE_NAME = "td_admin_session"
SESSION_TTL = 60 * 60 * 12


def send_json(handler, body, status=200, extra_headers=None):
    payload = json.dumps(body, ensure_ascii=False).encode("utf-8")
    handler.send_response(status)
    handler.send_header("Content-Type", "application/json; charset=utf-8")
    handler.send_header("Cache-Control", "no-store")
    handler.send_header("Content-Length", str(len(payload)))
    if extra_headers:
        for key, value in extra_headers.items():
            handler.send_header(key, value)
    handler.end_headers()
    handler.wfile.write(payload)


def read_json(handler):
    length = int(handler.headers.get("Content-Length", "0"))
    raw = handler.rfile.read(length) if length else b"{}"
    return json.loads(raw.decode("utf-8"))


def sign(value):
    return hmac.new(ADMIN_PASSWORD.encode("utf-8"), value.encode("utf-8"), hashlib.sha256).hexdigest()


def make_session():
    issued = str(int(time.time()))
    value = issued + "." + sign(issued)
    return base64.urlsafe_b64encode(value.encode()).decode()


def valid_session(handler):
    header = handler.headers.get("Cookie", "")
    token = None
    for part in header.split(";"):
        part = part.strip()
        if part.startswith(COOKIE_NAME + "="):
            token = part.split("=", 1)[1]
            break
    if not token or not ADMIN_PASSWORD:
        return False
    try:
        decoded = base64.urlsafe_b64decode(token.encode()).decode()
        issued, signature = decoded.split(".", 1)
        if int(time.time()) - int(issued) > SESSION_TTL:
            return False
        return hmac.compare_digest(signature, sign(issued))
    except Exception:
        return False


def supabase_get(table):
    rows = []
    offset = 0
    page_size = 1000
    while True:
        query = urllib.parse.urlencode({"select": "*", "limit": page_size, "offset": offset})
        url = SUPABASE_URL.rstrip("/") + "/rest/v1/" + table + "?" + query
        req = urllib.request.Request(url, method="GET")
        req.add_header("apikey", SUPABASE_SERVICE_KEY)
        req.add_header("Authorization", "Bearer " + SUPABASE_SERVICE_KEY)
        with urllib.request.urlopen(req, timeout=20) as resp:
            chunk = json.loads(resp.read().decode("utf-8"))
        if not isinstance(chunk, list):
            raise RuntimeError("Supabase javobi noto'g'ri")
        rows.extend(chunk)
        if len(chunk) < page_size:
            break
        offset += page_size
        if offset >= 20000:
            break
    return rows


def dashboard_data():
    tables = ["app_users", "analytics_events", "subscriptions", "promo_codes"]
    result = {}
    for table in tables:
        try:
            result[table] = supabase_get(table)
        except Exception as exc:
            result[table] = []
            result[table + "_error"] = str(exc)
    return result


class handler(BaseHTTPRequestHandler):
    def do_GET(self):
        if self.path.rstrip("/") == "/api/admin":
            if not ADMIN_PASSWORD or not SUPABASE_SERVICE_KEY:
                send_json(self, {"ok": False, "error": "Admin server sozlanmagan"}, 500)
                return
            if not valid_session(self):
                send_json(self, {"ok": False, "error": "Unauthorized"}, 401)
                return
            try:
                send_json(self, {"ok": True, "data": dashboard_data()})
            except Exception:
                send_json(self, {"ok": False, "error": "Dashboard ma'lumotlarini olishda xatolik"}, 500)
            return

        if self.path.rstrip("/") == "/api/admin/logout":
            send_json(self, {"ok": True}, 200, {
                "Set-Cookie": f"{COOKIE_NAME}=; Max-Age=0; Path=/; HttpOnly; Secure; SameSite=Strict"
            })
            return

        send_json(self, {"ok": False, "error": "Not found"}, 404)

    def do_POST(self):
        if self.path.rstrip("/") != "/api/admin/login":
            send_json(self, {"ok": False, "error": "Not found"}, 404)
            return

        if not ADMIN_PASSWORD:
            send_json(self, {"ok": False, "error": "ADMIN_PANEL_PASSWORD sozlanmagan"}, 500)
            return

        try:
            body = read_json(self)
            password = str(body.get("password", ""))
        except Exception:
            send_json(self, {"ok": False, "error": "Noto'g'ri so'rov"}, 400)
            return

        if not hmac.compare_digest(password, ADMIN_PASSWORD):
            send_json(self, {"ok": False, "error": "Parol noto'g'ri"}, 401)
            return

        token = make_session()
        send_json(self, {"ok": True}, 200, {
            "Set-Cookie": f"{COOKIE_NAME}={token}; Max-Age={SESSION_TTL}; Path=/; HttpOnly; Secure; SameSite=Strict"
        })

    def do_HEAD(self):
        self.send_response(200)
        self.end_headers()
