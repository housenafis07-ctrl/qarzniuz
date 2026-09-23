/* QarzniUz Supabase auth: phone + 4-digit PIN, SMS only for registration/recovery. */
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
    client = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false }
    });
    return client;
  }

  function normalizePhone(raw) {
    const d = String(raw || '').replace(/\D/g, '');
    if (d.startsWith('998')) return '+' + d;
    if (d.startsWith('8') && d.length === 9) return '+998' + d;
    if (d.length === 9) return '+998' + d;
    return '+' + d;
  }
  function storagePhone(phone) { return String(phone || '').replace(/\D/g, ''); }
  function pendingState() { try { return JSON.parse(sessionStorage.getItem(OTP_STATE_KEY) || 'null'); } catch (_) { return null; } }

  function ensureStatusElement() {
    let el = document.getElementById('qarzniuz-otp-status');
    if (el) return el;
    const form = document.getElementById('auth-form');
    if (!form) return null;
    el = document.createElement('div');
    el.id = 'qarzniuz-otp-status';
    el.style.cssText = 'margin-top:10px;padding:10px 12px;border-radius:8px;font-size:13px;min-height:18px;background:#fff7ed;';
    form.after(el);
    return el;
  }
  function setStatus(text, ok) {
    const el = ensureStatusElement();
    if (!el) return;
    el.textContent = text || '';
    el.style.color = ok ? '#15803d' : '#b91c1c';
    el.style.background = ok ? '#f0fdf4' : '#fef2f2';
  }

  function addPinLoginUI() {
    const form = document.getElementById('auth-form');
    const phone = document.getElementById('auth-phone');
    const regFields = document.getElementById('reg-fields');
    if (!form || !phone || document.getElementById('qarzniuz-pin-login-wrap')) return;

    const wrap = document.createElement('div');
    wrap.id = 'qarzniuz-pin-login-wrap';
    wrap.className = 'form-group';
    wrap.innerHTML = '<label for="qarzniuz-login-pin">4 xonali PIN-kod</label>' +
      '<input type="password" id="qarzniuz-login-pin" inputmode="numeric" autocomplete="current-password" maxlength="4" pattern="[0-9]{4}" placeholder="••••">' +
      '<button type="button" id="qarzniuz-forgot-pin" style="display:block;margin:9px 0 0 auto;background:none;border:0;color:#2563eb;font-size:13px;font-weight:600;cursor:pointer;">PIN-kodni unutdim</button>';
    (regFields || form).before(wrap);

    const pin = document.getElementById('qarzniuz-login-pin');
    pin.addEventListener('input', () => { pin.value = pin.value.replace(/\D/g, '').slice(0, 4); });
    document.getElementById('qarzniuz-forgot-pin').addEventListener('click', startPinRecovery);
  }

  function updateLoginUI() {
    addPinLoginUI();
    const mode = (typeof authMode !== 'undefined') ? authMode : 'login';
    const wrap = document.getElementById('qarzniuz-pin-login-wrap');
    const pin = document.getElementById('qarzniuz-login-pin');
    const forgot = document.getElementById('qarzniuz-forgot-pin');
    const submit = document.getElementById('auth-submit-btn');
    if (!wrap) return;
    const login = mode === 'login';
    wrap.style.display = login ? 'block' : 'none';
    if (forgot) forgot.style.display = login ? 'block' : 'none';
    if (pin) pin.required = login;
    if (submit) submit.textContent = login ? 'Kirish' : 'Ro‘yxatdan o‘tish';
  }

  function ensureOtpPanel() {
    let panel = document.getElementById('qarzniuz-otp-panel');
    if (panel) return panel;
    panel = document.createElement('div');
    panel.id = 'qarzniuz-otp-panel';
    panel.style.cssText = 'margin-top:14px;padding:16px;border:1px solid #bfdbfe;border-radius:10px;background:#eff6ff;display:none;';
    panel.innerHTML = '<div style="font-weight:700;margin-bottom:6px;">SMS orqali tasdiqlash</div><div id="qarzniuz-otp-hint" style="font-size:13px;color:#475569;margin-bottom:10px;"></div><input id="qarzniuz-otp-code" inputmode="numeric" autocomplete="one-time-code" maxlength="6" placeholder="6 xonali kod" style="margin-bottom:8px;"><button id="qarzniuz-otp-submit" type="button" class="btn">Kodni tasdiqlash</button><button id="qarzniuz-otp-resend" type="button" class="btn btn-secondary">Kodni qayta yuborish</button><div id="qarzniuz-otp-status" style="font-size:13px;margin-top:9px;min-height:18px;"></div>';
    document.getElementById('auth-form').after(panel);
    document.getElementById('qarzniuz-otp-submit').addEventListener('click', verifyOtp);
    document.getElementById('qarzniuz-otp-resend').addEventListener('click', resendOtp);
    return panel;
  }

  function showOtp(phone, recovery) {
    const panel = ensureOtpPanel();
    panel.style.display = 'block';
    document.getElementById('qarzniuz-otp-hint').textContent = recovery ? phone + ' raqamiga PIN tiklash uchun SMS kod yuborildi.' : phone + ' raqamiga SMS kod yuborildi.';
    document.getElementById('qarzniuz-otp-code').focus();
  }

  async function hashPin(pin) {
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(pin));
    return Array.from(new Uint8Array(digest)).map(b => b.toString(16).padStart(2, '0')).join('');
  }

  async function sendOtp() {
    const phone = normalizePhone(document.getElementById('auth-phone').value);
    const mode = (typeof authMode !== 'undefined') ? authMode : 'login';
    const name = (document.getElementById('auth-name')?.value || '').trim();
    const shop = (document.getElementById('auth-shop')?.value || '').trim();
    if (!/^\+998\d{9}$/.test(phone)) { alert('Iltimos, +998XXXXXXXXX formatida telefon raqamini kiriting.'); return; }
    if (mode === 'register' && (!name || !shop)) { alert('Ism va do‘kon nomini kiriting.'); return; }

    const submit = document.getElementById('auth-submit-btn');
    submit.disabled = true; submit.textContent = 'SMS yuborilmoqda...';
    try {
      const { error } = await getClient().auth.signInWithOtp({
        phone,
        options: { shouldCreateUser: true, data: { full_name: name || null, shop_name: shop || null, source: 'qarzniuz-web' } }
      });
      if (error) throw error;
      sessionStorage.setItem(OTP_STATE_KEY, JSON.stringify({ phone, mode, name, shop, sentAt: Date.now() }));
      showOtp(phone, false);
      setStatus('SMS yuborildi. Kodni kiriting.', true);
    } catch (error) {
      console.error('QarzniUz OTP send error:', error);
      setStatus('SMS yuborilmadi: ' + (error?.message || 'noma’lum xatolik'), false);
    } finally {
      submit.disabled = false;
      updateLoginUI();
    }
  }

  async function startPinRecovery() {
    const phone = normalizePhone(document.getElementById('auth-phone').value);
    if (!/^\+998\d{9}$/.test(phone)) { alert('Avval telefon raqamingizni kiriting.'); return; }
    try {
      setStatus('PIN tiklash uchun SMS yuborilmoqda...', true);
      const { error } = await getClient().auth.signInWithOtp({ phone, options: { shouldCreateUser: false } });
      if (error) throw error;
      sessionStorage.setItem(OTP_STATE_KEY, JSON.stringify({ phone, mode: 'recovery', name: '', shop: '', sentAt: Date.now() }));
      showOtp(phone, true);
      setStatus('SMS yuborildi. Kodni kiriting.', true);
    } catch (error) {
      console.error('QarzniUz PIN recovery error:', error);
      setStatus('PIN tiklash SMS yuborilmadi: ' + (error?.message || 'raqam ro‘yxatdan o‘tmagan'), false);
    }
  }

  async function resendOtp() {
    const state = pendingState();
    if (!state) return;
    try {
      const { error } = await getClient().auth.signInWithOtp({
        phone: state.phone,
        options: { shouldCreateUser: state.mode !== 'recovery', data: { full_name: state.name || null, shop_name: state.shop || null, source: 'qarzniuz-web' } }
      });
      if (error) throw error;
      state.sentAt = Date.now();
      sessionStorage.setItem(OTP_STATE_KEY, JSON.stringify(state));
      setStatus('Yangi SMS kod yuborildi.', true);
    } catch (error) {
      console.error('QarzniUz OTP resend error:', error);
      setStatus('Qayta yuborishda xatolik: ' + (error?.message || 'noma’lum xatolik'), false);
    }
  }

  async function ensureProfile(user, state) {
    const meta = user.user_metadata || {};
    const name = state.name || meta.full_name || 'Foydalanuvchi';
    try {
      const { error } = await getClient().from('profiles').upsert({ id: user.id, full_name: name, phone: storagePhone(user.phone) }, { onConflict: 'id' });
      if (error) console.warn('QarzniUz profile upsert:', error.message);
    } catch (error) { console.warn('QarzniUz profile sync skipped:', error); }
    return { name, shop: state.shop || meta.shop_name || "Mening Do'konim" };
  }

  function pinPanel(titleText) {
    let panel = document.getElementById('qarzniuz-pin-panel');
    if (panel) panel.remove();
    panel = document.createElement('div');
    panel.id = 'qarzniuz-pin-panel';
    panel.style.cssText = 'position:fixed;inset:0;z-index:99999;background:#fff;display:flex;align-items:center;justify-content:center;padding:24px;';
    panel.innerHTML = '<div style="width:min(380px,100%);text-align:center;font-family:inherit;"><div style="font-size:24px;font-weight:800;margin-bottom:8px;">QarzniUz</div><div id="qarzniuz-pin-title" style="font-size:18px;font-weight:700;margin-bottom:8px;">' + (titleText || 'PIN-kod yarating') + '</div><div id="qarzniuz-pin-hint" style="font-size:13px;color:#64748b;margin-bottom:18px;">4 xonali PIN-kod kiriting</div><div id="qarzniuz-pin-dots" style="font-size:28px;letter-spacing:10px;min-height:42px;margin-bottom:16px;">○ ○ ○ ○</div><input id="qarzniuz-pin-input" inputmode="numeric" autocomplete="new-password" maxlength="4" type="password" style="width:100%;box-sizing:border-box;text-align:center;font-size:26px;letter-spacing:14px;padding:12px;border:1px solid #cbd5e1;border-radius:12px;"><button id="qarzniuz-pin-btn" type="button" class="btn" style="width:100%;margin-top:12px;">Davom etish</button><div id="qarzniuz-pin-error" style="min-height:20px;margin-top:10px;color:#b91c1c;font-size:13px;"></div></div>';
    document.body.appendChild(panel);
    return panel;
  }

  async function createOrResetPin() {
    const panel = pinPanel('Yangi PIN-kod yarating');
    const input = panel.querySelector('#qarzniuz-pin-input');
    const btn = panel.querySelector('#qarzniuz-pin-btn');
    const hint = panel.querySelector('#qarzniuz-pin-hint');
    const title = panel.querySelector('#qarzniuz-pin-title');
    const errorEl = panel.querySelector('#qarzniuz-pin-error');
    let firstPin = null;
    let confirming = false;
    function render() {
      title.textContent = confirming ? 'PIN-kodni tasdiqlang' : 'Yangi PIN-kod yarating';
      hint.textContent = confirming ? 'Xuddi shu 4 xonali PIN-kodni yana kiriting.' : 'Keyingi kirishlarda telefon raqami bilan birga shu PIN-kod ishlatiladi.';
      btn.textContent = confirming ? 'PIN-kodni saqlash' : 'Davom etish';
    }
    function reset() { input.value = ''; input.focus(); }
    render(); reset();
    return new Promise(resolve => {
      btn.onclick = async () => {
        const pin = String(input.value || '').replace(/\D/g, '');
        errorEl.textContent = '';
        if (!/^\d{4}$/.test(pin)) { errorEl.textContent = 'PIN-kod aynan 4 ta raqamdan iborat bo‘lishi kerak.'; return; }
        btn.disabled = true;
        try {
          if (!confirming) { firstPin = pin; confirming = true; reset(); render(); btn.disabled = false; return; }
          if (pin !== firstPin) { errorEl.textContent = 'PIN-kodlar mos kelmadi. Qaytadan kiriting.'; firstPin = null; confirming = false; reset(); render(); btn.disabled = false; return; }
          const hash = await hashPin(pin);
          const { data, error } = await getClient().auth.updateUser({ password: hash, data: { qarzniuz_pin_hash: hash } });
          if (error) throw error;
          finish(data.user || null);
        } catch (e) {
          console.error('QarzniUz PIN save error:', e);
          errorEl.textContent = 'PIN-kodni saqlashda xatolik. Qayta urinib ko‘ring.';
          btn.disabled = false;
        }
      };
      function finish(user) { panel.remove(); sessionStorage.setItem(PIN_UNLOCK_KEY, '1'); resolve(user); }
      input.addEventListener('input', () => { input.value = input.value.replace(/\D/g, '').slice(0, 4); });
      input.addEventListener('keydown', e => { if (e.key === 'Enter') btn.click(); });
    });
  }

  async function loginWithPin() {
    const phone = normalizePhone(document.getElementById('auth-phone').value);
    const pin = (document.getElementById('qarzniuz-login-pin')?.value || '').replace(/\D/g, '');
    if (!/^\+998\d{9}$/.test(phone)) { alert('Iltimos, telefon raqamingizni kiriting.'); return; }
    if (!/^\d{4}$/.test(pin)) { alert('4 xonali PIN-kodni kiriting.'); return; }
    const submit = document.getElementById('auth-submit-btn');
    submit.disabled = true; submit.textContent = 'Kirilmoqda...';
    try {
      const password = await hashPin(pin);
      const { data, error } = await getClient().auth.signInWithPassword({ phone, password });
      if (error) throw error;
      if (!data.user) throw new Error('Foydalanuvchi sessiyasi yaratilmadi');
      const legacy = JSON.parse(localStorage.getItem('registered_users_base') || '{}');
      const old = legacy[storagePhone(phone)] || legacy[phone] || null;
      const profile = await ensureProfile(data.user, { name: '', shop: '' });
      const current = { phone: storagePhone(phone), name: old?.name || profile.name, shopName: old?.shopName || profile.shop };
      legacy[current.phone] = current;
      localStorage.setItem('registered_users_base', JSON.stringify(legacy));
      localStorage.setItem('shop_user', JSON.stringify(current));
      sessionStorage.setItem(PIN_UNLOCK_KEY, '1');
      currentUser = current;
      initApp();
    } catch (error) {
      console.error('QarzniUz PIN login error:', error);
      setStatus('Telefon raqami yoki PIN-kod noto‘g‘ri. PIN-kodni unutgan bo‘lsangiz, “PIN-kodni unutdim” tugmasini bosing.', false);
    } finally {
      submit.disabled = false;
      updateLoginUI();
    }
  }

  async function verifyOtp() {
    if (handled) return;
    const state = pendingState();
    const code = (document.getElementById('qarzniuz-otp-code')?.value || '').replace(/\D/g, '');
    if (!state || !/^\d{6}$/.test(code)) { setStatus('6 xonali SMS kodini kiriting.', false); return; }
    const btn = document.getElementById('qarzniuz-otp-submit');
    btn.disabled = true; setStatus('Tekshirilmoqda...', true);
    try {
      const { data, error } = await getClient().auth.verifyOtp({ phone: state.phone, token: code, type: 'sms' });
      if (error) throw error;
      if (!data.user) throw new Error('Foydalanuvchi sessiyasi yaratilmadi');
      handled = true;
      sessionStorage.removeItem(OTP_STATE_KEY);

      if (state.mode === 'recovery') {
        setStatus('Tasdiqlandi. Yangi PIN-kod yarating.', true);
        const user = await createOrResetPin();
        const meta = user?.user_metadata || data.user.user_metadata || {};
        const current = JSON.parse(localStorage.getItem('shop_user') || 'null');
        const profile = await ensureProfile(data.user, { name: current?.name || meta.full_name || '', shop: current?.shopName || meta.shop_name || '' });
        const finalUser = { phone: storagePhone(state.phone), name: current?.name || profile.name, shopName: current?.shopName || profile.shop };
        localStorage.setItem('shop_user', JSON.stringify(finalUser));
        currentUser = finalUser;
        initApp();
        return;
      }

      const legacy = JSON.parse(localStorage.getItem('registered_users_base') || '{}');
      const old = legacy[storagePhone(state.phone)] || legacy[state.phone] || null;
      const profile = await ensureProfile(data.user, state);
      const current = { phone: storagePhone(state.phone), name: old?.name || profile.name, shopName: old?.shopName || profile.shop };
      legacy[current.phone] = current;
      localStorage.setItem('registered_users_base', JSON.stringify(legacy));
      localStorage.setItem('shop_user', JSON.stringify(current));
      setStatus('Tasdiqlandi. PIN-kod yaratilmoqda...', true);
      await createOrResetPin();
      currentUser = current;
      initApp();
    } catch (error) {
      console.error('QarzniUz OTP verify error:', error);
      setStatus('Kod noto‘g‘ri yoki muddati tugagan: ' + (error?.message || ''), false);
      handled = false;
    } finally {
      btn.disabled = false;
    }
  }

  function installAuthHandler() {
    const form = document.getElementById('auth-form');
    if (!form) return;
    addPinLoginUI();
    updateLoginUI();

    form.addEventListener('submit', function (event) {
      event.preventDefault();
      event.stopImmediatePropagation();
      const mode = (typeof authMode !== 'undefined') ? authMode : 'login';
      if (mode === 'login') loginWithPin(); else sendOtp();
    }, true);

    window.logoutApp = async function () {
      try { await getClient().auth.signOut(); } catch (_) {}
      localStorage.removeItem('shop_user');
      sessionStorage.removeItem(PIN_UNLOCK_KEY);
      currentUser = null;
      window.location.reload();
    };

    window.__qarzniuzAuthModeChanged = updateLoginUI;
    if (typeof window.switchAuthMode === 'function') {
      const originalSwitch = window.switchAuthMode;
      window.switchAuthMode = function (mode) { originalSwitch(mode); setTimeout(updateLoginUI, 0); };
    }
  }

  function boot() {
    try {
      getClient();
      installAuthHandler();
    } catch (error) {
      console.error('QarzniUz Auth boot failed:', error);
      setStatus('Autentifikatsiya ishga tushmadi: ' + (error?.message || 'noma’lum xatolik'), false);
    }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot, { once: true }); else boot();
})();
