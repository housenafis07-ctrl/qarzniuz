import json
import os
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from http.server import BaseHTTPRequestHandler

SUPABASE_URL = os.environ.get("SUPABASE_URL", "https://yzicsoyufdghwiezqjsa.supabase.co").rstrip("/")
SUPABASE_SERVICE_KEY = os.environ.get("SUPABASE_SERVICE_KEY", "")
SUPABASE_ANON_KEY = os.environ.get("SUPABASE_ANON_KEY", "")


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
    return json.loads((h.rfile.read(n) if n else b"{}").decode("utf-8"))


def auth_user(h):
    token = h.headers.get("Authorization", "")
    if not token.lower().startswith("bearer "):
        raise PermissionError("Sessiya topilmadi")
    access = token.split(" ", 1)[1].strip()
    key = SUPABASE_ANON_KEY or SUPABASE_SERVICE_KEY
    if not access or not key:
        raise PermissionError("Auth server sozlanmagan")
    req = urllib.request.Request(SUPABASE_URL + "/auth/v1/user", method="GET")
    req.add_header("apikey", key)
    req.add_header("Authorization", "Bearer " + access)
    try:
        with urllib.request.urlopen(req, timeout=15) as r:
            user = json.loads(r.read().decode("utf-8"))
    except Exception:
        raise PermissionError("Sessiya yaroqsiz yoki muddati tugagan")
    if not user.get("id"):
        raise PermissionError("Foydalanuvchi aniqlanmadi")
    return user


def rest(method, table, query=None, body=None, prefer=None):
    if not SUPABASE_SERVICE_KEY:
        raise RuntimeError("SUPABASE_SERVICE_KEY sozlanmagan")
    url = SUPABASE_URL + "/rest/v1/" + table
    if query:
        url += "?" + urllib.parse.urlencode(query, doseq=True)
    raw = json.dumps(body, ensure_ascii=False).encode("utf-8") if body is not None else None
    req = urllib.request.Request(url, data=raw, method=method)
    req.add_header("apikey", SUPABASE_SERVICE_KEY)
    req.add_header("Authorization", "Bearer " + SUPABASE_SERVICE_KEY)
    req.add_header("Content-Type", "application/json")
    req.add_header("Accept", "application/json")
    req.add_header("Prefer", prefer or ("return=representation" if method in ("POST", "PATCH") else "return=minimal"))
    try:
        with urllib.request.urlopen(req, timeout=20) as r:
            text = r.read().decode("utf-8")
            return json.loads(text) if text else []
    except urllib.error.HTTPError as e:
        detail = e.read().decode("utf-8", errors="replace")
        raise RuntimeError(detail[:1000])


def one(table, query):
    rows = rest("GET", table, query)
    return rows[0] if rows else None


def normalize_phone(v):
    d = "".join(c for c in str(v or "") if c.isdigit())
    if d.startswith("998") and len(d) == 12:
        return "+" + d
    if d.startswith("8") and len(d) == 9:
        return "+998" + d
    if len(d) == 9:
        return "+998" + d
    return ("+" + d) if d else ""


def member_for(user):
    uid = user["id"]
    rows = rest("GET", "shop_members", {
        "user_id": "eq." + uid,
        "select": "*",
        "order": "created_at.desc",
        "limit": "1"
    })
    if rows:
        if rows[0].get("status") in ("active", "disabled"):
            return rows[0]
    phone = normalize_phone(user.get("phone", ""))
    if phone:
        pending = one("shop_members", {
            "phone": "eq." + phone,
            "status": "eq.pending",
            "select": "*",
            "limit": "1"
        })
        if pending:
            updated = rest("PATCH", "shop_members", {"id": "eq." + pending["id"]}, {
                "user_id": uid, "status": "active"
            })
            return updated[0] if updated else pending
    return None


