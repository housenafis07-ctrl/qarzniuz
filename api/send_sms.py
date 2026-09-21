import base64
import hashlib
import hmac
import json
import os
import time
import urllib.parse
import urllib.request
from http.server import BaseHTTPRequestHandler


ESKIZ_EMAIL = os.environ.get("ESKIZ_EMAIL", "")
ESKIZ_PASSWORD = os.environ.get("ESKIZ_PASSWORD", "")
ESKIZ_FROM = os.environ.get("ESKIZ_FROM", "4546")
SEND_SMS_HOOK_SECRET = os.environ.get("SEND_SMS_HOOK_SECRET", "")

ESKIZ_LOGIN_URL = "https://notify.eskiz.uz/api/auth/login"
ESKIZ_SEND_URL = "https://notify.eskiz.uz/api/message/sms/send"

# Reuse the token during a warm Vercel function invocation.
_eskiz_token = None


def json_response(handler, body, status=200):
    payload = json.dumps(body, ensure_ascii=False).encode("utf-8")
    handler.send_response(status)
    handler.send_header("Content-Type", "application/json; charset=utf-8")
    handler.send_header("Content-Length", str(len(payload)))
    handler.end_headers()
    handler.wfile.write(payload)


def get_eskiz_token(force_refresh=False):
    global _eskiz_token

    if _eskiz_token and not force_refresh:
        return _eskiz_token

    if not ESKIZ_EMAIL or not ESKIZ_PASSWORD:
        raise RuntimeError("Eskiz credentials are not configured")

    body = urllib.parse.urlencode({
        "email": ESKIZ_EMAIL,
        "password": ESKIZ_PASSWORD,
    }).encode("utf-8")

    req = urllib.request.Request(ESKIZ_LOGIN_URL, data=body, method="POST")
    req.add_header("Content-Type", "application/x-www-form-urlencoded")

    with urllib.request.urlopen(req, timeout=4) as response:
        data = json.loads(response.read().decode("utf-8"))

    token = (data.get("data") or {}).get("token")
    if not token:
        raise RuntimeError("Eskiz did not return an access token")

    _eskiz_token = token
    return token


def send_eskiz_sms(phone, otp):
    # Supabase sends E.164 numbers such as +998901234567.
    mobile_phone = "".join(ch for ch in str(phone) if ch.isdigit())
    message = f"TemirDaftar tasdiqlash kodi: {otp}"

    for attempt in range(2):
        token = get_eskiz_token(force_refresh=(attempt == 1))
        payload = urllib.parse.urlencode({
            "mobile_phone": mobile_phone,
            "message": message,
            "from": ESKIZ_FROM,
        }).encode("utf-8")

        req = urllib.request.Request(ESKIZ_SEND_URL, data=payload, method="POST")
        req.add_header("Authorization", f"Bearer {token}")
        req.add_header("Content-Type", "application/x-www-form-urlencoded")

        try:
            with urllib.request.urlopen(req, timeout=4) as response:
                return response.status, response.read().decode("utf-8", errors="replace")
        except urllib.error.HTTPError as exc:
            if exc.code == 401 and attempt == 0:
                continue
            error_body = exc.read().decode("utf-8", errors="replace")
            raise RuntimeError(f"Eskiz SMS failed ({exc.code}): {error_body[:500]}")

    raise RuntimeError("Eskiz SMS failed")


def verify_supabase_hook(raw_body, headers):
    """Verify Supabase HTTP Hook using Standard Webhooks headers."""
    if not SEND_SMS_HOOK_SECRET:
        raise RuntimeError("SEND_SMS_HOOK_SECRET is not configured")

    # Supabase dashboard normally supplies v1,whsec_<base64-secret>.
    secret = SEND_SMS_HOOK_SECRET
    if secret.startswith("v1,whsec_"):
        secret = secret[len("v1,whsec_"):]

    try:
        secret_bytes = base64.b64decode(secret, validate=True)
    except Exception as exc:
        raise RuntimeError("Invalid SEND_SMS_HOOK_SECRET format") from exc

    webhook_id = headers.get("webhook-id", "")
    timestamp = headers.get("webhook-timestamp", "")
    signatures = headers.get("webhook-signature", "")

    if not webhook_id or not timestamp or not signatures:
        return False

    try:
        timestamp_int = int(timestamp)
    except ValueError:
        return False

    # Reject stale/replayed requests. Supabase's standard webhook signing
    # scheme uses a timestamp in seconds.
    if abs(int(time.time()) - timestamp_int) > 300:
        return False

    signed_content = f"{webhook_id}.{timestamp}.".encode("utf-8") + raw_body
    expected = base64.b64encode(
        hmac.new(secret_bytes, signed_content, hashlib.sha256).digest()
    ).decode("ascii")

    for signature in signatures.split(" "):
        if signature.startswith("v1,"):
            supplied = signature[3:]
            if hmac.compare_digest(supplied, expected):
                return True

    return False


class handler(BaseHTTPRequestHandler):
    def do_GET(self):
        json_response(self, {
            "ok": True,
            "service": "TemirDaftar Supabase Send SMS Hook",
        })

    def do_POST(self):
        try:
            content_length = int(self.headers.get("Content-Length", "0"))
            if content_length <= 0 or content_length > 64 * 1024:
                json_response(self, {"ok": False, "error": "Invalid request body"}, 400)
                return

            raw_body = self.rfile.read(content_length)

            if not verify_supabase_hook(raw_body, self.headers):
                json_response(self, {"ok": False, "error": "Unauthorized"}, 401)
                return

            event = json.loads(raw_body.decode("utf-8"))
            user = event.get("user") or {}
            sms = event.get("sms") or {}
            phone = user.get("phone")
            otp = sms.get("otp")

            if not phone or not otp:
                json_response(self, {"ok": False, "error": "Missing phone or OTP"}, 400)
                return

            status, provider_response = send_eskiz_sms(phone, otp)
            print(f"Supabase SMS hook: Eskiz accepted SMS, status={status}")

            # Supabase only needs a successful HTTP response from the hook.
            json_response(self, {"ok": True})

        except Exception as exc:
            print("Send SMS hook error:", exc)
            json_response(self, {
                "error": {
                    "http_code": 500,
                    "message": "SMS provider request failed",
                }
            }, 500)

    def do_OPTIONS(self):
        json_response(self, {"ok": True})
