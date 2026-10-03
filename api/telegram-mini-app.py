import hashlib
import hmac
import json
import os
import time
import urllib.error
import urllib.parse
import urllib.request
from http.server import BaseHTTPRequestHandler

BOT_TOKEN = os.environ.get("BOT_TOKEN", "")
SUPABASE_URL = os.environ.get(
    "SUPABASE_URL", "https://yzicsoyufdghwiezqjsa.supabase.co"
).rstrip("/")
SUPABASE_SERVICE_KEY = os.environ.get("SUPABASE_SERVICE_KEY", "")
SUPABASE_ANON_KEY = os.environ.get("SUPABASE_ANON_KEY", "")
MAX_INIT_DATA_AGE = int(os.environ.get("TELEGRAM_INIT_DATA_MAX_AGE", "86400"))


def send_json(h, body, status=200):
    raw = json.dumps(body, ensure_ascii=False, default=str).encode("utf-8")
    h.send_response(status)
    h.send_header("Content-Type", "application/json; charset=utf-8")
    h.send_header("Cache-Control", "no-store")
    h.send_header("Content-Length", str(len(raw)))
    h.end_headers()
    h.wfile.write(raw)


def read_json(h):
    n = int(h.headers.get("Content-Length", "0"))
    raw = h.rfile.read(n) if n else b"{}"
    return json.loads(raw.decode("utf-8"))


def telegram_secret_key(bot_token):
    return hmac.new(b"WebAppData", bot_token.encode("utf-8"), hashlib.sha256).digest()


def validate_init_data(init_data):
    if not BOT_TOKEN:
        raise RuntimeError("BOT_TOKEN konfiguratsiyasi topilmadi")
    if not init_data or len(init_data) > 4096:
        raise PermissionError("Telegram initData noto'g'ri")

    pairs = urllib.parse.parse_qs(init_data, keep_blank_values=True)
    received_hash = pairs.pop("hash", [None])[0]
    if not received_hash:
        raise PermissionError("Telegram signature topilmadi")

    data_check = []
    for key in sorted(pairs):
        for value in pairs[key]:
            data_check.append(f"{key}={value}")
    data_check_string = "\n".join(data_check)

    expected = hmac.new(
        telegram_secret_key(BOT_TOKEN),
        data_check_string.encode("utf-8"),
        hashlib.sha256,
    ).hexdigest()

    if not hmac.compare_digest(expected, received_hash):
        raise PermissionError("Telegram signature yaroqsiz")

    auth_date = int(pairs.get("auth_date", ["0"])[0] or 0)
    if auth_date <= 0 or int(time.time()) - auth_date > MAX_INIT_DATA_AGE:
        raise PermissionError("Telegram sessiyasi eskirgan")

    user_raw = pairs.get("user", ["{}"])[0]
    try:
        tg_user = json.loads(user_raw)
    except json.JSONDecodeError:
        raise PermissionError("Telegram user ma'lumoti noto'g'ri")

    tg_id = tg_user.get("id")
    if not tg_id:
        raise PermissionError("Telegram user ID topilmadi")

    return {
        "telegram_user_id": int(tg_id),
        "username": str(tg_user.get("username") or "")[:255],
        "first_name": str(tg_user.get("first_name") or "")[:255],
        "last_name": str(tg_user.get("last_name") or "")[:255],
    }


def supabase_request(method, path, query=None, body=None, bearer=None, prefer=None):
    key = SUPABASE_SERVICE_KEY or SUPABASE_ANON_KEY
    auth = bearer or SUPABASE_SERVICE_KEY
    if not SUPABASE_URL or not key or not auth:
        raise RuntimeError("Supabase server konfiguratsiyasi to'liq emas")

    url = SUPABASE_URL + path
    if query:
        parts = []
        for qkey, qvalue in query.items():
            parts.append(
                urllib.parse.quote(str(qkey), safe="") + "=" + str(qvalue)
            )
        url += "?" + "&".join(parts)

    raw = json.dumps(body, ensure_ascii=False).encode("utf-8") if body is not None else None
    req = urllib.request.Request(url, data=raw, method=method)
    req.add_header("apikey", key)
    req.add_header("Authorization", "Bearer " + auth)
    req.add_header("Content-Type", "application/json")
    req.add_header("Accept", "application/json")
    req.add_header("Prefer", prefer or "return=representation")

    try:
        with urllib.request.urlopen(req, timeout=15) as r:
            text = r.read().decode("utf-8")
            return json.loads(text) if text else []
    except urllib.error.HTTPError as e:
        detail = e.read().decode("utf-8", errors="replace")
        raise RuntimeError(detail[:1000])


