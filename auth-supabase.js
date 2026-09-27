/* QarzniUz auth: phone + 4-digit PIN. SMS only for registration and PIN recovery. */
(function () {
  'use strict';
  const SUPABASE_URL = 'https://yzicsoyufdghwiezqjsa.supabase.co';
  const SUPABASE_ANON_KEY = 'sb_publishable_nneWyKMepgYOVpn8fVXwMA_4m98kinM';
  const OTP_STATE_KEY = 'qarzniuz_pending_otp';
  let client = null, busy = false;
  function getClient(){ if(!client) client=window.supabase.createClient(SUPABASE_URL,SUPABASE_ANON_KEY,{auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:false}}); return client; }
  function mode(){ return typeof authMode!=='undefined' ? authMode : 'login'; }
  function phone(){ const d=String(document.getElementById('auth-phone')?.value||'').replace(/\D/g,''); if(d.startsWith('998'))return '+'+d; if(d.startsWith('8')&&d.length===9)return '+998'+d; if(d.length===9)return '+998'+d; return '+'+d; }
  function pin(){ return String(document.getElementById('qarzniuz-login-pin')?.value||'').replace(/\D/g,''); }
  function storagePhone(v){ return String(v||'').replace(/\D/g,''); }
  async function hashPin(v){ const d=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(v)); return Array.from(new Uint8Array(d)).map(x=>x.toString(16).padStart(2,'0')).join(''); }
  function status(text,ok=true){ let el=document.getElementById('qarzniuz-otp-status'); if(!el){el=document.createElement('div');el.id='qarzniuz-otp-status';el.style.cssText='margin-top:10px;padding:10px 12px;border-radius:8px;font-size:13px;';document.getElementById('auth-form')?.after(el);} el.textContent=text||'';el.style.color=ok?'#15803d':'#b91c1c';el.style.background=ok?'#f0fdf4':'#fef2f2'; }
  function addPinUI(){ const form=document.getElementById('auth-form'),reg=document.getElementById('reg-fields'); if(!form||document.getElementById('qarzniuz-pin-login-wrap'))return; const wrap=document.createElement('div');wrap.id='qarzniuz-pin-login-wrap';wrap.className='form-group';wrap.innerHTML='<label>4 xonali PIN-kod</label><input type="password" id="qarzniuz-login-pin" inputmode="numeric" autocomplete="current-password" maxlength="4" pattern="[0-9]{4}" placeholder="••••"><button type="button" id="qarzniuz-forgot-pin" style="display:block;margin:9px 0 0 auto;background:none;border:0;color:#2563eb;font-size:13px;font-weight:600;cursor:pointer;">PIN-kodni unutdim</button>';(reg||form).before(wrap);const p=document.getElementById('qarzniuz-login-pin');p.addEventListener('input',()=>p.value=p.value.replace(/\D/g,'').slice(0,4));document.getElementById('qarzniuz-forgot-pin').addEventListener('click',e=>{e.preventDefault();e.stopPropagation();e.stopImmediatePropagation();startRecovery();},true); }
  function updateUI(){ addPinUI();const login=mode()==='login',wrap=document.getElementById('qarzniuz-pin-login-wrap'),p=document.getElementById('qarzniuz-login-pin'),btn=document.getElementById('auth-submit-btn');if(wrap)wrap.style.display=login?'block':'none';if(p)p.required=login;if(btn){btn.type='button';btn.textContent=login?'Kirish':'Ro‘yxatdan o‘tish';} }
  function otpPanel(){ let p=document.getElementById('qarzniuz-otp-panel');if(p)return p;p=document.createElement('div');p.id='qarzniuz-otp-panel';p.style.cssText='margin-top:14px;padding:16px;border:1px solid #bfdbfe;border-radius:10px;background:#eff6ff;display:none;';p.innerHTML='<div style="font-weight:700;margin-bottom:6px;">SMS orqali tasdiqlash</div><div id="qarzniuz-otp-hint" style="font-size:13px;color:#475569;margin-bottom:10px;"></div><input id="qarzniuz-otp-code" inputmode="numeric" autocomplete="one-time-code" maxlength="6" placeholder="6 xonali kod" style="margin-bottom:8px"><button id="qarzniuz-otp-submit" type="button" class="btn">Kodni tasdiqlash</button><button id="qarzniuz-otp-resend" type="button" class="btn btn-secondary">Kodni qayta yuborish</button><div id="qarzniuz-otp-msg" style="font-size:13px;margin-top:9px;min-height:18px"></div>';document.getElementById('auth-form').after(p);document.getElementById('qarzniuz-otp-submit').addEventListener('click',verifyOtp);document.getElementById('qarzniuz-otp-resend').addEventListener('click',resendOtp);return p; }
  function showOtp(ph,recovery){const p=otpPanel();p.style.display='block';document.getElementById('qarzniuz-otp-hint').textContent=recovery?ph+' raqamiga PIN tiklash uchun SMS kod yuborildi.':ph+' raqamiga SMS kod yuborildi.';document.getElementById('qarzniuz-otp-code').focus();}
  async function sendRegistrationOtp(){
    const ph=phone(),name=(document.getElementById('auth-name')?.value||'').trim();
    const role=String(document.getElementById('auth-role')?.value||'OWNER').toUpperCase()==='SELLER'?'SELLER':'OWNER';
    const shop=(document.getElementById('auth-shop')?.value||'').trim();
    if(!/^\+998\d{9}$/.test(ph))return alert('Iltimos, +998XXXXXXXXX formatida telefon raqamini kiriting.');
    if(!name)return alert('Ismingizni kiriting.');
    if(role==='OWNER'&&!shop)return alert('Do‘kon nomini kiriting.');
    if(busy)return;busy=true;
    try{
      // Registration must start from a clean auth session. Otherwise a previously
      // logged-in user's access token can be reused during OTP/PIN setup.
      try{await getClient().auth.signOut({scope:'local'});}catch(_){}
      const{error}=await getClient().auth.signInWithOtp({
        phone:ph,
        options:{shouldCreateUser:true,data:{full_name:name,shop_name:role==='OWNER'?shop:null,source:'qarzniuz-web',qz_registration_intent:role}}
      });
      if(error)throw error;
      sessionStorage.setItem(OTP_STATE_KEY,JSON.stringify({phone:ph,mode:'register',registrationRole:role,name,shop:role==='OWNER'?shop:'',sentAt:Date.now()}));
      showOtp(ph,false);status('SMS yuborildi. Kodni kiriting.');
    }catch(e){status('SMS yuborilmadi: '+(e?.message||'noma’lum xatolik'),false);}
    finally{busy=false;updateUI();}
  }
  async function startRecovery(){const ph=phone();if(!/^\+998\d{9}$/.test(ph))return alert('Avval telefon raqamingizni kiriting.');if(busy)return;busy=true;try{try{await getClient().auth.signOut({scope:'local'});}catch(_){}const{error}=await getClient().auth.signInWithOtp({phone:ph,options:{shouldCreateUser:false}});if(error)throw error;sessionStorage.setItem(OTP_STATE_KEY,JSON.stringify({phone:ph,mode:'recovery',name:'',shop:'',sentAt:Date.now()}));showOtp(ph,true);status('SMS yuborildi. Kodni kiriting.');}catch(e){status('PIN tiklash SMS yuborilmadi: '+(e?.message||'raqam ro‘yxatdan o‘tmagan'),false);}finally{busy=false;}}
  function readState(){try{return JSON.parse(sessionStorage.getItem(OTP_STATE_KEY)||'null')}catch(_){return null}}
  async function resendOtp(){
    const s=readState();if(!s||busy)return;busy=true;
    try{
      const{error}=await getClient().auth.signInWithOtp({
        phone:s.phone,
        options:{shouldCreateUser:s.mode!=='recovery',data:{full_name:s.name||null,shop_name:s.registrationRole==='OWNER'?(s.shop||null):null,source:'qarzniuz-web',qz_registration_intent:s.registrationRole||null}}
      });
      if(error)throw error;s.sentAt=Date.now();sessionStorage.setItem(OTP_STATE_KEY,JSON.stringify(s));status('Yangi SMS kod yuborildi.');
    }catch(e){status('Qayta yuborishda xatolik: '+(e?.message||'noma’lum xatolik'),false);}finally{busy=false;}
  }
  function pinPanel(){const p=document.createElement('div');p.id='qarzniuz-pin-panel';p.style.cssText='position:fixed;inset:0;z-index:99999;background:#fff;display:flex;align-items:center;justify-content:center;padding:24px;';p.innerHTML='<div style="width:min(380px,100%);text-align:center;font-family:inherit"><div style="font-size:24px;font-weight:800;margin-bottom:8px">QarzniUz</div><div id="q-pin-title" style="font-size:18px;font-weight:700;margin-bottom:8px">Yangi PIN-kod yarating</div><div id="q-pin-hint" style="font-size:13px;color:#64748b;margin-bottom:18px">4 xonali PIN-kod kiriting</div><input id="q-pin-input" inputmode="numeric" autocomplete="new-password" maxlength="4" type="password" style="width:100%;text-align:center;font-size:26px;letter-spacing:14px;padding:12px;border:1px solid #cbd5e1;border-radius:12px"><button id="q-pin-btn" type="button" class="btn" style="width:100%;margin-top:12px">Davom etish</button><div id="q-pin-error" style="min-height:20px;margin-top:10px;color:#b91c1c;font-size:13px"></div></div>';document.body.appendChild(p);return p;}
  async function setPin(verifiedUser=null,verifiedSession=null,isRegistration=false){const p=pinPanel(),input=p.querySelector('#q-pin-input'),btn=p.querySelector('#q-pin-btn'),title=p.querySelector('#q-pin-title'),hint=p.querySelector('#q-pin-hint'),err=p.querySelector('#q-pin-error');let first=null;const render=()=>{const c=first!==null;title.textContent=c?'PIN-kodni tasdiqlang':'Yangi PIN-kod yarating';hint.textContent=c?'Xuddi shu 4 xonali PIN-kodni yana kiriting.':'Keyingi kirishlarda telefon raqami bilan birga shu PIN-kod ishlatiladi.';btn.textContent=c?'PIN-kodni saqlash':'Davom etish';};render();input.focus();btn.onclick=async()=>{const v=input.value.replace(/\D/g,'');err.textContent='';if(!/^\d{4}$/.test(v)){err.textContent='PIN-kod aynan 4 ta raqamdan iborat bo‘lishi kerak.';return}if(first===null){first=v;input.value='';render();return}if(v!==first){err.textContent='PIN-kodlar mos kelmadi.';first=null;input.value='';render();return}btn.disabled=true;try{const h=await hashPin(v);const currentUser=verifiedUser||null;const current=currentUser?{data:{user:currentUser},error:null}:await getClient().auth.getUser();if(current.error)throw current.error;const{error}=await getClient().auth.updateUser({password:h,data:{...(current.data?.user?.user_metadata||{}),qarzniuz_pin_hash:h}});if(error)throw error;p.remove();await finishLogin(current.data.user,verifiedSession,isRegistration);}catch(e){console.error('QarzniUz set PIN:',e);err.textContent=e?.message||'PIN-kodni saqlashda xatolik. Qayta urinib ko‘ring.';btn.disabled=false;}};input.addEventListener('input',()=>input.value=input.value.replace(/\D/g,'').slice(0,4));input.addEventListener('keydown',e=>{if(e.key==='Enter')btn.click()});}
  async function openShopPanel(user){
    try{
      const {data:{session}}=await getClient().auth.getSession();
      if(!session?.access_token) throw new Error('Sessiya yaratilmadi');
      sessionStorage.setItem('qarzniuz_shop_session', JSON.stringify({
        access_token: session.access_token,
        refresh_token: session.refresh_token || null
      }));
      window.location.href='/shop.html';
      return true;
    }catch(e){
      console.error('QarzniUz shop handoff:',e);
      status('Kirish amalga oshdi, lekin do‘kon paneliga o‘tishda xatolik: '+(e?.message||'server xatosi'),false);
      return false;
    }
  }
  async function loginWithPin(){const ph=phone(),pv=pin();if(!/^\+998\d{9}$/.test(ph))return alert('Iltimos, +998XXXXXXXXX formatida telefon raqamini kiriting.');if(!/^\d{4}$/.test(pv))return alert('4 xonali PIN-kodni kiriting.');if(busy)return;busy=true;const btn=document.getElementById('auth-submit-btn');if(btn){btn.disabled=true;btn.textContent='Kirilmoqda...'}try{sessionStorage.removeItem(OTP_STATE_KEY);const h=await hashPin(pv),{data,error}=await getClient().auth.signInWithPassword({phone:ph,password:h});if(error)throw error;if(!data?.user||!data?.session)throw new Error('Auth sessiyasi yaratilmadi.');await finishLogin(data.user,data.session,false);}catch(e){console.error('QarzniUz PIN login:',e);status(e?.message||'Telefon yoki PIN-kod noto‘g‘ri. Agar bu eski akkaunt bo‘lsa, “PIN-kodni unutdim” orqali PINni bir marta qayta o‘rnating.',false);}finally{busy=false;if(btn){btn.disabled=false;updateUI();}}}
  async function finishLogin(user,session=null,isRegistration=false){
    if(!user)return;
    const meta=user.user_metadata||{};
    const s=isRegistration?(readState()||{}):{};
    const registrationRole=isRegistration?(String(s.registrationRole||'OWNER').toUpperCase()==='SELLER'?'SELLER':'OWNER'):null;
    const name=isRegistration?(s.name||meta.full_name||'Foydalanuvchi'):(meta.full_name||'Foydalanuvchi');
    const shop=isRegistration&&registrationRole==='OWNER'?(s.shop||meta.shop_name||"Mening Do'konim"):(meta.shop_name||'');
    if(isRegistration){
      try{
        await getClient().auth.updateUser({data:{
          ...meta,
          full_name:name,
          shop_name:registrationRole==='OWNER'?shop:null,
          qz_registration_intent:registrationRole
        }});
      }catch(e){console.warn('Registration intent:',e)}
    }
    // Use the fresh session returned by signInWithPassword/verifyOtp.
    // If it is not available, getSession() will recover/refresh it as needed.
    try{
      if(!session?.access_token){
        const current=await getClient().auth.getSession();
        if(current.error)throw current.error;
        session=current.data?.session||null;
      }
      if(!session?.access_token)throw new Error('Sessiya yaratilmadi.');
    }catch(e){
      console.error('QarzniUz session:',e);
      throw new Error('Sessiya yaratilmadi yoki muddati tugagan. Qayta urinib ko‘ring.');
    }
    // Resolve the server-side shop membership before opening the app.
    // This is the authoritative role check: OWNER gets a shop, SELLER must
    // have a pending invitation for this exact phone number.
    let membership=null;
    try{
      const {data:{session}}=await getClient().auth.getSession();
      if(!session?.access_token) throw new Error('Sessiya yaratilmadi');
      let r=await fetch('/api/shop?action=bootstrap',{headers:{Authorization:'Bearer '+session.access_token},cache:'no-store'});
      let j=await r.json().catch(()=>({}));
      // One controlled retry with a fresh access token for old tabs/sessions.
      if(r.status===401){
        const refreshed=await getClient().auth.refreshSession({refresh_token:session.refresh_token});
        if(!refreshed.error&&refreshed.data?.session){
          session=refreshed.data.session;
          if(refreshed.data.user)user=refreshed.data.user;
          r=await fetch('/api/shop?action=bootstrap',{headers:{Authorization:'Bearer '+session.access_token},cache:'no-store'});
          j=await r.json().catch(()=>({}));
        }
      }
      if(!r.ok||!j.ok) throw new Error(j.error||'Do‘kon a’zoligi topilmadi');
      membership=j.data;
    }catch(e){
      console.error('QarzniUz shop access:',e);
      try{await getClient().auth.signOut()}catch(_){}
      const sellerMsg='Siz do‘kon egasi tomonidan sotuvchi etib belgilanmagansiz. Avval do‘kon egasi sizni telefon raqamingiz orqali sotuvchi sifatida qo‘shishi kerak.';
      status(registrationRole==='SELLER'?sellerMsg:(e?.message||'Do‘kon profilini yaratishda xatolik yuz berdi.'),false);
      return;
    }
    const serverRole=String(membership.member?.role||'').toUpperCase();
    const local={
      id:user.id,
      phone:storagePhone(user.phone),
      name:membership.member?.full_name||name,
      shopName:membership.shop?.name||shop,
      role:serverRole
    };
    localStorage.setItem('shop_user',JSON.stringify(local));
    try{localStorage.setItem('qarzniuz_user',JSON.stringify(local))}catch(_){}
    localStorage.setItem('qarzniuz_shop_role',serverRole);
    localStorage.setItem('qarzniuz_shop_role_phone',local.phone);
    sessionStorage.removeItem(OTP_STATE_KEY);
    try{if(typeof currentUser!=='undefined')currentUser=local}catch(_){}
    try{if(typeof initApp==='function')initApp(local)}catch(e){console.warn('initApp:',e)}
  }
  async function verifyOtp(){const s=readState(),code=String(document.getElementById('qarzniuz-otp-code')?.value||'').replace(/\D/g,'');if(!s||!/^[0-9]{6}$/.test(code))return status('6 xonali SMS kodni kiriting.',false);try{const{data,error}=await getClient().auth.verifyOtp({phone:s.phone,token:code,type:'sms'});if(error)throw error;if(!data?.session?.access_token)throw new Error('SMS tasdiqlandi, lekin sessiya yaratilmadi.');if(!data?.user)throw new Error('SMS tasdiqlandi, lekin foydalanuvchi sessiyasi yaratilmadi.');await getClient().auth.setSession({access_token:data.session.access_token,refresh_token:data.session.refresh_token});await setPin(data.user,data.session,s.mode==='register');}catch(e){console.error('QarzniUz OTP:',e);status(e?.message||'SMS kod noto‘g‘ri yoki muddati tugagan.',false)}}
  function installButtonGuard(){
    const btn=document.getElementById('auth-submit-btn');
    const form=document.getElementById('auth-form');
    if(!btn||!form)return;
    btn.type='button';
    btn.onclick=function(e){
      e.preventDefault();
      e.stopPropagation();
      if(busy)return;
      if(mode()==='login') loginWithPin();
      else sendRegistrationOtp();
    };
    form.onsubmit=function(e){
      e.preventDefault();
      e.stopPropagation();
      e.stopImmediatePropagation();
      if(busy)return;
      if(mode()==='login') loginWithPin();
      else sendRegistrationOtp();
      return false;
    };
    if(!form.dataset.qzCaptureGuard){
      form.addEventListener('submit',function(e){
        e.preventDefault();
        e.stopImmediatePropagation();
        if(busy)return;
        if(mode()==='login') loginWithPin();
        else sendRegistrationOtp();
      },true);
      form.dataset.qzCaptureGuard='1';
    }
  }
  function installSubmitGuard(){}
  function boot(){
    updateUI();
    installButtonGuard();
    document.getElementById('btn-mode-login')?.addEventListener('click',()=>setTimeout(()=>{updateUI();installButtonGuard();},0),true);
    document.getElementById('btn-mode-register')?.addEventListener('click',()=>setTimeout(()=>{updateUI();installButtonGuard();},0),true);
  }
  window.QarzniUzAuth={loginWithPin,startRecovery,sendRegistrationOtp,verifyOtp,updateUI,logout:async function(){sessionStorage.removeItem(OTP_STATE_KEY);try{await getClient().auth.signOut({scope:'local'});}catch(_){} }};
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',boot,{once:true});else boot();
})();