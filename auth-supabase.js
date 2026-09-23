/* QarzniUz Supabase Phone OTP + 4-digit PIN auth bridge. */
(function () {
  'use strict';

  const SUPABASE_URL = 'https://yzicsoyufdghwiezqjsa.supabase.co';
  const SUPABASE_ANON_KEY = 'sb_publishable_nneWyKMepgYOVpn8fVXwMA_4m98kinM';
  const OTP_STATE_KEY = 'qarzniuz_pending_otp';
  const PIN_UNLOCK_KEY = 'qarzniuz_pin_unlocked';

  let client = null;
  let handled = false;

  function getClient() {
    if (client) return client;
    if (!window.supabase || typeof window.supabase.createClient !== 'function') throw new Error('Supabase JS yuklanmadi');
    client = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false } });
    return client;
  }
  function normalizePhone(raw) { const d = String(raw || '').replace(/\D/g, ''); if (d.startsWith('998')) return '+' + d; if (d.startsWith('8') && d.length === 9) return '+998' + d; if (d.length === 9) return '+998' + d; return '+' + d; }
  function storagePhone(phone) { return String(phone || '').replace(/\D/g, ''); }
  function ensureStatusElement() { let el = document.getElementById('qarzniuz-otp-status'); if (el) return el; const form = document.getElementById('auth-form'); if (!form) return null; el = document.createElement('div'); el.id = 'qarzniuz-otp-status'; el.style.cssText = 'margin-top:10px;padding:10px 12px;border-radius:8px;font-size:13px;min-height:18px;background:#fff7ed;'; form.after(el); return el; }
  function setStatus(text, ok) { const el = ensureStatusElement(); if (!el) return; el.textContent = text || ''; el.style.color = ok ? '#15803d' : '#b91c1c'; el.style.background = ok ? '#f0fdf4' : '#fef2f2'; }

  function ensureOtpPanel() {
    let panel = document.getElementById('qarzniuz-otp-panel'); if (panel) return panel;
    panel = document.createElement('div'); panel.id = 'qarzniuz-otp-panel'; panel.style.cssText = 'margin-top:14px;padding:16px;border:1px solid #bfdbfe;border-radius:10px;background:#eff6ff;';
    panel.innerHTML = `<div style="font-weight:700;margin-bottom:6px;">SMS orqali tasdiqlash</div><div id="qarzniuz-otp-hint" style="font-size:13px;color:#475569;margin-bottom:10px;"></div><input id="qarzniuz-otp-code" inputmode="numeric" autocomplete="one-time-code" maxlength="6" placeholder="6 xonali kod" style="margin-bottom:8px;"><button id="qarzniuz-otp-submit" type="button" class="btn">Kodni tasdiqlash</button><button id="qarzniuz-otp-resend" type="button" class="btn btn-secondary">Kodni qayta yuborish</button><div id="qarzniuz-otp-status" style="font-size:13px;margin-top:9px;min-height:18px;"></div>`;
    document.getElementById('auth-form').after(panel);
    document.getElementById('qarzniuz-otp-submit').addEventListener('click', verifyOtp); document.getElementById('qarzniuz-otp-resend').addEventListener('click', resendOtp); return panel;
  }
  function showOtp(phone) { const panel = ensureOtpPanel(); panel.style.display = 'block'; document.getElementById('qarzniuz-otp-hint').textContent = phone + ' raqamiga SMS kod yuborildi.'; document.getElementById('qarzniuz-otp-code').focus(); }
  function pendingState() { try { return JSON.parse(sessionStorage.getItem(OTP_STATE_KEY) || 'null'); } catch (_) { return null; } }

  async function sendOtp() {
    const phone = normalizePhone(document.getElementById('auth-phone').value); if (!/^\+998\d{9}$/.test(phone)) { alert('Iltimos, +998XXXXXXXXX formatida telefon raqamini kiriting.'); return; }
    const mode = (typeof authMode !== 'undefined') ? authMode : 'login'; const name = (document.getElementById('auth-name')?.value || '').trim(); const shop = (document.getElementById('auth-shop')?.value || '').trim();
    if (mode === 'register' && (!name || !shop)) { alert('Ism va do‘kon nomini kiriting.'); return; }
    const submit = document.getElementById('auth-submit-btn'); submit.disabled = true; submit.textContent = 'SMS yuborilmoqda...'; setStatus('SMS yuborish so‘rovi yuborilmoqda...', true);
    try { const { error } = await getClient().auth.signInWithOtp({ phone, options: { shouldCreateUser: true, data: { full_name: name || null, shop_name: shop || null, source: 'qarzniuz-web' } } }); if (error) throw error; sessionStorage.setItem(OTP_STATE_KEY, JSON.stringify({ phone, mode, name, shop, sentAt: Date.now() })); showOtp(phone); setStatus('SMS yuborildi. Kodni kiriting.', true); }
    catch (error) { console.error('QarzniUz OTP send error:', error); setStatus('SMS yuborilmadi: ' + (error?.message || 'noma’lum xatolik'), false); }
    finally { submit.disabled = false; submit.textContent = mode === 'register' ? 'Ro‘yxatdan o‘tish' : 'Kirish'; }
  }

  async function resendOtp() {
    const state = pendingState(); if (!state) return;
    try { const { error } = await getClient().auth.signInWithOtp({ phone: state.phone, options: { shouldCreateUser: true, data: { full_name: state.name || null, shop_name: state.shop || null, source: 'qarzniuz-web' } } }); if (error) throw error; state.sentAt = Date.now(); sessionStorage.setItem(OTP_STATE_KEY, JSON.stringify(state)); setStatus('Yangi SMS kod yuborildi.', true); }
    catch (error) { console.error('QarzniUz OTP resend error:', error); setStatus('Qayta yuborishda xatolik: ' + (error?.message || 'noma’lum xatolik'), false); }
  }

  async function ensureProfile(user, state) {
    const meta = user.user_metadata || {}; const name = state.name || meta.full_name || 'Foydalanuvchi';
    try { const { error } = await getClient().from('profiles').upsert({ id: user.id, full_name: name, phone: storagePhone(user.phone) }, { onConflict: 'id' }); if (error) console.warn('QarzniUz profile upsert:', error.message); }
    catch (error) { console.warn('QarzniUz profile sync skipped:', error); }
    return { name, shop: state.shop || meta.shop_name || "Mening Do'konim" };
  }

  async function hashPin(pin) { const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(pin)); return Array.from(new Uint8Array(digest)).map(b => b.toString(16).padStart(2, '0')).join(''); }

  function pinPanel() {
    let panel = document.getElementById('qarzniuz-pin-panel'); if (panel) return panel;
    panel = document.createElement('div'); panel.id = 'qarzniuz-pin-panel'; panel.style.cssText = 'position:fixed;inset:0;z-index:99999;background:#fff;display:flex;align-items:center;justify-content:center;padding:24px;';
    panel.innerHTML = `<div style="width:min(380px,100%);text-align:center;font-family:inherit;"><div style="font-size:24px;font-weight:800;margin-bottom:8px;">QarzniUz</div><div id="qarzniuz-pin-title" style="font-size:18px;font-weight:700;margin-bottom:8px;">PIN-kod yarating</div><div id="qarzniuz-pin-hint" style="font-size:13px;color:#64748b;margin-bottom:18px;">4 xonali PIN-kod kiriting</div><div id="qarzniuz-pin-dots" style="font-size:28px;letter-spacing:10px;min-height:42px;margin-bottom:16px;">○ ○ ○ ○</div><input id="qarzniuz-pin-input" inputmode="numeric" autocomplete="off" maxlength="4" type="password" style="width:100%;box-sizing:border-box;text-align:center;font-size:26px;letter-spacing:14px;padding:12px;border:1px solid #cbd5e1;border-radius:12px;"><button id="qarzniuz-pin-btn" type="button" class="btn" style="width:100%;margin-top:12px;">Davom etish</button><div id="qarzniuz-pin-error" style="min-height:20px;margin-top:10px;color:#b91c1c;font-size:13px;"></div></div>`;
    document.body.appendChild(panel); return panel;
  }

  async function setupOrVerifyPin(user) {
    const panel = pinPanel(), input = panel.querySelector('#qarzniuz-pin-input'), btn = panel.querySelector('#qarzniuz-pin-btn'), title = panel.querySelector('#qarzniuz-pin-title'), hint = panel.querySelector('#qarzniuz-pin-hint'), errorEl = panel.querySelector('#qarzniuz-pin-error');
    let storedHash = user.user_metadata?.qarzniuz_pin_hash || null; let confirming = false; let firstPin = null;
    function resetInput() { input.value = ''; input.focus(); }
    function render() { title.textContent = storedHash ? 'PIN-kodni kiriting' : (confirming ? 'PIN-kodni tasdiqlang' : 'PIN-kod yarating'); hint.textContent = storedHash ? 'QarzniUz hisobingizni ochish uchun 4 xonali PIN-kodni kiriting.' : (confirming ? 'Xuddi shu 4 xonali PIN-kodni yana kiriting.' : 'Keyingi kirishlarda SMS tasdiqlashdan so‘ng foydalaniladigan 4 xonali PIN yarating.'); btn.textContent = storedHash ? 'Kirish' : (confirming ? 'PIN-kodni saqlash' : 'Davom etish'); }
    render(); resetInput();
    return new Promise(resolve => {
      btn.onclick = async () => {
        const pin = String(input.value || '').replace(/\D/g, ''); errorEl.textContent = '';
        if (!/^\d{4}$/.test(pin)) { errorEl.textContent = 'PIN-kod aynan 4 ta raqamdan iborat bo‘lishi kerak.'; return; }
        btn.disabled = true;
        try {
          if (!storedHash) {
            if (!confirming) { firstPin = pin; confirming = true; resetInput(); render(); return; }
            if (pin !== firstPin) { errorEl.textContent = 'PIN-kodlar mos kelmadi. Qaytadan kiriting.'; firstPin = null; confirming = false; resetInput(); render(); return; }
            const hash = await hashPin(pin); const { data, error } = await getClient().auth.updateUser({ data: { qarzniuz_pin_hash: hash } }); if (error) throw error;
            storedHash = data.user?.user_metadata?.qarzniuz_pin_hash || hash; finish();
          } else {
            const hash = await hashPin(pin); if (hash !== storedHash) { errorEl.textContent = 'PIN-kod noto‘g‘ri.'; resetInput(); return; } finish();
          }
        } catch (e) { console.error('QarzniUz PIN error:', e); errorEl.textContent = 'PIN-kodni saqlash/tekshirishda xatolik. Qayta urinib ko‘ring.'; }
        finally { btn.disabled = false; }
      };
      function finish() { panel.remove(); sessionStorage.setItem(PIN_UNLOCK_KEY, '1'); resolve(); }
      input.addEventListener('input', () => { input.value = input.value.replace(/\D/g, '').slice(0, 4); });
      input.addEventListener('keydown', e => { if (e.key === 'Enter') btn.click(); });
    });
  }

  async function verifyOtp() {
    if (handled) return; const state = pendingState(); const code = (document.getElementById('qarzniuz-otp-code')?.value || '').replace(/\D/g, '');
    if (!state || !/^\d{6}$/.test(code)) { setStatus('6 xonali SMS kodini kiriting.', false); return; }
    const btn = document.getElementById('qarzniuz-otp-submit'); btn.disabled = true; setStatus('Tekshirilmoqda...', true);
    try {
      const { data, error } = await getClient().auth.verifyOtp({ phone: state.phone, token: code, type: 'sms' }); if (error) throw error; if (!data.user) throw new Error('Foydalanuvchi sessiyasi yaratilmadi');
      handled = true; const legacy = JSON.parse(localStorage.getItem('registered_users_base') || '{}'); const old = legacy[storagePhone(state.phone)] || legacy[state.phone] || null; const profile = await ensureProfile(data.user, state);
      const current = { phone: storagePhone(state.phone), name: old?.name || profile.name, shopName: old?.shopName || profile.shop }; legacy[current.phone] = current; localStorage.setItem('registered_users_base', JSON.stringify(legacy)); localStorage.setItem('shop_user', JSON.stringify(current)); sessionStorage.removeItem(OTP_STATE_KEY);
      setStatus('Tasdiqlandi. PIN-kod tekshirilmoqda...', true); await setupOrVerifyPin(data.user); setStatus('Tasdiqlandi. Tizim ochilmoqda...', true); currentUser = current; initApp();
    } catch (error) { console.error('QarzniUz OTP verify error:', error); setStatus('Kod noto‘g‘ri yoki muddati tugagan: ' + (error?.message || ''), false); }
    finally { btn.disabled = false; }
  }

  function installAuthHandler() {
    const form = document.getElementById('auth-form'); if (!form) return;
    form.addEventListener('submit', function (event) { event.preventDefault(); event.stopImmediatePropagation(); sendOtp(); }, true);
    window.logoutApp = async function () { try { await getClient().auth.signOut(); } catch (_) {} localStorage.removeItem('shop_user'); sessionStorage.removeItem(PIN_UNLOCK_KEY); currentUser = null; window.location.reload(); };
  }
  function boot() { try { getClient(); installAuthHandler(); } catch (error) { console.error('QarzniUz Auth boot failed:', error); setStatus('Autentifikatsiya ishga tushmadi: ' + (error?.message || 'noma’lum xatolik'), false); } }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot, { once: true }); else boot();
})();
