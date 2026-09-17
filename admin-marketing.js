(function(){
  const sourceToRaw = (label) => label === 'ChatGPT' ? 'chatgpt.com' : label === 'To‘g‘ridan-to‘g‘ri' ? 'direct' : label;
  const prettyDate = (v) => v ? new Date(v).toLocaleString('uz-UZ') : '—';
  const sourceUsers = (raw) => (DATA.app_users || []).filter(u => (u.source || 'direct') === raw);
  const campaignUsers = (raw) => (DATA.app_users || []).filter(u => (u.campaign || '') === raw);
  const premiumFor = rows => rows.filter(u => eventsForUser(u).some(e => e.event_name === 'premium_activated')).length;
  const trialFor = rows => rows.filter(u => eventsForUser(u).some(e => e.event_name === 'premium_trial_started')).length;
  const activeFor = rows => rows.filter(u => { const v=u.last_seen_at||u.updated_at||u.created_at; return v && Date.now()-new Date(v).getTime() <= 7*86400000; }).length;
  const eventUser = (e) => (DATA.app_users || []).find(u => (e.user_id && String(userIdOf(u)) === String(e.user_id)) || (e.phone && u.phone && String(u.phone) === String(e.phone))) || null;
  const userLine = (u) => u ? `<b>${esc(u.name||'Foydalanuvchi')}</b><br><span class="muted small">${esc(u.phone||'—')} · ${esc(u.shop_name||u.shopName||'—')}</span>` : '<span class="muted">Foydalanuvchi topilmadi</span>';

  function injectStyle(){
    if(document.getElementById('marketingDetailStyle')) return;
    const s=document.createElement('style'); s.id='marketingDetailStyle';
    s.textContent='.marketingClickable{cursor:pointer;border-radius:10px;padding:3px 6px;margin:-3px -6px}.marketingClickable:hover{background:#f3f6ff}.marketingHint{font-size:11px;color:#7b8494;margin-top:4px}.marketingStats{display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin:14px 0}.marketingStat{background:#f7f9fc;border-radius:10px;padding:12px}.marketingStat span{display:block;color:#697386;font-size:12px}.marketingStat b{display:block;margin-top:5px;font-size:18px}.adminEventUser{cursor:pointer;border-radius:10px;padding:8px 6px}.adminEventUser:hover{background:#f3f6ff}@media(max-width:600px){.marketingStats{grid-template-columns:repeat(2,1fr)}}';
    document.head.appendChild(s);
  }

  function showMarketing(type, label){
    const raw=sourceToRaw(label);
    const rows=type==='source' ? sourceUsers(raw) : campaignUsers(raw);
    const total=DATA.app_users||[];
    const title=type==='source' ? 'Marketing manbasi: '+label : 'Reklama kampaniyasi: '+label;
    const share=total.length ? ((rows.length/total.length)*100).toFixed(1) : '0.0';
    const todayRows=rows.filter(u=>dayKey(u.created_at||u.registered_at)===today).length;
    const usersHtml=rows.slice().sort((a,b)=>new Date(dateValue(b)||0)-new Date(dateValue(a)||0)).map(u=>`<div class="row adminEventUser" onclick="showUserByRef('${esc(userIdOf(u))}')"><span>${userLine(u)}</span>${statusPill(statusOf(u))}</div>`).join('');
    document.getElementById('modalTitle').textContent=title;
    document.getElementById('modalSub').textContent='Marketing manbasi bo‘yicha batafsil statistika';
    document.getElementById('modalBody').innerHTML=`<div class="marketingStats"><div class="marketingStat"><span>Foydalanuvchilar</span><b>${rows.length}</b></div><div class="marketingStat"><span>Ulushi</span><b>${share}%</b></div><div class="marketingStat"><span>Bugun</span><b>${todayRows}</b></div><div class="marketingStat"><span>Faol</span><b>${activeFor(rows)}</b></div><div class="marketingStat"><span>Premium</span><b>${premiumFor(rows)}</b></div><div class="marketingStat"><span>Sinov Premium</span><b>${trialFor(rows)}</b></div></div><h3>Foydalanuvchilar</h3><div class="list">${usersHtml||'<div class="empty">Bu manbadan hali foydalanuvchi yo‘q.</div>'}</div>`;
    openModal();
  }

  window.showUserByRef=function(id){
    const u=(DATA.app_users||[]).find(x=>String(userIdOf(x))===String(id));
    if(!u)return;
    const es=eventsForUser(u);
    document.getElementById('modalTitle').textContent=u.name||'Foydalanuvchi';
    document.getElementById('modalSub').textContent=u.phone||'Telefon ko‘rsatilmagan';
    document.getElementById('modalBody').innerHTML=`<div class="detailGrid"><div class="detail">Holati<b>${statusPill(statusOf(u))}</b></div><div class="detail">Do‘kon<b>${esc(u.shop_name||u.shopName||'—')}</b></div><div class="detail">Manba<b>${esc(sourceLabel(u.source))}</b></div><div class="detail">Kampaniya<b>${esc(campaignLabel(u.campaign))}</b></div><div class="detail">Ro‘yxatdan o‘tgan<b>${esc(prettyDate(dateValue(u)))}</b></div><div class="detail">Harakatlar soni<b>${es.length}</b></div></div><h3>Foydalanuvchi harakatlari</h3><div class="list">${es.length?es.slice().sort((a,b)=>new Date(b.created_at||0)-new Date(a.created_at||0)).map(e=>`<div class="row"><span>${esc(eventLabel(e.event_name))}</span><b>${esc(prettyDate(e.created_at))}</b></div>`).join(''):'<div class="empty">Hozircha harakatlar topilmadi.</div>'}</div>`;
    openModal();
  };

  function eventRows(title,eventName,mode){
    const rows=ev(eventName).slice().sort((a,b)=>new Date(b.created_at||0)-new Date(a.created_at||0));
    document.getElementById('modalTitle').textContent=title;
    document.getElementById('modalSub').textContent='Jami: '+rows.length;
    document.getElementById('modalBody').innerHTML=`<div class="list">${rows.length?rows.map(e=>{const u=eventUser(e);const label=mode==='revenue'?money(Number(e.metadata?.price_uzs||25000)):prettyDate(e.created_at);return `<div class="row adminEventUser" ${u?`onclick="showUserByRef('${esc(userIdOf(u))}')"`:''}><span>${userLine(u)}</span><b>${esc(label)}</b></div>`}).join(''):'<div class="empty">Ma’lumot topilmadi.</div>'}</div>`;
    openModal();
  }

  function eventUserRows(title,eventName){ eventRows(title,eventName,''); }

  function enhanceKpis(){
    if(typeof window.showKpi!=='function' || window.__tdKpiEnhanced) return;
    const original=window.showKpi;
    window.showKpi=function(t){
      if(t==='premium') return eventUserRows('Premium faollashtirishlar','premium_activated');
      if(t==='trial') return eventUserRows('Sinov Premium boshlaganlar','premium_trial_started');
      if(t==='revenue') return eventRows('Premium tushumi','premium_activated','revenue');
      if(t==='customers') return eventUserRows('Mijoz qo‘shgan foydalanuvchilar','customer_added');
      if(t==='debts') return eventUserRows('Qarz kiritgan foydalanuvchilar','debt_added');
      return original(t);
    };
    window.__tdKpiEnhanced=true;
  }

  function enhanceMarketing(){
    injectStyle();
    enhanceKpis();
    const sourceBox=document.getElementById('sources');
    if(sourceBox){
      [...sourceBox.querySelectorAll('.row')].forEach(row=>{
        const span=row.querySelector('span'); if(!span)return;
        const label=span.textContent.trim(); row.classList.add('marketingClickable'); row.title='Batafsil ko‘rish'; row.onclick=()=>showMarketing('source',label);
      });
      if(sourceBox.children.length && !sourceBox.querySelector('.marketingHint')) sourceBox.insertAdjacentHTML('beforeend','<div class="marketingHint">Manbani bosib, foydalanuvchilar va konversiya tafsilotlarini ko‘ring.</div>');
    }
    const campaignBox=document.getElementById('campaigns');
    if(campaignBox){
      [...campaignBox.querySelectorAll('.row')].forEach(row=>{
        const span=row.querySelector('span'); if(!span)return;
        const label=span.textContent.trim(); row.classList.add('marketingClickable'); row.title='Batafsil ko‘rish'; row.onclick=()=>showMarketing('campaign',label);
      });
      if(campaignBox.children.length && !campaignBox.querySelector('.marketingHint')) campaignBox.insertAdjacentHTML('beforeend','<div class="marketingHint">Kampaniyani bosib, natijalarni ko‘ring.</div>');
    }
  }

  const originalRender=window.render;
  if(typeof originalRender==='function'){
    window.render=function(){ originalRender(); enhanceMarketing(); };
    setTimeout(enhanceMarketing,0);
  } else {
    setTimeout(enhanceMarketing,100);
  }
})();
