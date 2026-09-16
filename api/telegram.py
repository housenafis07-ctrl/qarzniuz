import json
import os
import random
import string
import urllib.parse
import urllib.request

BOT_TOKEN = os.environ.get("BOT_TOKEN", "")
ADMIN_CHAT_ID = os.environ.get("ADMIN_CHAT_ID", "")
ADMIN_USER_ID = os.environ.get("ADMIN_USER_ID", "")
SUPABASE_URL = os.environ.get("SUPABASE_URL", "https://yzicsoyufdghwiezqjsa.supabase.co")
SUPABASE_SERVICE_KEY = os.environ.get("SUPABASE_SERVICE_KEY", "")
WEBHOOK_SECRET = os.environ.get("TELEGRAM_WEBHOOK_SECRET", "")
APP_URL = os.environ.get("APP_URL", "https://qarzniuz.vercel.app")


def json_response(body, status=200):
    return {
        "statusCode": status,
        "headers": {"Content-Type": "application/json; charset=utf-8"},
        "body": json.dumps(body, ensure_ascii=False),
    }


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
    chars = string.ascii_uppercase + string.digits
    return "PRO-" + "".join(random.choices(chars, k=6))


def user_text(update):
    msg = update.get("message") or update.get("edited_message") or {}
    return msg.get("text", "")


def start_message(chat_id):
    card = os.environ.get("CARD_NUMBER", "")
    card_line = f"\n\n💳 Karta: {card}" if card else ""
    text = (
        "👋 TemirDaftar Premium\n\n"
        "Premium ulash uchun 25 000 so'm to'lov qiling."
        f"{card_line}\n\n"
        "So'ng to'lov chekini shu botga yuboring.\n"
        "Chek va do'kon ma'lumotlari admin tomonidan tekshiriladi."
    )
    tg("sendMessage", {"chat_id": chat_id, "text": text})


def handle_photo(message):
    user = message.get("from", {})
    user_id = user.get("id")
    username = user.get("username", "")
    first_name = user.get("first_name", "")
    caption = message.get("caption", "")

    admin_caption = (
        "🧾 Yangi Premium to'lov cheki\n\n"
        f"👤 {first_name or '-'}"
        f" (@{username})" if username else f"👤 {first_name or '-'}"
    )
    admin_caption += f"\n🆔 User ID: {user_id}"
    if caption:
        admin_caption += f"\n📝 Izoh: {caption}"

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
        "text": "✅ Chekingiz qabul qilindi. Admin tekshirganidan so'ng Premium kodi yuboriladi."
    })


def handle_callback(callback):
    callback_id = callback.get("id")
    data = callback.get("data", "")
    from_user = callback.get("from", {})
    callback_user_id = str(from_user.get("id", ""))
    message = callback.get("message") or {}
    admin_chat = str(message.get("chat", {}).get("id", ""))

    if ADMIN_USER_ID:
        authorized = callback_user_id == ADMIN_USER_ID
    else:
        authorized = bool(ADMIN_CHAT_ID) and admin_chat == str(ADMIN_CHAT_ID)

    if not authorized:
        tg("answerCallbackQuery", {
            "callback_query_id": callback_id,
            "text": "Ruxsat yo'q.",
            "show_alert": True,
        })
        return

    if data.startswith("approve_"):
        target_user_id = data.split("_", 1)[1]
        code = generate_code()
        try:
            supabase_insert_promo(code)
        except Exception as exc:
            print("Supabase insert error:", exc)
            tg("answerCallbackQuery", {
                "callback_query_id": callback_id,
                "text": "Supabase xatosi.",
                "show_alert": True,
            })
            return

        tg("sendMessage", {
            "chat_id": target_user_id,
            "text": (
                "🎉 To'lovingiz tasdiqlandi!\n\n"
                f"🔑 Premium kodi: {code}\n\n"
                "Ilovada Premium bo'limiga kirib ushbu kodni faollashtiring."
            ),
        })
        tg("editMessageReplyMarkup", {
            "chat_id": message.get("chat", {}).get("id"),
            "message_id": message.get("message_id"),
            "reply_markup": json.dumps({"inline_keyboard": []}),
        })
        tg("answerCallbackQuery", {"callback_query_id": callback_id, "text": f"Tasdiqlandi: {code}"})

    elif data.startswith("reject_"):
        target_user_id = data.split("_", 1)[1]
        tg("sendMessage", {
            "chat_id": target_user_id,
            "text": "❌ To'lov cheki tasdiqlanmadi. Iltimos, to'g'ri chekni qayta yuboring."
        })
        tg("editMessageReplyMarkup", {
            "chat_id": message.get("chat", {}).get("id"),
            "message_id": message.get("message_id"),
            "reply_markup": json.dumps({"inline_keyboard": []}),
        })
        tg("answerCallbackQuery", {"callback_query_id": callback_id, "text": "Rad etildi."})


def handler(request):
    # Vercel Python Functions pass a request object with get_json().
    if request.method == "GET":
        return json_response({"ok": True, "service": "TemirDaftar Telegram webhook"})

    if request.method != "POST":
        return json_response({"ok": False, "error": "Method not allowed"}, 405)

    if not BOT_TOKEN or not ADMIN_CHAT_ID or not SUPABASE_SERVICE_KEY:
        print("Missing required environment variables")
        return json_response({"ok": False, "error": "Server configuration incomplete"}, 500)

    if WEBHOOK_SECRET:
        received = request.headers.get("x-telegram-bot-api-secret-token", "")
        if received != WEBHOOK_SECRET:
            return json_response({"ok": False, "error": "Unauthorized"}, 401)

    try:
        update = request.get_json()
    except Exception:
        return json_response({"ok": False, "error": "Invalid JSON"}, 400)

    try:
        if update.get("callback_query"):
            handle_callback(update["callback_query"])
        elif update.get("message", {}).get("photo"):
            handle_photo(update["message"])
        elif user_text(update).startswith("/start"):
            start_message(update["message"]["chat"]["id"])
        return json_response({"ok": True})
    except Exception as exc:
        print("Webhook error:", exc)
        return json_response({"ok": True})
