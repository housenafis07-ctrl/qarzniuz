import json
import os
import random
import string
import urllib.parse
import urllib.request
from http.server import BaseHTTPRequestHandler

BOT_TOKEN = os.environ.get("BOT_TOKEN", "")
ADMIN_CHAT_ID = os.environ.get("ADMIN_CHAT_ID", "")
ADMIN_USER_ID = os.environ.get("ADMIN_USER_ID", "")
SUPABASE_URL = os.environ.get("SUPABASE_URL", "https://yzicsoyufdghwiezqjsa.supabase.co")
SUPABASE_SERVICE_KEY = os.environ.get("SUPABASE_SERVICE_KEY", "")
WEBHOOK_SECRET = os.environ.get("TELEGRAM_WEBHOOK_SECRET", "")
APP_URL = os.environ.get("APP_URL", "https://qarzniuz.vercel.app")
CARD_NUMBER = os.environ.get("CARD_NUMBER", "")


def send_json(handler, body, status=200):
    payload = json.dumps(body, ensure_ascii=False).encode("utf-8")
    handler.send_response(status)
    handler.send_header("Content-Type", "application/json; charset=utf-8")
    handler.send_header("Content-Length", str(len(payload)))
    handler.end_headers()
    handler.wfile.write(payload)


def tg(method, payload):
    url = f"https://api.telegram.org/bot{BOT_TOKEN}/{method}"
    data = urllib.parse.urlencode(payload).encode("utf-8")
    req = urllib.request.Request(url, data=data, method="POST")
    req.add_header("Content-Type", "application/x-www-form-urlencoded")
    with urllib.request.urlopen(req, timeout=20) as resp:
        return json.loads(resp.read().decode("utf-8"))


def supabase_insert_promo(code):
    url = SUPABASE_URL.rstrip("/") + "/rest/v1/promo_codes"
    payload = json.dumps({"code": code, "used": False}).encode("utf-8")
    req = urllib.request.Request(url, data=payload, method="POST")
    req.add_header("Content-Type", "application/json")
    req.add_header("apikey", SUPABASE_SERVICE_KEY)
    req.add_header("Authorization", f"Bearer {SUPABASE_SERVICE_KEY}")
    req.add_header("Prefer", "return=minimal")
    with urllib.request.urlopen(req, timeout=20) as resp:
        return resp.status in (200, 201, 204)


def generate_code():
    for _ in range(10):
        suffix = "".join(random.choices(string.digits, k=6))
        code = f"PRO-{suffix}"
        try:
            if supabase_insert_promo(code):
                return code
        except Exception:
            continue
    raise RuntimeError("Promo kod yaratib bo'lmadi")


def start_message(chat_id):
    card_line = f"\n\n💳 Karta: {CARD_NUMBER}" if CARD_NUMBER else ""
    text = (
        "👋 TemirDaftar Premium\n\n"
        "Premium ulash uchun 25 000 so'm to'lov qiling."
        f"{card_line}\n\n"
        f"So'ng to'lov chekini shu botga yuboring.\n"
        f"Ilova: {APP_URL}\n"
        "Chek va do'kon ma'lumotlari admin tomonidan tekshiriladi."
    )
    tg("sendMessage", {"chat_id": chat_id, "text": text})


def handle_photo(message):
    user = message.get("from", {})
    user_id = user.get("id")
    username = user.get("username", "")
    first_name = user.get("first_name", "")
    caption = message.get("caption", "")

    if not user_id:
        return

    admin_caption = "🧾 Yangi Premium to'lov cheki\n\n"
    admin_caption += f"👤 {first_name or '-'}"
    if username:
        admin_caption += f" (@{username})"
    admin_caption += f"\n🆔 User ID: {user_id}"
    if caption:
        admin_caption += f"\n📝 Izoh: {caption}"
    admin_caption += "\n\n⚠️ Kassani tekshirib keyin tasdiqlang!"

    keyboard = {
        "inline_keyboard": [[
            {"text": "✅ Tasdiqlash", "callback_data": f"approve_{user_id}"},
            {"text": "❌ Rad etish", "callback_data": f"reject_{user_id}"},
        ]]
    }

    tg("copyMessage", {
        "chat_id": ADMIN_CHAT_ID,
        "from_chat_id": message.get("chat", {}).get("id", user_id),
        "message_id": message.get("message_id"),
        "caption": admin_caption,
        "reply_markup": json.dumps(keyboard, ensure_ascii=False),
    })
    tg("sendMessage", {
        "chat_id": user_id,
        "text": "✅ Chekingiz qabul qilindi. Admin tekshirganidan so'ng Premium kodi yuboriladi.",
    })