def bootstrap(user):
    existing = member_for(user)
    if existing:
        shop = one("shops", {"id": "eq." + existing["shop_id"], "select": "*", "limit": "1"})
        return existing, shop
    meta = user.get("user_metadata") or {}
    name = str(meta.get("full_name") or "Do'kon egasi").strip()[:120]
    shop_name = str(meta.get("shop_name") or "Mening Do'konim").strip()[:160]
    phone = normalize_phone(user.get("phone", ""))
    shop = rest("POST", "shops", {"name": shop_name, "owner_user_id": user["id"], "status": "active"})[0]
    member = rest("POST", "shop_members", {"shop_id": shop["id"], "user_id": user["id"], "phone": phone or user["id"], "full_name": name, "role": "OWNER", "status": "active"})[0]
    return member, shop


def require_context(h):
    user = auth_user(h)
    member, shop = bootstrap(user)
    if not member or not shop or member.get("status") != "active":
        raise PermissionError("Do'kon a'zoligi topilmadi")
    return user, member, shop


def actor_map(members):
    return {m.get("user_id"): m.get("full_name") or "Foydalanuvchi" for m in members if m.get("user_id")}


def audit(shop_id, user_id, actor_name, action, entity_type, entity_id=None, old=None, new=None):
    rest("POST", "shop_audit_logs", {"shop_id": shop_id, "actor_user_id": user_id, "actor_name": actor_name, "action": action, "entity_type": entity_type, "entity_id": entity_id, "old_data": old, "new_data": new})


def shop_rows(table, shop_id, order=None):
    q = {"shop_id": "eq." + shop_id, "select": "*"}
    if order:
        q["order"] = order
    return rest("GET", table, q)


def dashboard(shop_id, members):
    customers = shop_rows("shop_customers", shop_id)
    debts = shop_rows("shop_debts", shop_id, "created_at.desc")
    payments = shop_rows("shop_payments", shop_id, "created_at.desc")
    active_debts = [d for d in debts if d.get("status") == "active"]
    recorded_payments = [p for p in payments if p.get("status") == "recorded"]
    total_debt = sum(float(d.get("amount") or 0) for d in active_debts)
    total_paid = sum(float(p.get("amount") or 0) for p in recorded_payments)
    today = datetime.now(timezone.utc).date().isoformat()
    today_paid = sum(float(p.get("amount") or 0) for p in recorded_payments if str(p.get("created_at", ""))[:10] == today)
    balances = {}
    for c in customers:
        cid = c["id"]
        balances[cid] = sum(float(d.get("amount") or 0) for d in active_debts if d.get("customer_id") == cid) - sum(float(p.get("amount") or 0) for p in recorded_payments if p.get("customer_id") == cid)
    return {"customers": len(customers), "active_debtors": sum(1 for v in balances.values() if v > 0.009), "total_debt": round(total_debt, 2), "total_paid": round(total_paid, 2), "balance": round(total_debt - total_paid, 2), "today_paid": round(today_paid, 2), "members": len([m for m in members if m.get("role") == "SELLER" and m.get("status") == "active"])}


def payload(shop_id, members):
    customers = shop_rows("shop_customers", shop_id, "created_at.desc")
    debts = shop_rows("shop_debts", shop_id, "created_at.desc")
    payments = shop_rows("shop_payments", shop_id, "created_at.desc")
    names = actor_map(members)
    paid_by_customer, debt_by_customer = {}, {}
    for d in debts:
        if d.get("status") == "active":
            debt_by_customer[d["customer_id"]] = debt_by_customer.get(d["customer_id"], 0) + float(d.get("amount") or 0)
    for p in payments:
        if p.get("status") == "recorded":
            paid_by_customer[p["customer_id"]] = paid_by_customer.get(p["customer_id"], 0) + float(p.get("amount") or 0)
    for c in customers:
        c["total_debt"] = round(debt_by_customer.get(c["id"], 0), 2)
        c["total_paid"] = round(paid_by_customer.get(c["id"], 0), 2)
        c["balance"] = round(c["total_debt"] - c["total_paid"], 2)
        c["created_by_name"] = names.get(c.get("created_by"), "Foydalanuvchi")
    for d in debts:
        d["created_by_name"] = names.get(d.get("created_by"), "Foydalanuvchi")
    for p in payments:
        p["created_by_name"] = names.get(p.get("created_by"), "Foydalanuvchi")
    return customers, debts, payments


