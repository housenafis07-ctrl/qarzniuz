(function(){
  'use strict';

  function getData(){
    try { return typeof DATA !== 'undefined' ? DATA : null; } catch(e) { return null; }
  }

  function boot(){
    const data=getData();
    if(window.__tdAdminEnhancementsBooted || !data || !document.getElementById('sources')) return false;
    window.__tdAdminEnhancementsBooted=true;

    const sourceToRaw=(label)=>label==='ChatGPT'?'chatgpt.com':label==='To‘g‘ridan-to‘g‘ri'?'direct':label;
    const prettyDate=(v)=>v?new Date(v).toLocaleString('uz-UZ'):'—';
    const sourceUsers=(raw)=>(DATA.app_users||[]).filter(u=>(u.source||'direct')===raw);
    const campaignUsers=(raw)=>(DATA.app_users||[]).filter(u=>(u.campaign||'')===raw);
    const eventUser=(e)=>(DATA.app_users||[]).find(u=>(e.user_id&&String(userIdOf(u))===String(e.user_id))||(e.phone&&u.phone&&String(u.phone)===String(e.phone)))||null;
    const userLine=(u)=>u?`<b>${esc(u.name||'Foydalanuvchi')}</b><br><span class="muted small">${esc(u.phone||'—')} · ${esc(u.shop_name||u.shopName||'—')}</span>`:'<span class="muted">Foydalanuvchi topilmadi</span>';

    function premiumEventFor(u){
      return eventsForUser(u).filter(e=>e.event_name==='premium_activated').sort((a,b)=>new Date(b.created_at||0)-new Date(a.created_at||0))[0]||null;
    }
    function premiumState(u){
      const e=premiumEventFor(u);
      if(!e)return 'none';
      const started=new Date(e.created_at||0).getTime();
      if(!started)return 'expired';
      return Date.now()<started+30*86400000?'premium':'expired';
    }
    function adminStatus(u){
      const p=premiumState(u);
      if(p==='premium')return 'Premium';
      if(p==='expired')return 'Premium tugagan';
      return 'Faol';
    }
    function statusPill3(s){return `<span class="pill">${esc(s)}</span>`;}

    // Replace the old 4-state status function with exactly 3 states.
    window.statusOf=adminStatus;
    window.statusPill=statusPill3;

    const style=document.createElement('style');
    style.textContent='.marketingClickable{cursor:pointer;border-radius:10px;padding:3px 6px;margin:-3px -6px}.marketingClickable:hover{background:#f3f6ff}.marketingHint{font-size:11px;color:#7b8494;margin-top:5px}.marketingStats{display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin:14px 0}.marketingStat{background:#f7f9fc;border-radius:10px;padding:12px}.marketingStat span{display:block;color:#697386;font-size:12px}.marketingStat b{display:block;margin-top:5px;font-size:18px}.adminEventUser{cursor:pointer;border-radius:10px;padding:8px 6px}.adminEventUser:hover{background:#f3f6ff}.statusFilter{cursor:pointer;user-select:none}.statusFilter:hover{color:#2563eb;text-decoration:underline}.statusFilterHint{font-size:11px;color:#7b8494;margin-left:5px;font-weight:400}@media(max-width:600px){.marketingStats{grid-template-columns:repeat(2,1fr)}}';
    document.head.appendChild(style);

    let statusFilter=-1; // -1 Barchasi, 0 Faol, 1 Premium, 2 Premium tugagan
    const filterLabels=['Barchasi','Faol','Premium','Premium tugagan'];

    function filteredUsers(rows){
      if(statusFilter===-1)return rows;
      const wanted=filterLabels[statusFilter+1];
      return rows.filter(u=>adminStatus(u)===wanted);
    }

    function applyUserTable(){
      const table=document.getElementById('userTable');
      if(!table)return;
      const all=[...(DATA.app_users||[])].sort((a,b)=>new Date(dateValue(b)||0)-new Date(dateValue(a)||0);
      const rows=filteredUsers(all).slice(0,1000);
      currentRows=rows;
      table.innerHTML=rows.map((x,i)=>`<tr class="userRow" onclick="showUser(${i})"><td>${esc(x.phone||'—')}</td><td>${esc(x.name||'—')}</td><td>${esc(x.shop_name||x.shopName||'—')}</td><td><span class="pill">${esc(sourceLabel(x.source))}</span></td><td>${statusPill3(adminStatus(x))}</td><td>${esc(dateValue(x)?new Date(dateValue(x)).toLocaleString('uz-UZ'):'—')}</td></tr>`).join('');
    }

    function installStatusFilter(){
      const th=[...document.querySelectorAll('#userTable')].length?document.querySelector('#userTable')?.closest('table')?.querySelectorAll('th'):[];
      if(!th||th.length<5)return false;
      const statusTh=th[4];
      if(statusTh.dataset.tdFilter==='1')return true;
      statusTh.dataset.tdFilter='1';
      statusTh.classList.add('statusFilter');
      statusTh.title='Bosib filtrni almashtiring';
      statusTh.innerHTML='Holati <span class="statusFilterHint">(Barchasi)</span>';
      statusTh.onclick=()=>{
        statusFilter=statusFilter>=2?-1:statusFilter+1;
        statusTh.querySelector('.statusFilterHint').textContent='('+filterLabels[statusFilter+1]+')';
        applyUserTable();
      };
      return true;
    }

    const originalRender=window.render;
    if(typeof originalRender==='function' && !window.__tdRenderWrapped){
      window.__tdRenderWrapped=true;
      window.render=function(){
        originalRender.apply(this,arguments);
        installStatusFilter();
        applyUserTable();
        enhance();
      };
    }

    function showAllUsers(){
      const all=[...(DATA.app_users||[])].sort((a,b)=>new Date(dateValue(b)||0)-new Date(dateValue(a)||0).getTime());
      const rows=all.slice(0,1000);
      let page=0;
      const pageSize=100;
      const renderPage=()=>{
        const start=page*pageSize;
        const pageRows=rows.slice(start,start+pageSize);
        document.getElementById('modalTitle').textContent='Barcha foydalanuvchilar';
        document.getElementById('modalSub').textContent=`Jami: ${all.length}${all.length>1000?' · ko‘rsatish limiti: 1000':''}`;
        document.getElementById('modalBody').innerHTML=`<div class="small muted" style="margin-bottom:10px">Ko‘rsatilmoqda: ${rows.length?start+1:0}–${Math.min(start+pageSize,rows.length)} / ${rows.length}</div><div class="list">${pageRows.length?pageRows.map(u=>`<div class="row adminEventUser" onclick="window.__tdShowUser('${esc(userIdOf(u))}')"><span>${userLine(u)}</span>${statusPill3(adminStatus(u))}</div>`).join(''):'<div class="empty">Ma’lumot topilmadi.</div>'}</div><div style="display:flex;justify-content:space-between;gap:8px;margin-top:12px"><button class="secondary" id="tdPrev" ${page===0?'disabled':''}>← Oldingi</button><span class="small muted" style="align-self:center">Sahifa ${rows.length?Math.floor(start/pageSize)+1:0} / ${Math.max(1,Math.ceil(rows.length/pageSize))}</span><button class="secondary" id="tdNext" ${start+pageSize>=rows.length?'disabled':''}>Keyingi →</button></div>`;
        document.getElementById('tdPrev')?.addEventListener('click',()=>{if(page>0){page--;renderPage();}});
        document.getElementById('tdNext')?.addEventListener('click',()=>{if(start+pageSize<rows.length){page++;renderPage();}});
        openModal();
      };
      renderPage();
    }

    function showMarketing(type,label){
      const raw=sourceToRaw(label);
      const rows=type==='source'?sourceUsers(raw):campaignUsers(raw);
      const total=DATA.app_users||[];
      const share=total.length?((rows.length/total.length)*100).toFixed(1):'0.0';
      const todayRows=rows.filter(u=>dayKey(u.created_at||u.registered_at)===today).length;
      const activeRows=rows.filter(u=>adminStatus(u)==='Faol').length;
      const premiumRows=rows.filter(u=>adminStatus(u)==='Premium').length;
      const usersHtml=rows.slice().sort((a,b)=>new Date(dateValue(b)||0)-new Date(dateValue(a)||0)).slice(0,1000).map(u=>`<div class="row adminEventUser" onclick="window.__tdShowUser('${esc(userIdOf(u))}')"><span>${userLine(u)}</span>${statusPill3(adminStatus(u))}</div>`).join('');
      document.getElementById('modalTitle').textContent=type==='source'?'Marketing manbasi: '+label:'Reklama kampaniyasi: '+label;
      document.getElementById('modalSub').textContent='Marketing manbasi bo‘yicha batafsil statistika';
      document.getElementById('modalBody').innerHTML=`<div class="marketingStats"><div class="marketingStat"><span>Foydalanuvchilar</span><b>${rows.length}</b></div><div class="marketingStat"><span>Ulushi</span><b>${share}%</b></div><div class="marketingStat"><span>Bugun</span><b>${todayRows}</b></div><div class="marketingStat"><span>Faol</span><b>${activeRows}</b></div><div class="marketingStat"><span>Premium</span><b>${premiumRows}</b></div><div class="marketingStat"><span>Premium tugagan</span><b>${rows.filter(u=>adminStatus(u)==='Premium tugagan').length}</b></div></div><h3>Foydalanuvchilar</h3><div class="list">${usersHtml||'<div class="empty">Bu manbadan hali foydalanuvchi yo‘q.</div>'}</div>`;
      openModal();
    }

    window.__tdShowUser=function(id){
      const u=(DATA.app_users||[]).find(x=>String(userIdOf(x))===String(id));
      if(!u)return;
      const es=eventsForUser(u);
      document.getElementById('modalTitle').textContent=u.name||'Foydalanuvchi';
      document.getElementById('modalSub').textContent=u.phone||'Telefon ko‘rsatilmagan';
      document.getElementById('modalBody').innerHTML=`<div class="detailGrid"><div class="detail">Holati<b>${statusPill3(adminStatus(u))}</b></div><div class="detail">Do‘kon<b>${esc(u.shop_name||u.shopName||'—')}</b></div><div class="detail">Manba<b>${esc(sourceLabel(u.source))}</b></div><div class="detail">Kampaniya<b>${esc(campaignLabel(u.campaign))}</b></div><div class="detail">Ro‘yxatdan o‘tgan<b>${esc(prettyDate(dateValue(u)))}</b></div><div class="detail">Harakatlar soni<b>${es.length}</b></div></div><h3>Foydalanuvchi harakatlari</h3><div class="list">${es.length?es.slice().sort((a,b)=>new Date(b.created_at||0)-new Date(a.created_at||0)).map(e=>`<div class="row"><span>${esc(eventLabel(e.event_name))}</span><b>${esc(prettyDate(e.created_at))}</b></div>`).join(''):'<div class="empty">Hozircha harakatlar topilmadi.</div>'}</div>`;
      openModal();
    };

    function eventRows(title,eventName,mode){
      const rows=ev(eventName).slice().sort((a,b)=>new Date(b.created_at||0)-new Date(a.created_at||0));
      document.getElementById('modalTitle').textContent=title;
      document.getElementById('modalSub').textContent='Jami: '+rows.length;
      document.getElementById('modalBody').innerHTML=`<div class="list">${rows.length?rows.map(e=>{const u=eventUser(e);const label=mode==='revenue'?money(Number(e.metadata?.price_uzs||25000)):prettyDate(e.created_at);return `<div class="row adminEventUser" ${u?`onclick="window.__tdShowUser('${esc(userIdOf(u))}')"`:''}><span>${userLine(u)}</span><b>${esc(label)}</b></div>`}).join(''):'<div class="empty">Ma’lumot topilmadi.</div>'}</div>`;
      openModal();
    }

    const originalShowKpi=window.showKpi;
    if(typeof originalShowKpi==='function'){
      window.showKpi=function(t){
        if(t==='users')return showAllUsers();
        if(t==='premium')return eventRows('Premium faollashtirishlar','premium_activated','');
        if(t==='trial')return eventRows('Sinov Premium boshlaganlar','premium_trial_started','');
        if(t==='revenue')return eventRows('Premium tushumi','premium_activated','revenue');
        if(t==='customers')return eventRows('Mijoz qo‘shgan foydalanuvchilar','customer_added','');
        if(t==='debts')return eventRows('Qarz kiritgan foydalanuvchilar','debt_added','');
        return originalShowKpi(t);
      };
    }

    function enhance(){
      installStatusFilter();
      ['sources','campaigns'].forEach(id=>{
        const box=document.getElementById(id); if(!box)return;
        box.querySelectorAll('.row').forEach(row=>{
          if(row.dataset.tdMarketing==='1')return;
          const span=row.querySelector('span'); if(!span)return;
          const label=span.textContent.trim();
          row.dataset.tdMarketing='1'; row.classList.add('marketingClickable'); row.title='Batafsil ko‘rish';
          row.onclick=()=>showMarketing(id==='sources'?'source':'campaign',label);
        });
        if(box.querySelector('.row')&&!box.querySelector('.marketingHint'))box.insertAdjacentHTML('beforeend','<div class="marketingHint">Qatorni bosing — batafsil ko‘rish.</div>');
      });
    }

    enhance();
    setTimeout(()=>{installStatusFilter();applyUserTable();},50);
    const observer=new MutationObserver(enhance);
    ['sources','campaigns','userTable'].forEach(id=>{const el=document.getElementById(id);if(el)observer.observe(el,{childList:true,subtree:true});});
    return true;
  }

  let tries=0;
  const timer=setInterval(()=>{tries++;if(boot()||tries>=120)clearInterval(timer)},100);
  if(document.readyState!=='loading')boot();
})();