def handle_callback(callback):
    callback_id = callback.get("id")
    data = callback.get("data", "")
    from_user = callback.get("from", {})
    callback_user_id = str(from_user.get("id", ""))
    message = callback.get("message") or {}
    admin_chat = str(message.get("chat", {}).get("id", ""))

    # Production xavfsizligi: tasdiqlash/rad etish faqat aniq admin Telegram user ID uchun.
    if not ADMIN_USER_ID or callback_user_id != ADMIN_USER_ID:
        tg("answerCallbackQuery", {
            "callback_query_id": callback_id,
            "text": "Ruxsat yo'q.",
            "show_alert": True,
        })
        return

    if not ADMIN_CHAT_ID or admin_chat != str(ADMIN_CHAT_ID):
        tg("answerCallbackQuery", {
            "callback_query_id": callback_id,
            "text": "Admin chat noto'g'ri.",
            "show_alert": True,
        })
        return

    if data.startswith("approve_"):
        target_user_id = data.split("_", 1)[1]
        try:
            code = generate_code()
        except Exception as exc:
            print("Supabase promo error:", exc)
            tg("answerCallbackQuery", {
                "callback_query_id": callback_id,
                "text": "Promo kod yaratishda xatolik.",
                "show_alert": True,
            })
            return

        tg("sendMessage", {
            "chat_id": target_user_id,
            "text": (
                "🎉 To'lovingiz tasdiqlandi!\n\n"
                f"🔑 30 kunlik Premium kodi: {code}\n\n"
                f"Ilovada Premium bo'limiga kirib kodni faollashtiring:\n{APP_URL}"
            ),
        })

        old_caption = message.get("caption", "🧾 Premium to'lov cheki")
        tg("editMessageCaption", {
            "chat_id": message.get("chat", {}).get("id"),
            "message_id": message.get("message_id"),
            "caption": old_caption + f"\n\n🟢 TASDIQLANDI — {code} yuborildi",
            "reply_markup": json.dumps({"inline_keyboard": []}),
        })
        tg("answerCallbackQuery", {
            "callback_query_id": callback_id,
            "text": f"Tasdiqlandi: {code}",
        })

    elif data.startswith("reject_"):
        target_user_id = data.split("_", 1)[1]
        tg("sendMessage", {
            "chat_id": target_user_id,
            "text": "❌ To'lov cheki tasdiqlanmadi. Iltimos, to'g'ri chekni qayta yuboring.",
        })

        old_caption = message.get("caption", "🧾 Premium to'lov cheki")
        tg("editMessageCaption", {
            "chat_id": message.get("chat", {}).get("id"),
            "message_id": message.get("message_id"),
            "caption": old_caption + "\n\n🔴 RAD ETILDI",
            "reply_markup": json.dumps({"inline_keyboard": []}),
        })
        tg("answerCallbackQuery", {
            "callback_query_id": callback_id,
            "text": "Rad etildi.",
        })


def process_update(update):
    if update.get("callback_query"):
        handle_callback(update["callback_query"])
        return

    message = update.get("message") or {}
    if message.get("photo"):
        handle_photo(message)
        return

    text = message.get("text", "")
    if text.startswith("/start") and message.get("chat"):
        start_message(message["chat"]["id"])


class handler(BaseHTTPRequestHandler):
    def _handle(self):
        if self.command == "GET":
            send_json(self, {"ok": True, "service": "TemirDaftar Telegram webhook"})
            return

        if self.command != "POST":
            send_json(self, {"ok": False, "error": "Method not allowed"}, 405)
            return

        if not BOT_TOKEN or not ADMIN_CHAT_ID or not SUPABASE_SERVICE_KEY or not ADMIN_USER_ID:
            print("Missing required environment variables")
            send_json(self, {"ok": False, "error": "Server configuration incomplete"}, 500)
            return

        if WEBHOOK_SECRET:
            received = self.headers.get("X-Telegram-Bot-Api-Secret-Token", "")
            if received != WEBHOOK_SECRET:
                send_json(self, {"ok": False, "error": "Unauthorized"}, 401)
                return

        try:
            content_length = int(self.headers.get("Content-Length", "0"))
            raw_body = self.rfile.read(content_length)
            update = json.loads(raw_body.decode("utf-8"))
            process_update(update)
            send_json(self, {"ok": True})
        except Exception as exc:
            print("Webhook error:", exc)
            send_json(self, {"ok": False, "error": "Webhook processing failed"}, 500)

    def do_GET(self):
        self._handle()

    def do_POST(self):
        self._handle()