class handler(BaseHTTPRequestHandler):
    def do_GET(self):
        try:
            user, member, shop = require_context(self)
            params = urllib.parse.parse_qs(urllib.parse.urlparse(self.path).query)
            action = (params.get("action", ["bootstrap"])[0] or "bootstrap").lower()
            members = shop_rows("shop_members", shop["id"], "created_at.asc")
            if action == "bootstrap":
                send_json(self, {"ok": True, "data": {"user": {"id": user["id"], "phone": user.get("phone"), "name": member.get("full_name")}, "shop": shop, "member": member, "dashboard": dashboard(shop["id"], members)}}); return
            if action == "data":
                customers, debts, payments = payload(shop["id"], members)
                send_json(self, {"ok": True, "data": {"customers": customers, "debts": debts, "payments": payments, "members": members}}); return
            if action == "audit":
                if member["role"] != "OWNER": raise PermissionError("Audit faqat egaga ochiq")
                send_json(self, {"ok": True, "data": shop_rows("shop_audit_logs", shop["id"], "created_at.desc")[:500]}); return
            raise RuntimeError("Noma'lum action")
        except PermissionError as e:
            send_json(self, {"ok": False, "error": str(e)}, 401)
        except Exception as e:
            send_json(self, {"ok": False, "error": str(e)}, 500)

    def do_POST(self):
        try:
            user, member, shop = require_context(self)
            body = read_json(self)
            action = str(body.get("action", "")).lower()
            if action == "customer_create":
                name = str(body.get("full_name", "")).strip()[:160]
                if not name: raise RuntimeError("Mijoz ismi kerak")
                row = rest("POST", "shop_customers", {"shop_id": shop["id"], "full_name": name, "phone": normalize_phone(body.get("phone", "")) or None, "note": str(body.get("note", "")).strip()[:500] or None, "created_by": user["id"]})[0]
                audit(shop["id"], user["id"], member["full_name"], "CREATE", "CUSTOMER", row["id"], None, row)
                send_json(self, {"ok": True, "data": row}); return
            if action == "debt_create":
                cid, amount = str(body.get("customer_id", "")), float(body.get("amount") or 0)
                if amount <= 0: raise RuntimeError("Qarz summasi 0 dan katta bo'lishi kerak")
                if not one("shop_customers", {"id": "eq." + cid, "shop_id": "eq." + shop["id"], "select": "*", "limit": "1"}): raise RuntimeError("Mijoz topilmadi")
                row = rest("POST", "shop_debts", {"shop_id": shop["id"], "customer_id": cid, "amount": amount, "note": str(body.get("note", "")).strip()[:500] or None, "due_date": body.get("due_date") or None, "created_by": user["id"]})[0]
                audit(shop["id"], user["id"], member["full_name"], "CREATE", "DEBT", row["id"], None, row)
                send_json(self, {"ok": True, "data": row}); return
            if action == "payment_create":
                cid, amount = str(body.get("customer_id", "")), float(body.get("amount") or 0)
                if amount <= 0: raise RuntimeError("To'lov summasi 0 dan katta bo'lishi kerak")
                if not one("shop_customers", {"id": "eq." + cid, "shop_id": "eq." + shop["id"], "select": "*", "limit": "1"}): raise RuntimeError("Mijoz topilmadi")
                row = rest("POST", "shop_payments", {"shop_id": shop["id"], "customer_id": cid, "debt_id": body.get("debt_id") or None, "amount": amount, "note": str(body.get("note", "")).strip()[:500] or None, "created_by": user["id"]})[0]
                audit(shop["id"], user["id"], member["full_name"], "CREATE", "PAYMENT", row["id"], None, row)
                send_json(self, {"ok": True, "data": row}); return
            if action == "seller_invite":
                if member["role"] != "OWNER": raise PermissionError("Faqat OWNER")
                name, phone = str(body.get("full_name", "")).strip()[:120], normalize_phone(body.get("phone", ""))
                if not name or not phone: raise RuntimeError("Sotuvchi ismi va telefoni kerak")
                exists = one("shop_members", {"shop_id": "eq." + shop["id"], "phone": "eq." + phone, "select": "*", "limit": "1"})
                if exists and exists.get("status") != "disabled": raise RuntimeError("Bu telefon allaqachon do'konga ulangan yoki taklif qilingan")
                if exists:
                    row = rest("PATCH", "shop_members", {"id": "eq." + exists["id"]}, {"full_name": name, "status": "pending", "role": "SELLER", "user_id": None})[0]
                else:
                    row = rest("POST", "shop_members", {"shop_id": shop["id"], "phone": phone, "full_name": name, "role": "SELLER", "status": "pending", "invited_by": user["id"]})[0]
                audit(shop["id"], user["id"], member["full_name"], "INVITE", "SELLER", row["id"], None, row)
                send_json(self, {"ok": True, "data": row}); return
            if action == "seller_status":
                if member["role"] != "OWNER": raise PermissionError("Faqat OWNER")
                mid, status = str(body.get("member_id", "")), str(body.get("status", ""))
                if status not in ("active", "disabled", "pending"): raise RuntimeError("Status noto'g'ri")
                target = one("shop_members", {"id": "eq." + mid, "shop_id": "eq." + shop["id"], "select": "*", "limit": "1"})
                if not target or target.get("role") != "SELLER": raise RuntimeError("Sotuvchi topilmadi")
                updated = rest("PATCH", "shop_members", {"id": "eq." + mid}, {"status": status})[0]
                audit(shop["id"], user["id"], member["full_name"], "STATUS", "SELLER", mid, target, updated)
                send_json(self, {"ok": True, "data": updated}); return
            if action == "customer_archive":
                if member["role"] != "OWNER": raise PermissionError("Faqat OWNER")
                cid = str(body.get("customer_id", ""))
                target = one("shop_customers", {"id": "eq." + cid, "shop_id": "eq." + shop["id"], "select": "*", "limit": "1"})
                if not target: raise RuntimeError("Mijoz topilmadi")
                updated = rest("PATCH", "shop_customers", {"id": "eq." + cid}, {"status": "archived"})[0]
                audit(shop["id"], user["id"], member["full_name"], "ARCHIVE", "CUSTOMER", cid, target, updated)
                send_json(self, {"ok": True, "data": updated}); return
            if action == "payment_cancel":
                if member["role"] != "OWNER": raise PermissionError("Faqat OWNER")
                pid = str(body.get("payment_id", ""))
                target = one("shop_payments", {"id": "eq." + pid, "shop_id": "eq." + shop["id"], "select": "*", "limit": "1"})
                if not target: raise RuntimeError("To'lov topilmadi")
                reason = str(body.get("reason", "")).strip()[:250]
                updated = rest("PATCH", "shop_payments", {"id": "eq." + pid}, {"status": "cancelled", "note": (target.get("note") or "") + (" | Bekor qilindi: " + reason if reason else " | Bekor qilindi")})[0]
                audit(shop["id"], user["id"], member["full_name"], "CANCEL", "PAYMENT", pid, target, updated)
                send_json(self, {"ok": True, "data": updated}); return
            raise RuntimeError("Noma'lum amal")
        except PermissionError as e:
            send_json(self, {"ok": False, "error": str(e)}, 403)
        except Exception as e:
            send_json(self, {"ok": False, "error": str(e)}, 400)

    def do_HEAD(self):
        self.send_response(200)
        self.end_headers()
