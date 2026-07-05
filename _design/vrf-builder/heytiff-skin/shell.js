/* ===== HeyTiff · Design Studio — shell glue =====
   Boots the .fg shell (sidebar / topbar / command palette), routes nav between
   the rendered screens (outlet pages) and the live Design Studio app (#dstudio),
   which stays mounted so work-in-progress survives navigation. */
(function () {
  const I = window.FGI,
        side = document.getElementById('fg-side'),
        top = document.getElementById('fg-top'),
        page = document.getElementById('fg-page'),
        outlet = document.getElementById('fg-outlet'),
        dst = document.getElementById('dstudio');

  // comment-context labels for the studio steps
  const SLBL = { 0:'Studio · Home', 1:'Studio · Plans', 2:'Studio · Design canvas', 3:'Studio · Materials', 4:'Studio · Job details' };
  Object.keys(SLBL).forEach(n => { const p = document.getElementById('panel-' + n); if (p) p.setAttribute('data-screen-label', SLBL[n]); });
  dst.setAttribute('data-screen-label', 'Design Studio');

  function runAnims() {
    page.querySelectorAll('.odu .bar i').forEach(b => { requestAnimationFrame(() => { b.style.width = (b.dataset.w || 0) + '%'; }); });
    profileEmpties();
  }
  function profileEmpties() {
    const prof = page.querySelector('.prof'); if (!prof) return;
    prof.querySelectorAll('.card2 > .c2h').forEach(h => {
      if (h.querySelector('.cardactions')) return;
      const w = document.createElement('span');
      w.className = 'cardactions';
      w.innerHTML = '<button class="cardedit" data-edit>' + I('edit', 14) + 'Edit</button>' +
        '<button class="cardbtn ghost" data-cancel>Cancel</button>' +
        '<button class="cardbtn save" data-save>' + I('check', 14) + 'Save</button>';
      h.appendChild(w);
    });
    prof.querySelectorAll('input.inp, textarea.inp, select.inp').forEach(el => {
      el.classList.toggle('is-empty', !el.value);
    });
    renderProfileCompletion();
  }

  // ---- PROFILE COMPLETION ----
  const PCOMP_SECTIONS = [['personal'],['emergency'],['licences'],['workrights'],['vehicle'],['training'],['payroll'],['permissions']];
  const PCOMP = { personal:true, emergency:true, licences:true, workrights:true, vehicle:false, training:false, payroll:true, permissions:true };
  function renderProfileCompletion() {
    const prof = page.querySelector('.prof'); if (!prof) return;
    ['vehicle','training'].forEach(id => { const sec = prof.querySelector('.psec[data-sec="'+id+'"]'); if (sec) sec.classList.toggle('na-marked', !!PCOMP[id]); });
    const total = PCOMP_SECTIONS.length;
    const done = PCOMP_SECTIONS.filter(s => PCOMP[s[0]]).length;
    const pct = Math.round(done / total * 100);
    const box = prof.querySelector('#pcomp');
    if (box) {
      const left = total - done;
      const pctEl = box.querySelector('.pcpct');
      if (left === 0) { pctEl.innerHTML = I('check', 20); }
      else { pctEl.textContent = pct + '%'; }
      const fg = box.querySelector('.pcfg'); if (fg) fg.setAttribute('stroke-dasharray', pct + ' ' + (100 - pct));
      box.querySelector('.pchint').textContent = left ? (left + ' section' + (left>1?'s':'') + ' to finish') : 'Profile complete';
      box.querySelector('.pctx b').textContent = left ? 'Complete' : 'All set';
      box.classList.toggle('done', left === 0);
      if (left) { prof.classList.remove('pc-review'); box.classList.remove('reviewing'); }
    }
    prof.querySelectorAll('.pnav .pn[data-psec]').forEach(btn => {
      const id = btn.dataset.psec; const st = btn.querySelector('.pnst'); if (!st) return;
      if (!(id in PCOMP)) { st.style.display = 'none'; return; }
      st.style.display = ''; st.classList.toggle('done', !!PCOMP[id]);
    });
  }

  let current = '', currentScreen = '', dirFilter = 'active';
  // TEAM directory: filter / sort
  function applyDir() {
    const panel = document.getElementById('dir-panel'); if (!panel) return;
    const q = (panel.querySelector('.dsearchin') ? panel.querySelector('.dsearchin').value : '').trim().toLowerCase();
    const f = dirFilter;
    const sort = panel.querySelector('.dsort') ? panel.querySelector('.dsort').value : 'name';
    const list = panel.querySelector('.dirrows'); const rows = [...list.querySelectorAll('.dirrow')];
    let vis = 0;
    rows.forEach(r => {
      const mq = !q || r.dataset.name.includes(q) || r.dataset.role.includes(q);
      let mf = true;
      if (f === 'warn') mf = (r.dataset.comp === 'warn' || r.dataset.comp === 'bad');
      else if (f !== 'all') mf = (r.dataset.status === f);
      const show = mq && mf; r.style.display = show ? '' : 'none'; if (show) vis++;
    });
    rows.sort((a, b) => {
      if (sort === 'name') return a.dataset.name.localeCompare(b.dataset.name);
      if (sort === 'role') return a.dataset.role.localeCompare(b.dataset.role);
      if (sort === 'exp') return (+a.dataset.exp) - (+b.dataset.exp);
      return 0;
    });
    rows.forEach(r => list.appendChild(r));
    panel.querySelector('.direm').style.display = vis ? 'none' : '';
  }
  // TEAM directory: sliding tab switcher
  function setDirView(view) {
    const tabs = document.getElementById('dir-tabs');
    const panel = document.getElementById('dir-panel');
    const pend = document.getElementById('dir-pending');
    const banner = document.getElementById('arch-banner');
    if (!tabs) return;
    const isArch = view === 'archived';
    if (!isArch) {
      const idx = view === 'active' ? 0 : view === 'warn' ? 1 : 2;
      tabs.style.setProperty('--idx', idx);
      tabs.setAttribute('data-view', view);
      const slide = tabs.querySelector('.dirtab-slide');
      if (slide) { const colW = slide.getBoundingClientRect().width; slide.style.left = (6 + idx * colW) + 'px'; }
      tabs.querySelectorAll('.dirtab').forEach(t => t.classList.toggle('on', t.dataset.dquick === view));
    } else {
      tabs.querySelectorAll('.dirtab').forEach(t => t.classList.remove('on'));
    }
    if (banner) banner.style.display = isArch ? '' : 'none';
    if (view === 'pending') {
      if (panel) panel.style.display = 'none';
      if (pend) pend.style.display = '';
    } else {
      if (pend) pend.style.display = 'none';
      if (panel) panel.style.display = '';
      dirFilter = view === 'warn' ? 'warn' : isArch ? 'inactive' : 'active';
      applyDir();
    }
  }

  function render(key, activeKey) {
    // ── Design Studio: a live app, not a rendered page — toggle, don't rebuild ──
    if (key === 'ductr') {
      current = 'ductr'; currentScreen = 'ductr';
      side.innerHTML = window.FG3_SIDEBAR('ductr');
      if (!top.innerHTML) top.innerHTML = window.FG3_TOPBAR();
      document.getElementById('fg-topbar').classList.remove('hide');
      outlet.style.display = 'none';
      dst.classList.add('on');
      return;
    }
    if (dst.classList.contains('on')) { dst.classList.remove('on'); outlet.style.display = ''; }

    const fn = window.FG3_SCREENS[key] || window.FG3_SCREENS.home;
    const active = activeKey || key;
    const swap = () => {
      current = active; currentScreen = key;
      side.innerHTML = window.FG3_SIDEBAR(active);
      if (!top.innerHTML) top.innerHTML = window.FG3_TOPBAR();
      document.getElementById('fg-topbar').classList.remove('hide');
      page.classList.remove('out');
      page.innerHTML = fn();
      if (key === 'people') { dirFilter = 'active'; applyDir(); }
      page.classList.remove('in'); void page.offsetWidth; page.classList.add('in');
      page.scrollTop = 0;
      if (outlet) outlet.scrollTop = 0;
      runAnims();
      clearTimeout(page._t); page._t = setTimeout(() => page.classList.remove('in'), 700);
    };
    if (currentScreen && currentScreen !== key && currentScreen !== 'ductr') { page.classList.add('out'); setTimeout(swap, 170); } else swap();
  }

  document.querySelector('.fg').addEventListener('click', (e) => {
    if (e.target.closest('#dstudio')) {
      // studio has its own handlers; only global nav below applies
    }
    if (!e.target.closest('.dmorewrap')) document.querySelectorAll('.fg .dmenu.open').forEach(x => x.classList.remove('open'));
    if (!e.target.closest('.dsetwrap')) { document.querySelectorAll('.fg .dsetmenu.open').forEach(x => x.classList.remove('open')); document.querySelectorAll('.fg .dset.open').forEach(x => x.classList.remove('open')); }
    const nav = e.target.closest('[data-nav]');
    if (nav) { if (nav.dataset.nav !== currentScreen) render(nav.dataset.nav); return; }
    if (e.target.closest('[data-cmd]')) openCmd();
    const dmore = e.target.closest('[data-dmore]');
    if (dmore) { const m = dmore.parentElement.querySelector('.dmenu'); const open = m.classList.contains('open'); document.querySelectorAll('.fg .dmenu.open').forEach(x => x.classList.remove('open')); if (!open) m.classList.add('open'); return; }
    const deact = e.target.closest('[data-deactivate]');
    if (deact) { const row = deact.closest('.dirrow'); row.dataset.status = 'inactive'; row.classList.add('off'); if (!row.querySelector('.dofftag')) row.querySelector('.dname').insertAdjacentHTML('beforeend', '<span class="dofftag">Inactive</span>'); applyDir(); return; }
    const react = e.target.closest('[data-reactivate]');
    if (react) { const row = react.closest('.dirrow'); row.dataset.status = 'active'; row.classList.remove('off'); const t = row.querySelector('.dofftag'); if (t) t.remove(); applyDir(); return; }
    const dmenuBtn = e.target.closest('.dmenu button');
    if (dmenuBtn && !dmenuBtn.hasAttribute('data-staff')) { document.querySelectorAll('.fg .dmenu.open').forEach(x => x.classList.remove('open')); return; }
    const dq = e.target.closest('[data-dquick]'); if (dq) { setDirView(dq.dataset.dquick); return; }
    const dset = e.target.closest('[data-dset]');
    if (dset) { const m = dset.parentElement.querySelector('.dsetmenu'); const open = m.classList.contains('open'); m.classList.toggle('open', !open); dset.classList.toggle('open', !open); return; }
    const dview = e.target.closest('[data-dview]');
    if (dview) { document.querySelectorAll('.fg .dsetmenu.open').forEach(x => x.classList.remove('open')); document.querySelectorAll('.fg .dset.open').forEach(x => x.classList.remove('open')); setDirView(dview.dataset.dview); return; }
    const staff = e.target.closest('[data-staff]'); if (staff) { render('staff', 'people'); return; }
    const tab = e.target.closest('.dtab'); if (tab) { tab.parentElement.querySelectorAll('.dtab').forEach(t => t.classList.remove('on')); tab.classList.add('on'); }
    const ptab = e.target.closest('.ptab'); if (ptab) { const i = ptab.dataset.ptab; ptab.parentElement.querySelectorAll('.ptab').forEach(t => t.classList.remove('on')); ptab.classList.add('on'); page.querySelectorAll('.ptabpanel').forEach(p => p.classList.toggle('on', p.dataset.ppanel === i)); }
    const pcj = e.target.closest('#pcomp');
    if (pcj) {
      const prof = page.querySelector('.prof');
      const on = prof.classList.toggle('pc-review');
      pcj.classList.toggle('reviewing', on);
      if (on) { const first = PCOMP_SECTIONS.find(s => !PCOMP[s[0]]); if (first) { const b = page.querySelector('.pnav .pn[data-psec="'+first[0]+'"]'); if (b) b.click(); } }
      return;
    }
    const cna = e.target.closest('[data-complete-na]');
    if (cna) { PCOMP[cna.dataset.completeNa] = true; renderProfileCompletion(); return; }
    const cundo = e.target.closest('[data-complete-undo]');
    if (cundo) { PCOMP[cundo.dataset.completeUndo] = false; renderProfileCompletion(); return; }
    const psec = e.target.closest('[data-psec]');
    if (psec) { const k = psec.dataset.psec; page.querySelectorAll('.pnav .pn').forEach(t => t.classList.toggle('on', t === psec)); page.querySelectorAll('.psec').forEach(s => s.classList.toggle('on', s.dataset.sec === k)); outlet.scrollTop = 0; profileEmpties(); }
    const ptog = e.target.closest('[data-toggle]'); if (ptog) ptog.classList.toggle('on');
    const ns = e.target.closest('[data-notsure]'); if (ns) { const on = ns.classList.toggle('on'); const inp = ns.parentElement.querySelector('.inp'); if (inp) { if (on) { inp.value = ''; inp.placeholder = 'Not sure / not checked'; inp.disabled = true; } else { inp.placeholder = 'dd / mm / yyyy'; inp.disabled = false; } } return; }
    const pseg = e.target.closest('.fg .page .seg button'); if (pseg) { pseg.parentElement.querySelectorAll('button').forEach(b => b.classList.remove('on','green')); pseg.classList.add('on'); if (pseg.textContent.trim()==='Active') pseg.classList.add('green'); }
    const prole = e.target.closest('.permrole');
    if (prole) { prole.parentElement.querySelectorAll('.permrole').forEach(p => p.classList.remove('on')); prole.classList.add('on'); const rb = prole.querySelector('input'); if (rb) rb.checked = true; }
    const ped = e.target.closest('[data-edit]'); if (ped) { ped.closest('.card2').classList.remove('readonly'); profileEmpties(); return; }
    const pca = e.target.closest('[data-cancel]'); if (pca) { pca.closest('.card2').classList.add('readonly'); profileEmpties(); return; }
    const psv = e.target.closest('[data-save]'); if (psv) { psv.closest('.card2').classList.add('readonly'); profileEmpties(); return; }
    const dv = e.target.closest('[data-docverify]');
    if (dv) { const row = dv.closest('.docrow'); row.classList.add('verified'); dv.classList.add('done'); dv.innerHTML = window.FGI('check',14) + 'Verified'; row.querySelector('.dock b').textContent = row.querySelector('.dock b').textContent === 'No document uploaded' ? 'Verified manually' : row.querySelector('.dock b').textContent; row.querySelector('.dock em').textContent = 'Working rights confirmed'; return; }
    const dup = e.target.closest('[data-docupload]');
    if (dup) { const row = dup.closest('.docrow'); row.querySelector('.dock b').textContent = 'passport.pdf'; row.querySelector('.dock em').textContent = 'Uploaded \u00b7 awaiting verification'; dup.outerHTML = '<button class="docbtn del" data-docdel title="Delete document">' + window.FGI('x',15) + '</button>'; return; }
    const dd = e.target.closest('[data-docdel]');
    if (dd) { const row = dd.closest('.docrow'); row.classList.remove('verified'); row.querySelector('.dock b').textContent = 'No document uploaded'; row.querySelector('.dock em').textContent = 'Optional \u2014 verify manually or attach evidence'; dd.outerHTML = '<button class="docbtn ghostbtn docup" data-docupload>' + window.FGI('upload',14) + 'Upload</button>'; return; }
    const ldel = e.target.closest('[data-licdel]');
    if (ldel) { ldel.closest('.lic').remove(); const ll = page.querySelector('#lic-list'), le = page.querySelector('#lic-empty'); if (ll && le && !ll.children.length) le.style.display = ''; return; }
    const ladd = e.target.closest('#lic-add');
    if (ladd) { const sel = page.querySelector('#lic-type'), cu = page.querySelector('#lic-custom'), ll = page.querySelector('#lic-list'), le = page.querySelector('#lic-empty'); let t = null;
      if (sel.value === '__custom') { const nm = (cu.value||'').trim(); if (!nm) { cu.focus(); return; } t = { name: nm }; }
      else if (sel.value) { t = window.FG_LIC_TYPES.find(x => x.name === sel.value); }
      if (!t) { sel.focus(); return; }
      ll.insertAdjacentHTML('beforeend', window.FG_LIC_CARD(t)); if (le) le.style.display = 'none';
      sel.selectedIndex = 0; cu.value = ''; cu.style.display = 'none'; sel.style.display = ''; return; }
    const dt = e.target.closest('.dtbtn'); if (dt) { dt.parentElement.querySelectorAll('.dtbtn').forEach(t => t.classList.remove('active')); dt.classList.add('active'); }
  });
  document.querySelector('.fg').addEventListener('mousemove', (e) => {
    const c = e.target.closest('.spot'); if (!c) return;
    const r = c.getBoundingClientRect();
    c.style.setProperty('--mx', (e.clientX - r.left) + 'px'); c.style.setProperty('--my', (e.clientY - r.top) + 'px');
  });
  document.querySelector('.fg').addEventListener('input', (e) => {
    if (e.target.classList.contains('dsearchin')) { applyDir(); return; }
  });
  document.querySelector('.fg').addEventListener('change', (e) => {
    if (e.target.classList.contains('dsort')) { applyDir(); return; }
    if (e.target.id === 'lic-type') { const cu = document.getElementById('lic-custom'); if (e.target.value === '__custom') { e.target.style.display = 'none'; cu.style.display = ''; cu.focus(); } else { cu.style.display = 'none'; } }
    if (e.target.id === 'wr-status') { const v = e.target.value, grp = document.getElementById('wr-visa'); const noVisa = (v === 'Australian citizen' || v === 'Permanent resident'); if (grp) { grp.style.opacity = noVisa ? '.35' : ''; grp.style.pointerEvents = noVisa ? 'none' : ''; grp.querySelectorAll('input,select').forEach(el => { el.disabled = noVisa; if (noVisa) el.value = ''; }); } }
  });

  // ── command palette ──
  const cmd = document.getElementById('fg-cmd'), cin = document.getElementById('fg-cmd-in'), clist = document.getElementById('fg-cmd-list');
  const HINT = { home:'Workspace landing', toolbox:'Calculators & references', ductr:'VRF layouts, pipework & materials', tiff:'Assistant & knowledge base', people:'People & their day', timepay:'Timesheets, leave & expenses', assets:'Fleet & equipment', admin:'Owner, financial & compliance' };
  const ACC = { home:'#00E5C0', toolbox:'#8A2BE2', ductr:'#FF8A00', tiff:'#2E68FF', people:'#00A389', timepay:'#2E68FF', assets:'#F0A431', admin:'#FF3366' };
  const CMDS = window.FG3_NAV.map(n => ({ id:n[0], label:n[1], hint:HINT[n[0]], icon:n[2], accent:ACC[n[0]] }));
  let flat = [], sel = 0;
  function buildCmd(q) {
    q = (q || '').trim().toLowerCase();
    const items = CMDS.filter(c => !q || (c.label + ' ' + c.hint).toLowerCase().includes(q));
    flat = items;
    if (!items.length) { clist.innerHTML = '<div class="cempty"><b>No results for "' + q + '"</b><em>Try "team", "design", or "admin"</em></div>'; return; }
    let html = '<div class="cgl">Navigate</div>';
    items.forEach(c => { const idx = flat.indexOf(c);
      html += '<button class="crow' + (idx===sel?' on':'') + '" data-i="' + idx + '"><span class="ci2" style="background:' + c.accent + '15"><span style="color:' + c.accent + ';display:flex">' + I(c.icon,17) + '</span></span>' +
        '<span class="ck"><b>' + c.label + '</b><em>' + c.hint + '</em></span><span class="cen">' + I('cornerDL',14) + '</span></button>';
    });
    clist.innerHTML = html;
  }
  function openCmd() { cmd.classList.add('open'); cin.value = ''; sel = 0; buildCmd(''); setTimeout(() => cin.focus(), 40); }
  function closeCmd() { cmd.classList.remove('open'); }
  function runCmd(c) { closeCmd(); if (c.id !== currentScreen) render(c.id); }
  function paint() { [...clist.querySelectorAll('.crow')].forEach(r => r.classList.toggle('on', +r.dataset.i === sel)); }
  cin.addEventListener('input', () => { sel = 0; buildCmd(cin.value); });
  clist.addEventListener('click', (e) => { const r = e.target.closest('[data-i]'); if (r) runCmd(flat[+r.dataset.i]); });
  clist.addEventListener('mousemove', (e) => { const r = e.target.closest('[data-i]'); if (r && +r.dataset.i !== sel) { sel = +r.dataset.i; paint(); } });
  cmd.addEventListener('click', (e) => { if (e.target.hasAttribute('data-close')) closeCmd(); });
  window.addEventListener('keydown', (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); cmd.classList.contains('open') ? closeCmd() : openCmd(); return; }
    if (!cmd.classList.contains('open')) return;
    if (e.key === 'Escape') { e.preventDefault(); closeCmd(); }
    else if (e.key === 'ArrowDown') { e.preventDefault(); if (flat.length) { sel = (sel+1)%flat.length; paint(); } }
    else if (e.key === 'ArrowUp') { e.preventDefault(); if (flat.length) { sel = (sel-1+flat.length)%flat.length; paint(); } }
    else if (e.key === 'Enter') { e.preventDefault(); if (flat[sel]) runCmd(flat[sel]); }
  });

  document.querySelector('#fg-cmd .ci').innerHTML = I('search',20);
  document.querySelector('#fg-cmd .cf-l').innerHTML = '<span style="display:flex">' + I('arrowUp',9) + I('arrowDown',9) + '</span> Navigate \u00b7 <span style="display:flex">' + I('cornerDL',9) + '</span> Select';
  document.querySelector('#fg-cmd .cf-r').innerHTML = '<span style="color:#00E5C0;display:flex">' + I('sparkles',12) + '</span> HeyTiff Command';

  render('ductr');
})();
