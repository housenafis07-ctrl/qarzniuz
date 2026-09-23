/* QarzniUz Analytics V1
 * Frontend-only analytics layer.
 * Does not read or expose the Supabase service key.
 * Uses the existing public Supabase client + SECURITY DEFINER RPCs.
 */
(function () {
  'use strict';

  const USER_ID_KEY = 'td_analytics_user_id';
  const SOURCE_KEY = 'td_analytics_source';
  const CAMPAIGN_KEY = 'td_analytics_campaign';
  const SESSION_KEY = 'td_analytics_session';
  const APP_OPEN_KEY = 'td_analytics_app_opened';
  const INSTALL_DISMISSED_KEY = 'td_install_banner_dismissed_until';
  const AUTH_SCRIPT_VERSION = '20260923-2';

  function getClient() {
    try {
      return (typeof supabaseClient !== 'undefined') ? supabaseClient : null;
    } catch (_) {
      return null;
    }
  }

  function getCurrentUserSafe() {
    try {
      if (typeof currentUser !== 'undefined' && currentUser) return currentUser;
    } catch (_) {}
    try {
      return JSON.parse(localStorage.getItem('shop_user') || 'null');
    } catch (_) {
      return null;
    }
  }

  function getAnalyticsUserId() {
    let id = localStorage.getItem(USER_ID_KEY);
    if (!id && crypto && crypto.randomUUID) {
      id = crypto.randomUUID();
      localStorage.setItem(USER_ID_KEY, id);
    }
    return id;
  }

  function captureCampaign() {
    try {
      const params = new URLSearchParams(window.location.search);
      const source = params.get('utm_source') || params.get('source');
      const campaign = params.get('utm_campaign') || params.get('campaign');

      if (source) localStorage.setItem(SOURCE_KEY, source.slice(0, 100));
      if (campaign) localStorage.setItem(CAMPAIGN_KEY, campaign.slice(0, 150));

      return {
        source: localStorage.getItem(SOURCE_KEY) || 'direct',
        campaign: localStorage.getItem(CAMPAIGN_KEY) || null
      };
    } catch (_) {
      return { source: 'direct', campaign: null };
    }
  }

  function getContext() {
    const user = getCurrentUserSafe();
    const campaign = captureCampaign();
    return {
      userId: getAnalyticsUserId(),
      user,
      source: campaign.source,
      campaign: campaign.campaign
    };
  }

  async function registerUser() {
    const client = getClient();
    const ctx = getContext();
    if (!client || !ctx.userId || !ctx.user) return;

    try {
      await client.rpc('register_analytics_user', {
        p_user_id: ctx.userId,
        p_phone: ctx.user.phone || null,
        p_name: ctx.user.name || null,
        p_shop_name: ctx.user.shopName || null,
        p_language: localStorage.getItem('app_lang') || 'uz',
        p_source: ctx.source,
        p_campaign: ctx.campaign
      });
    } catch (error) {
      console.warn('QarzniUz analytics user registration failed:', error);
    }
  }

  async function track(eventName, metadata) {
    const client = getClient();
    const ctx = getContext();
    if (!client || !ctx.userId || !eventName) return;

    try {
      await client.rpc('track_analytics_event', {
        p_user_id: ctx.userId,
        p_event_name: eventName,
        p_source: ctx.source,
        p_campaign: ctx.campaign,
        p_metadata: metadata || {}
      });
    } catch (error) {
      console.warn('QarzniUz analytics event failed:', eventName, error);
    }
  }

  window.TemirDaftarAnalytics = {
    track: track,
    registerUser: registerUser
  };

  function setupInstallBanner() {
    try {
      const standalone = window.matchMedia && window.matchMedia('(display-mode: standalone)').matches;
      const iosStandalone = window.navigator.standalone === true;
      if (standalone || iosStandalone) return;

      const dismissedUntil = Number(localStorage.getItem(INSTALL_DISMISSED_KEY) || 0);
      if (dismissedUntil > Date.now()) return;

      const style = document.createElement('style');
      style.textContent = `
        #td-install-banner {
          position: fixed;
          left: 12px;
          right: 12px;
          bottom: 82px;
          z-index: 5000;
          display: none;
          align-items: center;
          gap: 10px;
          padding: 12px 12px 12px 14px;
          background: rgba(255,255,255,.98);
          border: 1px solid #dbeafe;
          border-radius: 14px;
          box-shadow: 0 8px 28px rgba(15,23,42,.18);
          animation: tdInstallSlide .28s ease-out;
        }
        #td-install-banner .td-install-icon { width: 42px; height: 42px; flex: 0 0 42px; border-radius: 10px; object-fit: cover; }
        #td-install-banner .td-install-copy { min-width: 0; flex: 1; }
        #td-install-banner .td-install-title { font-size: 14px; font-weight: 800; color: #1e293b; margin-bottom: 2px; }
        #td-install-banner .td-install-text { font-size: 11.5px; line-height: 1.35; color: #64748b; }
        #td-install-banner .td-install-action { border: 0; border-radius: 9px; padding: 9px 11px; background: #2563eb; color: #fff; font-size: 11px; font-weight: 800; white-space: nowrap; cursor: pointer; }
        #td-install-banner .td-install-close { position: absolute; top: -8px; right: -5px; width: 24px; height: 24px; border: 1px solid #e2e8f0; border-radius: 50%; background: #fff; color: #64748b; font-size: 15px; line-height: 20px; cursor: pointer; }
        @keyframes tdInstallSlide { from { opacity: 0; transform: translateY(16px); } to { opacity: 1; transform: translateY(0); } }
        @media (min-width: 700px) { #td-install-banner { max-width: 520px; left: 50%; right: auto; transform: translateX(-50%); width: calc(100% - 24px); } }
      `;
      document.head.appendChild(style);

      const banner = document.createElement('div');
      banner.id = 'td-install-banner';
      banner.innerHTML = `
        <img class="td-install-icon" src="/icons/icon-192.png" alt="QarzniUz">
        <div class="td-install-copy">
          <div class="td-install-title" id="td-install-title">📱 QarzniUz ilovasini o‘rnating</div>
          <div class="td-install-text" id="td-install-text">Telefoningizda tezroq va qulayroq foydalaning.</div>
        </div>
        <button class="td-install-action" id="td-install-action" type="button">O‘RNATISH</button>
        <button class="td-install-close" id="td-install-close" type="button" aria-label="Yopish">×</button>
      `;
      document.body.appendChild(banner);

      const lang = localStorage.getItem('app_lang') || 'uz';
      if (lang === 'ru') {
        document.getElementById('td-install-title').textContent = '📱 Установите приложение QarzniUz';
        document.getElementById('td-install-text').textContent = 'Пользуйтесь приложением быстрее и удобнее.';
        document.getElementById('td-install-action').textContent = 'УСТАНОВИТЬ';
      }

      const show = () => { if (document.visibilityState === 'visible') banner.style.display = 'flex'; };

      document.getElementById('td-install-close').addEventListener('click', function () {
        banner.style.display = 'none';
        localStorage.setItem(INSTALL_DISMISSED_KEY, String(Date.now() + 7 * 24 * 60 * 60 * 1000));
      });

      document.getElementById('td-install-action').addEventListener('click', function () {
        track('app_install_clicked', { method: 'apk_download' });
        window.location.href = '/QarzniUz.apk';
      });

      setTimeout(show, 2500);
    } catch (error) {
      console.warn('QarzniUz install banner setup failed:', error);
    }
  }

  function setupFormTracking() {
    const form = document.getElementById('auth-form');
    if (!form) return;

    form.addEventListener('submit', function () {
      const phone = (document.getElementById('auth-phone')?.value || '').replace(/\D/g, '');
      const name = document.getElementById('auth-name')?.value?.trim() || null;
      const shop = document.getElementById('auth-shop')?.value?.trim() || null;
      const mode = (typeof authMode !== 'undefined') ? authMode : 'login';

      setTimeout(function () {
        registerUser();
        track(mode === 'register' ? 'user_registered' : 'user_login', {
          phone_present: Boolean(phone), name_present: Boolean(name), shop_present: Boolean(shop)
        });
      }, 300);
    }, true);
  }

  function setupCustomerTracking() {
    const form = document.getElementById('add-debt-form');
    if (!form) return;

    form.addEventListener('submit', function () {
      const user = getCurrentUserSafe();
      const before = user ? JSON.parse(localStorage.getItem('shop_debts_' + user.phone) || '[]') : [];
      const beforeCount = before.length;

      setTimeout(function () {
        const afterUser = getCurrentUserSafe();
        if (!afterUser) return;
        const after = JSON.parse(localStorage.getItem('shop_debts_' + afterUser.phone) || '[]');
        if (after.length > beforeCount) {
          track('customer_added', { customer_count: after.length });
          track('debt_added', { customer_count: after.length });
        }
      }, 500);
    }, true);
  }

  function setupClickTracking() {
    document.addEventListener('click', function (event) {
      const target = event.target.closest ? event.target.closest('button, a') : null;
      if (!target) return;

      if (target.id === 'btn-tab-pro') track('premium_page_opened');
      if (target.id === 'btn-send-bot') track('premium_payment_started', { channel: 'telegram' });

      if (target.id === 'btn-activate-promo') {
        const user = getCurrentUserSafe();
        const oldExpire = user ? localStorage.getItem('premium_expire_date_' + user.phone) : null;
        const startedAt = Date.now();
        setTimeout(function () {
          if (!user) return;
          const newExpire = localStorage.getItem('premium_expire_date_' + user.phone);
          if (newExpire && newExpire !== oldExpire && Date.now() - startedAt < 10000) {
            track('premium_activated', { plan: 'premium_30_days', price_uzs: 25000, activation: 'promo_code' });
          }
        }, 1200);
      }

      if (target.classList.contains('btn-partial')) track('debt_partial_payment_clicked');
      if (target.classList.contains('btn-pay')) track('debt_full_payment_clicked');
    }, true);
  }

  function setupStorageTracking() {
    const originalSetItem = Storage.prototype.setItem;
    if (originalSetItem.__qarzniuzWrapped) return;

    function wrappedSetItem(key, value) {
      const oldValue = this.getItem(key);
      originalSetItem.call(this, key, value);
      if (this !== localStorage || oldValue === value) return;

      if (key.indexOf('is_premium_user_') === 0 && value === 'true' && oldValue !== 'true') {
        const user = getCurrentUserSafe();
        const isTrial = user && !localStorage.getItem('td_paid_premium_seen_' + user.phone);
        if (isTrial) track('premium_trial_started', { days: 3 });
      }
    }

    wrappedSetItem.__qarzniuzWrapped = true;
    Storage.prototype.setItem = wrappedSetItem;
  }

  function loadAuthBridge() {
    if (document.querySelector('script[data-qarzniuz-auth]')) return;

    const script = document.createElement('script');
    script.src = '/auth-supabase.js?v=' + AUTH_SCRIPT_VERSION;
    script.async = false;
    script.dataset.qarzniuzAuth = '1';

    script.onerror = function () {
      console.error('QarzniUz auth-supabase.js yuklanmadi:', script.src);
    };

    document.head.appendChild(script);
  }

  function boot() {
    captureCampaign();
    setupStorageTracking();
    setupInstallBanner();
    setupFormTracking();
    setupCustomerTracking();
    setupClickTracking();
    loadAuthBridge();

    registerUser();

    const sessionKey = SESSION_KEY;
    if (!sessionStorage.getItem(sessionKey)) {
      sessionStorage.setItem(sessionKey, '1');
      track('session_started');
    }

    if (!localStorage.getItem(APP_OPEN_KEY)) {
      localStorage.setItem(APP_OPEN_KEY, '1');
      track('app_first_open');
    }

    track('app_open');
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot, { once: true });
  } else {
    boot();
  }
})();
