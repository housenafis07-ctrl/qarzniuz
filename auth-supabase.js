/* QarzniUz Supabase Phone OTP bridge.
 * Stage 1 of the new authentication flow:
 * phone -> SMS OTP -> Supabase session.
 * Existing localStorage debt data is preserved and reused by phone key.
 */
(function () {
  'use strict';

  const SUPABASE_URL = 'https://yzicsoyufdghwiezqjsa.supabase.co';
  const SUPABASE_ANON_KEY = 'sb_publishable_nneWyKMepgYOVpn8fVXwMA_4m98kinM';
  const OTP_STATE_KEY = 'qarzniuz_pending_otp';

  let client = null;
  let handled = false;

  function getClient() {
    if (client) return client;
    if (!window.supabase || typeof window.supabase.createClient !== 'function') {
      throw new Error('Supabase JS yuklanmadi');
    }
    client = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false }
    });
    return client;
  }

  function normalizePhone(raw) {
    let digits = String(raw || '').replace(/\D/g, '');
    if (digits.startsWith('998')) return '+' + digits;
    if (digits.startsWith('8') && digits.length === 9) return '+998' + digits;
    if (digits.length === 9) return '+998' + digits;
    return '+' + digits;
  }

  function storagePhone(phone) {
    return String(phone || '').replace(/\D/g, '');
  }

  function setStatus(text, ok) {
    let el = document.getElementById('qarzniuz-otp-status');
    if (!el) return;
    el.textContent = text || '';
    el.style.color = ok ? '#15803d' : '#b91c1c';
  }

  function ensureOtpPanel() {
    let panel = document.getElementById('qarzniuz-otp-panel');
    if (panel) return panel;

    panel = document.createElement('div');
    panel.id = 'qarzniuz-otp-panel';
    panel.style.cssText = 'margin-top:14px; padding:16px; border:1px solid #bfdbfe; border-radius:10px; background:#eff6ff;';
    panel.innerHTML = `
      <div style="font-weight:700; margin-bottom:6px;">SMS orqali tasdiqlash</div>
      <div id="qarzniuz-otp-hint" style="font-size:13px;color:#475569;margin-bottom:10px;"></div>
      <input id="qarzniuz-otp-code" inputmode="numeric" autocomplete="one-time-code" maxlength="6" placeholder="6 xonali kod" style="margin-bottom:8px;">
      <button id="qarzniuz-otp-submit" type="button" class="btn">Kodni tasdiqlash</button>
      <button id="qarzniuz-otp-resend" type="button" class="btn btn-secondary">Kodni qayta yuborish</button>
      <div id="qarzniuz-otp-status" style="font-size:13px;margin-top:9px;min-height:18px;"></div>
    `;
    document.getElementById('auth-form').after(panel);

    document.getElementById('qarzniuz-otp-submit').addEventListener('click', verifyOtp);
    document.getElementById('qarzniuz-otp-resend').addEventListener('click', resendOtp);
    return panel;
  }

  function showOtp(phone) {
    const panel = ensureOtpPanel();
    panel.style.display = 'block';
    document.getElementById('qarzniuz-otp-hint').textContent = phone + ' raqamiga SMS kod yuborildi.';
    document.getElementById('qarzniuz-otp-code').focus();
  }

  function pendingState() {
    try { return JSON.parse(sessionStorage.getItem(OTP_STATE_KEY) || 'null'); } catch (_) { return null; }
  }

  async function sendOtp() {
    const phoneInput = document.getElementById('auth-phone');
    const phone = normalizePhone(phoneInput.value);
    if (!/^\+998\d{9}$/.test(phone)) {
      alert('Iltimos, +998XXXXXXXXX formatida telefon raqamini kiriting.');
      return;
    }

    const mode = (typeof authMode !== 'undefined') ? authMode : 'login';
    const name = (document.getElementById('auth-name')?.value || '').trim();
    const shop = (document.getElementById('auth-shop')?.value || '').trim();
    if (mode === 'register' && (!name || !shop)) {
      alert('Ism va do‘kon nomini kiriting.');
      return;
    }

    const submit = document.getElementById('auth-submit-btn');
    submit.disabled = true;
    submit.textContent = 'SMS yuborilmoqda...';
    setStatus('', true);

    try {
      const { error } = await getClient().auth.signInWithOtp({
        phone,
        options: {
          shouldCreateUser: true,
          data: {
            full_name: name || null,
            shop_name: shop || null,
            source: 'qarzniuz-web'
          }
        }
      });
      if (error) throw error;

      sessionStorage.setItem(OTP_STATE_KEY, JSON.stringify({ phone, mode, name, shop, sentAt: Date.now() }));
      showOtp(phone);
      setStatus('SMS yuborildi. Kodni kiriting.', true);
    } catch (error) {
      console.error('QarzniUz OTP send error:', error);
      setStatus('SMS yuborilmadi: ' + (error.message || 'noma’lum xatolik'), false);
    } finally {
      submit.disabled = false;
      submit.textContent = mode === 'register' ? 'Ro‘yxatdan o‘tish' : 'Kirish';
    }
  }

  async function resendOtp() {
    const state = pendingState();
    if (!state) return;
    try {
      const { error } = await getClient().auth.signInWithOtp({
        phone: state.phone,
        options: {
          shouldCreateUser: true,
          data: { full_name: state.name || null, shop_name: state.shop || null, source: 'qarzniuz-web' }
        }
      });
      if (error) throw error;
      state.sentAt = Date.now();
      sessionStorage.setItem(OTP_STATE_KEY, JSON.stringify(state));
      setStatus('Yangi SMS kod yuborildi.', true);
    } catch (error) {
      console.error('QarzniUz OTP resend error:', error);
      setStatus('Qayta yuborishda xatolik: ' + (error.message || 'noma’lum xatolik'), false);
    }
  }

  async function ensureProfile(user, state) {
    try {
      const meta = user.user_metadata || {};
      const name = state.name || meta.full_name || 'Foydalanuvchi';
      const shop = state.shop || meta.shop_name || "Mening Do'konim";
      const { error } = await getClient().from('profiles').upsert({
        id: user.id,
        full_name: name,
        phone: storagePhone(user.phone)
      }, { onConflict: 'id' });
      if (error) console.warn('QarzniUz profile upsert:', error.message);
      return { name, shop };
    } catch (error) {
      console.warn('QarzniUz profile sync skipped:', error);
      return {
        name: state.name || user.user_metadata?.full_name || 'Foydalanuvchi',
        shop: state.shop || user.user_metadata?.shop_name || "Mening Do'konim"
      };
    }
  }

  async function verifyOtp() {
    if (handled) return;
    const state = pendingState();
    const code = (document.getElementById('qarzniuz-otp-code')?.value || '').replace(/\D/g, '');
    if (!state || !/^\d{6}$/.test(code)) {
      setStatus('6 xonali SMS kodini kiriting.', false);
      return;
    }

    const btn = document.getElementById('qarzniuz-otp-submit');
    btn.disabled = true;
    setStatus('Tekshirilmoqda...', true);

    try {
      const { data, error } = await getClient().auth.verifyOtp({
        phone: state.phone,
        token: code,
        type: 'sms'
      });
      if (error) throw error;
      if (!data.user) throw new Error('Foydalanuvchi sessiyasi yaratilmadi');

      handled = true;
      const legacy = JSON.parse(localStorage.getItem('registered_users_base') || '{}');
      const old = legacy[storagePhone(state.phone)] || legacy[state.phone] || null;
      const profile = await ensureProfile(data.user, state);
      const current = {
        phone: storagePhone(state.phone),
        name: old?.name || profile.name,
        shopName: old?.shopName || profile.shop
      };

      legacy[current.phone] = current;
      localStorage.setItem('registered_users_base', JSON.stringify(legacy));
      localStorage.setItem('shop_user', JSON.stringify(current));
      sessionStorage.removeItem(OTP_STATE_KEY);

      setStatus('Tasdiqlandi. Tizim ochilmoqda...', true);
      if (typeof window.initApp === 'function') {
        window.currentUser = current;
        window.initApp();
      } else {
        window.location.reload();
      }
    } catch (error) {
      console.error('QarzniUz OTP verify error:', error);
      setStatus('Kod noto‘g‘ri yoki muddati tugagan: ' + (error.message || ''), false);
    } finally {
      btn.disabled = false;
    }
  }

  function installAuthHandler() {
    const form = document.getElementById('auth-form');
    if (!form) return;

    form.addEventListener('submit', function (event) {
      event.preventDefault();
      event.stopImmediatePropagation();
      sendOtp();
    }, true);

    const oldLogout = window.logoutApp;
    window.logoutApp = async function () {
      try { await getClient().auth.signOut(); } catch (_) {}
      localStorage.removeItem('shop_user');
      window.currentUser = null;
      window.location.reload();
    };

    getClient().auth.getSession().then(function ({ data }) {
      if (!data.session) return;
      // The existing app still uses currentUser/localStorage for its local debt key.
      // Do not silently rewrite that data here; OTP verification does the migration.
    }).catch(function (error) {
      console.warn('QarzniUz session check failed:', error);
    });
  }

  function boot() {
    try {
      getClient();
      installAuthHandler();
    } catch (error) {
      console.error('QarzniUz Auth boot failed:', error);
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot, { once: true });
  } else {
    boot();
  }
})();