def require_supabase_user(h):
    auth = h.headers.get("Authorization", "")
    if not auth.lower().startswith("bearer "):
        raise PermissionError("QarzniUz sessiyasi topilmadi")

    token = auth.split(" ", 1)[1].strip()
    key = SUPABASE_ANON_KEY or SUPABASE_SERVICE_KEY
    req = urllib.request.Request(SUPABASE_URL + "/auth/v1/user", method="GET")
    req.add_header("apikey", key)
    req.add_header("Authorization", "Bearer " + token)

    try:
        with urllib.request.urlopen(req, timeout=15) as r:
            user = json.loads(r.read().decode("utf-8"))
    except Exception:
        raise PermissionError("QarzniUz sessiyasi yaroqsiz")

    if not user.get("id"):
        raise PermissionError("QarzniUz foydalanuvchisi aniqlanmadi")
    return user, token


def get_all_telegram_links():
    # Avoid PostgREST eq filters for this small link table. The previous
    # implementation reached PostgREST with the operator stripped and caused
    # PGRST100. The main debt/customer tables are not queried here.
    return supabase_request(
        "GET",
        "/rest/v1/telegram_accounts",
        {"select": "*"},
    )


def get_link(telegram_user_id):
    target = int(telegram_user_id)
    for row in get_all_telegram_links():
        if int(row.get("telegram_user_id") or 0) == target:
            return row
    return None


def get_link_by_qz_user(user_id):
    target = str(user_id)
    for row in get_all_telegram_links():
        if str(row.get("user_id") or "") == target:
            return row
    return None


def upsert_link(payload):
    return supabase_request(
        "POST",
        "/rest/v1/telegram_accounts",
        {"on_conflict": "telegram_user_id"},
        payload,
        prefer="resolution=merge-duplicates,return=representation",
    )[0]


def link_account(tg_user, qz_user):
    existing_tg = get_link(tg_user["telegram_user_id"])
    if existing_tg and existing_tg.get("user_id") != qz_user["id"]:
        raise PermissionError("Bu Telegram akkaunti boshqa QarzniUz akkauntiga ulangan")

    existing_qz = get_link_by_qz_user(qz_user["id"])
    if existing_qz and int(existing_qz.get("telegram_user_id") or 0) != tg_user["telegram_user_id"]:
        raise PermissionError("Bu QarzniUz akkauntiga boshqa Telegram akkaunti ulangan")

    payload = {
        "telegram_user_id": tg_user["telegram_user_id"],
        "user_id": qz_user["id"],
        "telegram_username": tg_user["username"] or None,
        "telegram_first_name": tg_user["first_name"] or None,
        "telegram_last_name": tg_user["last_name"] or None,
        "status": "active",
        "last_seen_at": __import__("datetime").datetime.now(
            __import__("datetime").timezone.utc
        ).isoformat(),
    }

    if existing_tg:
        payload["id"] = existing_tg["id"]

    return upsert_link(payload)


class handler(BaseHTTPRequestHandler):
    def do_GET(self):
        try:
            params = urllib.parse.parse_qs(
                urllib.parse.urlparse(self.path).query, keep_blank_values=True
            )
            init_data = params.get("initData", [""])[0]
            tg_user = validate_init_data(init_data)
            link = get_link(tg_user["telegram_user_id"])

            send_json(self, {
                "ok": True,
                "data": {
                    "telegram": tg_user,
                    "linked": bool(link and link.get("status") == "active"),
                    "user_id": link.get("user_id") if link else None,
                },
            })
        except PermissionError as e:
            send_json(self, {"ok": False, "error": str(e)}, 401)
        except Exception as e:
            send_json(self, {"ok": False, "error": str(e)}, 500)

    def do_POST(self):
        try:
            body = read_json(self)
            init_data = str(body.get("initData") or "")
            tg_user = validate_init_data(init_data)
            action = str(body.get("action") or "").lower()

            if action == "status":
                link = get_link(tg_user["telegram_user_id"])
                send_json(self, {
                    "ok": True,
                    "data": {
                        "telegram": tg_user,
                        "linked": bool(link and link.get("status") == "active"),
                        "user_id": link.get("user_id") if link else None,
                    },
                })
                return

            if action == "link":
                qz_user, _ = require_supabase_user(self)
                link = link_account(tg_user, qz_user)
                send_json(self, {
                    "ok": True,
                    "data": {
                        "linked": True,
                        "telegram_user_id": tg_user["telegram_user_id"],
                        "user_id": qz_user["id"],
                    },
                })
                return

            raise RuntimeError("Noma'lum amal")
        except PermissionError as e:
            send_json(self, {"ok": False, "error": str(e)}, 401)
        except Exception as e:
            send_json(self, {"ok": False, "error": str(e)}, 400)

    def do_HEAD(self):
        self.send_response(200)
        self.end_headers()
