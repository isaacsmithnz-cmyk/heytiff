
// ════ DUCTR chrome layer — overrides presentation only; engine logic untouched ════
(function(){
  const _origRenderHome = renderHome;
  renderHome = function(){
    const grid=document.getElementById('home-jobs-grid');
    const loadList=document.getElementById('dh-load-list');
    if(!grid) return;
    const q=(document.getElementById('dh-search-input')?.value||'').trim().toLowerCase();
    const clearBtn=document.getElementById('dh-search-clear');
    if(clearBtn) clearBtn.style.display=q?'grid':'none';
    const keys=[]; LS.keys().forEach(k=>{ if(k&&k.startsWith('vrf_design_')) keys.push(k); });
    const parsed=keys.map(k=>{ try{return {key:k,data:JSON.parse(LS.get(k))};}catch(e){return null;} })
      .filter(Boolean)
      .sort((a,b)=>(new Date(b.data.savedAt||0))-(new Date(a.data.savedAt||0)));
    const info=({key,data:d})=>{
      const jd=d.jobDetails||{};
      const rooms=d.state?.rooms||[];
      const kw=rooms.reduce((s,r)=>s+(r.kw||0),0);
      return {key, name:jd.client||jd.address||'Untitled design', job:jd.jobnum||'Draft',
        rooms:rooms.length, kw:Math.round(kw*10)/10,
        thumb:d.state?.floors?.[0]?.imageData||null, auto:!!d.isAutosave,
        when:d.savedAt?new Date(d.savedAt).toLocaleDateString('en-AU',{day:'numeric',month:'short'}):''};
    };
    const all=parsed.map(info);
    const _lc=document.getElementById('dh-load-count'); if(_lc) _lc.textContent=all.length+(all.length===1?' design':' designs');
    // single Recent list: search-filtered when querying, else recent designs with content
    const list = q ? all.filter(d=>(d.name+' '+d.job).toLowerCase().includes(q))
                   : all.filter(d=>d.thumb||d.rooms>0).slice(0,8);
    document.getElementById('dh-recent-count')&&(document.getElementById('dh-recent-count').textContent=list.length);
    grid.innerHTML = list.length ? list.map(d=>`
      <div class="dh-rcard" onclick="loadDesign('${d.key}')">
        <div class="dh-rthumb">${d.thumb?`<img src="${d.thumb}">`:'<span class="dh-noplan">No plan</span>'}${d.auto?'<span class="dh-rbadge">Autosave</span>':''}
          <button class="dh-rdel" title="Delete design" onclick="event.stopPropagation();deleteDesign('${d.key}')">×</button></div>
        <div class="dh-rbody">
          <div class="dh-rnm">${d.name}</div>
          <div class="dh-rmeta">${d.rooms} rooms · ${d.kw} kW</div>
          <div class="dh-rwhen">#${d.job} · ${d.when}</div>
        </div>
      </div>`).join('')
      : `<div class="dh-rempty">
          <svg width="40" height="40" viewBox="0 0 48 48" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><rect x="8" y="10" width="32" height="28" rx="3"/><path d="M8 18h32M16 26h10"/></svg>
          <div class="dh-rempty-t">${q?'No matches':'No recent projects'}</div>
          <div class="dh-rempty-s">${q?('Nothing matches "'+q+'"'):'Designs you work on will show here'}</div>
        </div>`;
    // load list (filtered)
    if(loadList){
      const f=all.filter(d=>(d.name+' '+d.job).toLowerCase().includes(q));
      loadList.innerHTML = f.length ? f.map(d=>`
        <button class="dh-lrow" onclick="loadDesign('${d.key}')">
          <span class="dh-lb"><span class="dh-ln">${d.name}${d.auto?' <span class=dh-lcur>Autosave</span>':''}</span>
          <span class="dh-lm">#${d.job} · ${d.rooms} rooms · ${d.kw} kW</span></span>
          <span class="dh-lwhen">${d.when}</span>
        </button>`).join('')
        : '<div class="dh-none">'+(q?('No designs match “'+q+'”'):'Saved designs appear here.')+'</div>';
    }
  };


  // ── Topbar identity (redesign) ──
  const _origUpdateTopbar = updateTopbar;
  updateTopbar = function(){
    const jd = getJobDetails();
    const t=document.getElementById('tb-title');
    const s=document.getElementById('tb-sub-text');
    const j=document.getElementById('topbar-job');
    if(!t) return;
    const title = jd.client || (state.floors&&state.floors[0]&&state.floors[0].name&&jd.address ? state.floors[0].name+' — '+jd.address.split(',')[0] : '') || jd.address || 'Design Studio';
    t.textContent = title;
    s.textContent = jd.address && title!==jd.address ? jd.address : 'VRF design workspace';
    const jobnum = jd.jobnum || state.currentJobnum || '';
    if(j) j.textContent = jobnum ? ('Job #'+jobnum) : 'New design';
  };
  try{ updateTopbar(); }catch(e){}

  // ── Floating legend ──
  window.toggleLegendFloat = function(){
    const p=document.getElementById('legend-float');
    const on=p.style.display!=='none';
    p.style.display=on?'none':'flex';
    if(!on){ p.style.left=''; p.style.top=''; p.style.right='404px'; p.style.bottom='24px'; } // default spot every time
    document.getElementById('legend-fab')?.classList.toggle('on', !on);
    document.getElementById('legend-topbtn')?.classList.toggle('on', !on);
  };
  (function(){
    const p=document.getElementById('legend-float');
    const h=document.getElementById('legend-float-head');
    let drag=null;
    h.addEventListener('pointerdown',e=>{
      if(e.target.tagName==='BUTTON') return;
      const r=p.getBoundingClientRect();
      drag={dx:e.clientX-r.left, dy:e.clientY-r.top};
      h.setPointerCapture(e.pointerId);
    });
    h.addEventListener('pointermove',e=>{
      if(!drag) return;
      p.style.right='auto'; p.style.bottom='auto';
      p.style.left=Math.max(8,Math.min(window.innerWidth-p.offsetWidth-8, e.clientX-drag.dx))+'px';
      p.style.top=Math.max(8,Math.min(window.innerHeight-60, e.clientY-drag.dy))+'px';
    });
    h.addEventListener('pointerup',()=>{drag=null;});
  })();
  // ── Plans page (DUCTR layout) ──
  window.__pv2Active = 0;
  window.renderPlansDuctr = function(){
    const stage=document.getElementById('pv2-stage');
    const rail=document.getElementById('pv2-rail');
    const flow=document.getElementById('ductr-plans-flow');
    if(!stage) return;
    const floors=state.floors||[];
    const has=floors.length>0;
    stage.style.display=has?'flex':'none';
    if(rail) rail.style.display='none';
    flow.style.display=has?'none':'block';
    if(!has){
      const _pc=document.getElementById('pv2-page-count'); if(_pc) _pc.textContent='0';
      const _pl=document.getElementById('pv2-page-list'); if(_pl) _pl.innerHTML='<div class="dh-none">No pages yet — upload a plan or add a blank page.</div>';
      ['address','jobnum','client','designer'].forEach(k=>{
        const src=document.getElementById('jd-'+k), dst=document.getElementById('pd-'+k);
        if(src&&dst&&document.activeElement!==dst) dst.value=src.value||'';
      });
      const ro0=document.getElementById('pv2-scale-readout');
      if(ro0){ ro0.textContent = state.scale ? (Math.round(state.scale)+' px/m · set') : 'Not set'; ro0.classList.toggle('set', !!state.scale); }
      return;
    }
    if(__pv2Active>=floors.length) __pv2Active=floors.length-1;
    const f=floors[__pv2Active];
    const img=document.getElementById('pv2-img');
    const blank=document.getElementById('pv2-blank');
    if(f.imageData){ img.src=f.imageData; img.style.display='block'; blank.style.display='none'; }
    else { img.style.display='none'; blank.style.display='grid'; }
    // strip
    document.getElementById('pv2-strip').innerHTML=floors.map((fl,i)=>`
      <button class="pv2-sheet${i===__pv2Active?' on':''}" onclick="__pv2Active=${i};renderPlansDuctr()">
        <span class="th">${fl.imageData?`<img src="${fl.imageData}">`:'<span class=bk></span>'}</span>
        <span class="nm">${fl.name}</span>
      </button>`).join('');
    // pages card
    const _pc2=document.getElementById('pv2-page-count'); if(_pc2) _pc2.textContent=floors.length;
    const _pl2=document.getElementById('pv2-page-list'); if(_pl2) _pl2.innerHTML=floors.map((fl,i)=>`
      <div class="pv2-row${i===__pv2Active?' on':''}">
        <button class="pv2-main" onclick="__pv2Active=${i};renderPlansDuctr()">
          <span class="pv2-th">${fl.imageData?`<img src="${fl.imageData}">`:'<span class=bk></span>'}</span>
          <span class="pv2-txt"><span class="pv2-n"><input value="${(fl.name||'').replace(/"/g,'&quot;')}" onclick="event.stopPropagation()" oninput="state.floors[${i}].name=this.value;if(typeof renderFloorTabs==='function')try{renderFloorTabs()}catch(e){}"></span>
          <span class="pv2-sub">${i===__pv2Active?'Viewing now':'Sheet '+(i+1)}</span></span>
          ${i===__pv2Active?'<span class="pv2-dot"></span>':''}
        </button>
        ${floors.length>1?`<button class="pv2-x" title="Remove page" onclick="state.floors.splice(${i},1);if(state.activeFloor>=state.floors.length)state.activeFloor=state.floors.length-1;if(typeof renderFloorTabs==='function')try{renderFloorTabs()}catch(e){}renderPlansDuctr()">×</button>`:''}
      </div>`).join('');
    // project details mirror
    ['address','jobnum','client','designer'].forEach(k=>{
      const src=document.getElementById('jd-'+k), dst=document.getElementById('pd-'+k);
      if(src&&dst&&document.activeElement!==dst) dst.value=src.value||'';
    });
    // scale readout
    const ro=document.getElementById('pv2-scale-readout');
    if(ro){ ro.textContent = state.scale ? (Math.round(state.scale)+' px/m · set') : 'Not set'; ro.classList.toggle('set', !!state.scale); }
  };
  // hide Save / Export PDF / job label on Home
  const _origGoStep = goStep;
  let _prevStep = 0;
  goStep = function(n){
    // Directional transition hint for premium slide
    const main=document.getElementById('main');
    if(main) main.dataset.dir = (n<_prevStep) ? 'back' : 'fwd';
    _prevStep = n;
    _origGoStep(n); document.body.dataset.step=String(n);
    if(n===1){ try{ renderPlansDuctr(); }catch(e){}
      // skip the legacy mode-chooser: default to the upload path when no mode picked yet
      if(!state.mode && !(state.floors||[]).length){ try{ chooseModeUpload(); }catch(e){} }
    }
    if(n===0){ try{ collapseNew(); renderHome(); }catch(e){} }
    const fab=document.getElementById('legend-fab'); if(fab) fab.style.display = 'none';
    if(n!==2){ const lf=document.getElementById('legend-float'); if(lf) lf.style.display='none'; fab&&fab.classList.remove('on'); document.getElementById('legend-topbtn')?.classList.remove('on'); } };
  document.body.dataset.step='0';
  if(typeof renderHome==='function') try{ renderHome(); }catch(e){}
})();
