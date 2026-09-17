/* TemirDaftar Analytics V1
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
      console.warn('TemirDaftar analytics user registration failed:', error);
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
      console.warn('TemirDaftar analytics event failed:', eventName, error);
    }
  }

  window.TemirDaftarAnalytics = {
    track: track,
    registerUser: registerUser
  };

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
          phone_present: Boolean(phone),
          name_present: Boolean(name),
          shop_present: Boolean(shop)
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

      if (target.id === 'btn-tab-pro') {
        track('premium_page_opened');
      }

      if (target.id === 'btn-send-bot') {
        track('premium_payment_started', { channel: 'telegram' });
      }

      if (target.id === 'btn-activate-promo') {
        const user = getCurrentUserSafe();
        const oldExpire = user ? localStorage.getItem('premium_expire_date_' + user.phone) : null;
        const startedAt = Date.now();

        setTimeout(function () {
          if (!user) return;
          const newExpire = localStorage.getItem('premium_expire_date_' + user.phone);
          if (newExpire && newExpire !== oldExpire && Date.now() - startedAt < 10000) {
            track('premium_activated', {
              plan: 'premium_30_days',
              price_uzs: 25000,
              activation: 'promo_code'
            });
          }
        }, 1200);
      }

      if (target.classList.contains('btn-partial')) {
        track('debt_partial_payment_clicked');
      }

      if (target.classList.contains('btn-pay')) {
        track('debt_full_payment_clicked');
      }
    }, true);
  }

  function setupStorageTracking() {
    const originalSetItem = Storage.prototype.setItem;
    if (originalSetItem.__temirdaftarWrapped) return;

    function wrappedSetItem(key, value) {
      const oldValue = this.getItem(key);
      originalSetItem.call(this, key, value);

      if (this !== localStorage || oldValue === value) return;

      if (key.indexOf('is_premium_user_') === 0 && value === 'true' && oldValue !== 'true') {
        const user = getCurrentUserSafe();
        const isTrial = user && !localStorage.getItem('td_paid_premium_seen_' + user.phone);
        if (isTrial) {
          track('premium_trial_started', { days: 3 });
        }
      }
    }

    wrappedSetItem.__temirdaftarWrapped = true;
    Storage.prototype.setItem = wrappedSetItem;
  }

  function boot() {
    captureCampaign();
    setupStorageTracking();
    setupFormTracking();
    setupCustomerTracking();
    setupClickTracking();

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
