
// ===== c1f3fc7e-d30e-4fd7-8e26-eadb747f9a0a =====
/* ===== HeyTiff · FIGMA REPLICA — lucide icons + screen renderers ===== */
(function () {
  // --- lucide-style icon paths (24x24 stroke) ---
  const P = {
    dashboard:'<rect width="7" height="9" x="3" y="3" rx="1"/><rect width="7" height="5" x="14" y="3" rx="1"/><rect width="7" height="9" x="14" y="12" rx="1"/><rect width="7" height="5" x="3" y="16" rx="1"/>',
    wrench:'<path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/>',
    users:'<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>',
    wind:'<path d="M12.8 19.6A2 2 0 1 0 14 16H2"/><path d="M17.5 8a2.5 2.5 0 1 1 2 4H2"/><path d="M9.8 4.4A2 2 0 1 1 11 8H2"/>',
    sparkles:'<path d="M9.937 15.5A2 2 0 0 0 8.5 14.063l-6.135-1.582a.5.5 0 0 1 0-.962L8.5 9.936A2 2 0 0 0 9.937 8.5l1.582-6.135a.5.5 0 0 1 .962 0L14.063 8.5A2 2 0 0 0 15.5 9.937l6.135 1.581a.5.5 0 0 1 0 .964L15.5 14.063a2 2 0 0 0-1.437 1.437l-1.582 6.135a.5.5 0 0 1-.962 0z"/><path d="M20 3v4"/><path d="M22 5h-4"/><path d="M4 17v2"/><path d="M5 18H3"/>',
    shield:'<path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z"/><path d="m9 12 2 2 4-4"/>',
    search:'<circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/>',
    bell:'<path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/>',
    settings:'<path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/><circle cx="12" cy="12" r="3"/>',
    hexagon:'<path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/>',
    command:'<path d="M15 6v12a3 3 0 1 0 3-3H6a3 3 0 1 0 3 3V6a3 3 0 1 0-3 3h12a3 3 0 1 0-3-3"/>',
    cloud:'<path d="M17.5 19H9a7 7 0 1 1 6.71-9h1.79a4.5 4.5 0 1 1 0 9Z"/>',
    thermo:'<path d="M14 4v10.54a4 4 0 1 1-4 0V4a2 2 0 0 1 4 0Z"/>',
    chevR:'<path d="m9 18 6-6-6-6"/>',
    activity:'<path d="M22 12h-2.48a2 2 0 0 0-1.93 1.46l-2.35 8.36a.25.25 0 0 1-.48 0L9.24 2.18a.25.25 0 0 0-.48 0l-2.35 8.36A2 2 0 0 1 4.49 12H2"/>',
    arrowUR:'<path d="M7 7h10v10"/><path d="M7 17 17 7"/>',
    send:'<path d="M14.536 21.686a.5.5 0 0 0 .937-.024l6.5-19a.496.496 0 0 0-.635-.635l-19 6.5a.5.5 0 0 0-.024.937l7.93 3.18a2 2 0 0 1 1.112 1.11z"/><path d="m21.854 2.147-10.94 10.939"/>',
    bot:'<path d="M12 8V4H8"/><rect width="16" height="12" x="4" y="8" rx="2"/><path d="M2 14h2"/><path d="M20 14h2"/><path d="M15 13v2"/><path d="M9 13v2"/>',
    fingerprint:'<path d="M12 10a2 2 0 0 0-2 2c0 1.02-.1 2.51-.26 4"/><path d="M14 13.12c0 2.38 0 6.38-1 8.88"/><path d="M17.29 21.02c.12-.6.43-2.3.5-3.02"/><path d="M2 12a10 10 0 0 1 18-6"/><path d="M2 16h.01"/><path d="M21.8 16c.2-2 .131-5.354 0-6"/><path d="M5 19.5C5.5 18 6 15 6 12a6 6 0 0 1 .34-2"/><path d="M8.65 22c.21-.66.45-1.32.57-2"/><path d="M9 6.8a6 6 0 0 1 9 5.2v2"/>',
    zap:'<path d="M4 14a1 1 0 0 1-.78-1.63l9.9-10.2a.5.5 0 0 1 .86.46l-1.92 6.02A1 1 0 0 0 13 10h7a1 1 0 0 1 .78 1.63l-9.9 10.2a.5.5 0 0 1-.86-.46l1.92-6.02A1 1 0 0 0 11 14z"/>',
    alert:'<path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3"/><path d="M12 9v4"/><path d="M12 17h.01"/>',
    file:'<path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7z"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/><path d="M16 13H8"/><path d="M16 17H8"/><path d="M10 9H8"/>',
    calc:'<rect width="16" height="20" x="4" y="2" rx="2"/><path d="M8 6h8"/><path d="M16 14v4"/><path d="M16 10h.01"/><path d="M12 10h.01"/><path d="M8 10h.01"/><path d="M12 14h.01"/><path d="M8 14h.01"/><path d="M12 18h.01"/><path d="M8 18h.01"/>',
    layers:'<path d="m12.83 2.18a2 2 0 0 0-1.66 0L2.6 6.08a1 1 0 0 0 0 1.83l8.58 3.91a2 2 0 0 0 1.66 0l8.58-3.9a1 1 0 0 0 0-1.84z"/><path d="m22 17.65-9.17 4.16a2 2 0 0 1-1.66 0L2 17.65"/><path d="m22 12.65-9.17 4.16a2 2 0 0 1-1.66 0L2 12.65"/>',
    library:'<path d="m16 6 4 14"/><path d="M12 6v14"/><path d="M8 8v12"/><path d="M4 4v16"/>',
    cursor:'<path d="M4.037 4.688a.495.495 0 0 1 .651-.651l16 6.5a.5.5 0 0 1-.063.947l-6.124 1.58a2 2 0 0 0-1.438 1.435l-1.579 6.126a.5.5 0 0 1-.947.063z"/>',
    hand:'<path d="M18 11V6a2 2 0 0 0-2-2a2 2 0 0 0-2 2"/><path d="M14 10V4a2 2 0 0 0-2-2a2 2 0 0 0-2 2v2"/><path d="M10 10.5V6a2 2 0 0 0-2-2a2 2 0 0 0-2 2v8"/><path d="M18 8a2 2 0 1 1 4 0v6a8 8 0 0 1-8 8h-2c-2.8 0-4.5-.86-5.99-2.34l-3.6-3.6a2 2 0 0 1 2.83-2.82L7 15"/>',
    square:'<rect width="18" height="18" x="3" y="3" rx="2"/>',
    circle:'<circle cx="12" cy="12" r="10"/>',
    arrowR:'<path d="M5 12h14"/><path d="m12 5 7 7-7 7"/>',
    ruler:'<path d="M21.3 8.7 8.7 21.3a1 1 0 0 1-1.4 0l-4.6-4.6a1 1 0 0 1 0-1.4L15.3 2.7a1 1 0 0 1 1.4 0l4.6 4.6a1 1 0 0 1 0 1.4Z"/><path d="m7.5 10.5 2 2"/><path d="m10.5 7.5 2 2"/><path d="m13.5 4.5 2 2"/><path d="m4.5 13.5 2 2"/>',
    tag:'<path d="M12.586 2.586A2 2 0 0 0 11.172 2H4a2 2 0 0 0-2 2v7.172a2 2 0 0 0 .586 1.414l8.704 8.704a2.426 2.426 0 0 0 3.42 0l6.58-6.58a2.426 2.426 0 0 0 0-3.42z"/><circle cx="7.5" cy="7.5" r=".5" fill="currentColor"/>',
    minus:'<path d="M5 12h14"/>',
    plus:'<path d="M5 12h14"/><path d="M12 5v14"/>',
    maximize:'<path d="M15 3h6v6"/><path d="M9 21H3v-6"/><path d="m21 3-7 7"/><path d="m3 21 7-7"/>',
    settings2:'<path d="M20 7h-9"/><path d="M14 17H5"/><circle cx="17" cy="17" r="3"/><circle cx="7" cy="7" r="3"/>',
    download:'<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="M7 10l5 5 5-5"/><path d="M12 15V3"/>',
    cornerDL:'<path d="M20 4v7a4 4 0 0 1-4 4H4"/><path d="m9 10-5 5 5 5"/>',
    arrowUp:'<path d="m5 12 7-7 7 7"/><path d="M12 19V5"/>',
    arrowDown:'<path d="M12 5v14"/><path d="m19 12-7 7-7-7"/>',
  };
  function I(name, size, sw) {
    return '<svg class="i" width="' + (size||20) + '" height="' + (size||20) + '" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="' + (sw||2) + '" stroke-linecap="round" stroke-linejoin="round">' + (P[name]||'') + '</svg>';
  }
  window.FGI = I;

  const NAV = {
    ws: [['home','Dashboard','dashboard'],['toolbox','Toolbox','wrench'],['people','Team','users'],['ductr','Duct Studio','wind']],
    assist: [['tiff','Tiff AI','sparkles'],['admin','Admin','shield']]
  };
  window.FG_SIDEBAR = function (active) {
    const item = (n) => {
      const on = n[0] === active;
      return '<button class="ni' + (on?' on':'') + '" data-nav="' + n[0] + '"><span class="nibg"></span>' +
        '<span class="nicon">' + I(n[2],16,on?2.5:2) + '</span><span class="nlbl">' + n[1] + '</span>' +
        (n[0]==='tiff' && !on ? '<span class="pdot"></span>' : '') + '</button>';
    };
    return '<aside class="side"><div class="glow"></div>' +
      '<div class="brand"><div class="logo">' + I('hexagon',24) + '</div>' +
        '<div><div class="bt">HeyTiff <i>\u2726</i></div><div class="bs">Platform</div></div></div>' +
      '<div class="nav no-sb">' +
        '<div class="navgrp"><div class="navlbl"><span></span>Workspaces</div>' + NAV.ws.map(item).join('') + '</div>' +
        '<div class="navgrp"><div class="navlbl"><span></span>Assist &amp; Admin</div>' + NAV.assist.map(item).join('') + '</div>' +
      '</div>' +
      '<div class="sfoot"><div class="pro"><div class="pg"></div><div class="pt">Pro Access ' + I('sparkles',12) + '</div>' +
        '<div class="pd">VRF commissioning &amp; live team sync</div><button class="pb">Upgrade Now</button></div>' +
        '<div class="me"><div class="av"><div class="ring"><div class="inner">IS</div></div><div class="st"></div></div>' +
          '<div class="mk"><b>Isaac Smith</b><em>Lead Designer</em></div>' + I('settings',16) + '</div></div>' +
    '</aside>';
  };
  window.FG_TOPBAR = function () {
    return '<header class="topbar" id="fg-topbar">' +
      '<button class="searchbtn" data-cmd><span class="si">' + I('search',18) + '</span>' +
        '<div class="sf">Search jobs, blueprints, or ask Tiff...</div>' +
        '<span class="kbd">' + I('command',10) + ' K</span></button>' +
      '<div class="tbr"><button class="bell">' + I('bell',20) + '<span class="d"></span></button>' +
        '<span class="sep"></span>' +
        '<button class="newbtn"><span class="sh"></span><span>New Project</span><span class="pl">+</span></button></div>' +
    '</header>';
  };

  window.FG_SCREENS = {
    home: window.FG_HOME, // assigned in figma-screens.js
  };
})();

// ===== 45a23d82-0ff5-4b99-bf73-45776ef57e14 =====
/* ===== HeyTiff · FIGMA REPLICA — LiveCanvas VRF schematic (animated SVG) ===== */
(function () {
  const TEAL = '#00E5C0', BLUE = '#2E68FF';
  const ROOMS = [
    { x:60,y:60,w:280,h:200,label:'Open Office',area:'84 m\u00b2' },
    { x:360,y:60,w:200,h:130,label:'Meeting',area:'26 m\u00b2' },
    { x:360,y:210,w:200,h:130,label:'Breakout',area:'26 m\u00b2' },
    { x:60,y:280,w:180,h:120,label:'Reception',area:'21 m\u00b2' },
    { x:260,y:360,w:300,h:120,label:'Studio',area:'36 m\u00b2' },
  ];
  const UNITS = [
    { x:200,y:160,kw:3.6 },{ x:460,y:125,kw:2.2 },{ x:460,y:275,kw:2.2 },{ x:150,y:340,kw:2.0 },{ x:410,y:420,kw:3.2 },
  ];
  const OUT = { x:620, y:230 };

  window.FG_PLAN = function () {
    let s = '<svg class="plan" viewBox="0 0 720 520">';
    // refrigerant base lines
    UNITS.forEach((u,i) => {
      const midX = (u.x + OUT.x) / 2;
      const d = 'M ' + u.x + ' ' + u.y + ' L ' + midX + ' ' + u.y + ' L ' + midX + ' ' + (OUT.y+18) + ' L ' + OUT.x + ' ' + (OUT.y+18);
      s += '<path class="pl-line" pathLength="1" d="' + d + '" fill="none" stroke="' + TEAL + '" stroke-width="2" stroke-linecap="round" style="animation-delay:' + (0.8 + i*0.12) + 's"/>';
    });
    // flow pulses
    UNITS.forEach((u,i) => {
      const midX = (u.x + OUT.x) / 2;
      const d = 'M ' + u.x + ' ' + u.y + ' L ' + midX + ' ' + u.y + ' L ' + midX + ' ' + (OUT.y+18) + ' L ' + OUT.x + ' ' + (OUT.y+18);
      s += '<path class="pl-flow" d="' + d + '" fill="none" stroke="' + TEAL + '" stroke-width="3" stroke-linecap="round" style="animation-delay:' + (2 + i*0.2) + 's"/>';
    });
    // rooms
    ROOMS.forEach((r,i) => {
      s += '<g class="pl-room" style="animation-delay:' + (0.1 + i*0.1) + 's">' +
        '<rect x="' + r.x + '" y="' + r.y + '" width="' + r.w + '" height="' + r.h + '" rx="10" fill="rgba(255,255,255,0.75)" stroke="rgba(5,5,5,0.12)" stroke-width="1.5"/>' +
        '<text x="' + (r.x+14) + '" y="' + (r.y+26) + '" font-size="13" font-weight="800" fill="#050505" font-family="Plus Jakarta Sans, sans-serif">' + r.label + '</text>' +
        '<text x="' + (r.x+14) + '" y="' + (r.y+44) + '" font-size="11" font-weight="700" fill="#9ca3af" font-family="JetBrains Mono, monospace">' + r.area + '</text></g>';
    });
    // indoor units
    UNITS.forEach((u,i) => {
      s += '<g class="pl-unit" style="animation-delay:' + (1 + i*0.12) + 's">' +
        '<circle class="pl-ring" cx="' + u.x + '" cy="' + u.y + '" r="18" fill="none" stroke="' + TEAL + '" stroke-width="2" style="animation-delay:' + (1.5 + i*0.2) + 's"/>' +
        '<circle cx="' + u.x + '" cy="' + u.y + '" r="18" fill="#fff" stroke="' + TEAL + '" stroke-width="2.5"/>' +
        '<circle cx="' + u.x + '" cy="' + u.y + '" r="9" fill="none" stroke="' + TEAL + '" stroke-width="1.5" opacity="0.5"/>' +
        '<text x="' + u.x + '" y="' + (u.y+34) + '" font-size="9" font-weight="700" fill="#6b7280" text-anchor="middle" font-family="JetBrains Mono, monospace">' + u.kw + ' kW</text></g>';
    });
    // outdoor condenser
    s += '<g class="pl-odu">' +
      '<rect x="' + (OUT.x-4) + '" y="' + OUT.y + '" width="64" height="40" rx="8" fill="#050505"/>' +
      '<rect x="' + (OUT.x-4) + '" y="' + OUT.y + '" width="64" height="40" rx="8" fill="url(#fgodu)"/>' +
      '<g class="pl-fan">' +
        [0,120,240].map(deg => '<rect x="' + (OUT.x+26) + '" y="' + (OUT.y+8) + '" width="4" height="12" rx="2" fill="' + TEAL + '" transform="rotate(' + deg + ' ' + (OUT.x+28) + ' ' + (OUT.y+20) + ')"/>').join('') +
      '</g>' +
      '<text x="' + (OUT.x+28) + '" y="' + (OUT.y+56) + '" font-size="9" font-weight="800" fill="#050505" text-anchor="middle" font-family="JetBrains Mono, monospace">ODU \u00b7 14kW</text></g>';
    s += '<defs><linearGradient id="fgodu" x1="0%" y1="0%" x2="100%" y2="100%"><stop offset="0%" stop-color="' + TEAL + '" stop-opacity="0.25"/><stop offset="100%" stop-color="' + BLUE + '" stop-opacity="0.1"/></linearGradient></defs>';
    s += '</svg>';
    return s;
  };
})();

// ===== 40cca81b-5458-4f1c-ae49-51bf55733625 =====
/* ===== HeyTiff · FIGMA REPLICA — screen content renderers ===== */
(function () {
  const I = window.FGI;

  function home() {
    const date = new Date().toLocaleDateString('en-AU', { weekday:'long', day:'numeric', month:'long' });
    return '<div class="wrap"><div class="stg">' +
      // hero
      '<div class="hero"><div class="mesh"><i class="m1"></i><i class="m2"></i><i class="m3"></i></div>' +
        '<div class="hrow"><div class="hlead">' +
          '<div class="pill">' + I('activity',12) + date + '</div>' +
          '<h1>Good morning,<br><span>Isaac.</span></h1>' +
          '<p class="lede">You have <b>4 critical tasks</b> pending and 7 recent unread updates across your active site deployments.</p>' +
          '<div class="hstats">' +
            '<div class="hstat"><div class="hg"></div><div class="hl">Completed</div><div class="hv"><b><span data-count="9"></span><em>/11</em></b><span class="ht">+2</span></div><div class="hsub">Tasks Today</div></div>' +
            '<div class="hstat"><div class="hg"></div><div class="hl">Reviewed</div><div class="hv"><b><span data-count="14"></span></b><span class="ht">+5</span></div><div class="hsub">Plans This Week</div></div>' +
          '</div></div>' +
          '<div class="ring-bento"><div class="rgw"></div>' +
            '<div class="ring"><svg viewBox="0 0 100 100"><circle cx="50" cy="50" r="44" fill="none" stroke="rgba(255,255,255,0.03)" stroke-width="6"/>' +
              '<circle class="rfill" cx="50" cy="50" r="44" fill="none" stroke="url(#fgrg)" stroke-width="6" stroke-linecap="round" stroke-dasharray="0 276.46" data-pct="94"/>' +
              '<defs><linearGradient id="fgrg" x1="0%" y1="0%" x2="100%" y2="100%"><stop offset="0%" stop-color="#00E5C0"/><stop offset="100%" stop-color="#2E68FF"/></linearGradient></defs></svg>' +
              '<div class="rn"><span data-count="94" data-suffix="%"></span></div></div>' +
            '<div class="rk"><b>Efficiency</b><p>Average task completion rate across active jobs</p></div></div>' +
        '</div></div>' +
      // bento
      '<div class="bento"><div class="c8">' +
          '<div class="askbar"><div class="al"><div class="ag"><div class="agb"></div><div class="agi">' + I('sparkles',20) + '</div></div>' +
            '<input placeholder="Ask Tiff about sizing, fault codes, or SOPs..."></div>' +
            '<button class="gen">Generate ' + I('send',16) + '</button></div>' +
          '<div class="sgrid">' +
            sugg('Diagnostics','R32 running pressures at 35\u00b0C','What should I see on the gauges?','#00E5C0') +
            sugg('Fault Codes','Mitsubishi U4 error','Immediate diagnosis and likely fix','#2E68FF') +
          '</div></div>' +
        '<div class="c4">' +
          '<div class="wcard"><div class="wg"></div>' +
            '<div class="wtop"><span class="wl">Sydney Area</span><span class="wc">' + I('cloud',14) + 'Partly Cloudy</span></div>' +
            '<div class="wtemp"><b>16\u00b0</b><em>C</em></div>' +
            '<div class="wnote">' + I('thermo',18) + 'Optimal ambient conditions for external condenser placement today.</div></div>' +
          '<div class="ccard"><div class="ctop"><b>Field Comms</b><button class="all">All ' + I('arrowUR',14) + '</button></div>' +
            comm('WORK TRITON','Yesterday',true) + comm('Paramatta Eels vs South Sydney','2d ago',false) + comm('EOFY toolbox available','3d ago',false) +
          '</div></div>' +
      '</div>' +
    '</div></div>';
  }
  function sugg(cat, title, desc, color) {
    return '<button class="sugg spot" style="--sc:' + color + '22"><span class="sglow"></span>' +
      '<span class="stop" style="background:' + color + '"></span>' +
      '<div class="scat" style="color:' + color + '">' + cat + '</div>' +
      '<div class="stt">' + title + '</div><div class="sds">' + desc + '</div></button>';
  }
  function comm(title, time, imp) {
    return '<div class="comm' + (imp?' imp':'') + '"><span class="cd"></span><div class="ck"><b>' + title + '</b><em>' + time + '</em></div>' + I('chevR',16) + '</div>';
  }

  function tiff() {
    const S = [
      ['DIAGNOSTICS','wrench','#00E5C0','rgba(0,229,192,0.1)','R32 running pressures at 35\u00b0C','What should I see on gauges?'],
      ['SYSTEM DESIGN','zap','#2E68FF','rgba(46,104,255,0.1)','Size a VRF for a 3-storey office','18 indoor units, mixed zones'],
      ['FAULT CODES','alert','#FF3366','rgba(255,51,102,0.1)','Mitsubishi U4 error','Diagnosis and likely fix'],
      ['COMPANY SOP','file','#8A2BE2','rgba(138,43,226,0.1)','Daikin warranty claim process','What\u2019s our standard procedure?'],
    ];
    const cards = S.map(s => '<button class="tsugg"><span class="tsg" style="background:' + s[2] + '"></span>' +
      '<div class="tsh"><div class="tsi" style="background:' + s[3] + '">' + I(s[1],18) + '</div>' +
      '<span class="tsc" style="color:' + s[2] + '">' + s[0] + '</span></div>' +
      '<div class="tst2">' + s[4] + '</div><div class="tsd">' + s[5] + '</div></button>').join('');
    const kb = [['Install procedures','84','#00E5C0'],['Fault code library','2,268+','#2E68FF'],['Manufacturer specs','538','#f59e0b'],['Company SOPs','47','#8A2BE2']]
      .map(k => '<div class="kbrow"><span class="kd" style="background:' + k[2] + '"></span><span class="kl">' + k[0] + '</span><span class="kc" style="color:' + k[2] + '">' + k[1] + '</span></div>').join('');
    const threads = [['Daikin VRV X line-sizing run','2h ago',false],['RX10A \u2192 R32 retrofit specs','Yesterday',true],['Fujitsu EE:01 fault diagnosis','Yesterday',false]]
      .map(t => '<div class="thread"><div class="th"><b>' + t[0] + '</b>' + (t[2]?'<span class="pro2">PRO</span>':'') + '</div><em>' + t[1] + '</em></div>').join('');
    return '<div class="tiff"><div class="tmain"><div class="thero"><div class="o1"></div><div class="o2"></div>' +
        '<div class="trow"><div class="tbot"><div class="tb">' + I('bot',40,1.5) + '</div><div class="tst"><i></i></div></div>' +
          '<div class="tlead"><div class="pill">' + I('fingerprint',12) + 'Model: Tiff-Neo v2.4</div>' +
            '<h2>What are we building today?</h2>' +
            '<p class="tl">I\u2019m trained on <b>1,240 company jobs</b> and your latest SOPs. Ask me about system sizing, diagnostics, or documentation.</p></div></div></div>' +
        '<div class="tsgrid stgp">' + cards + '</div>' +
        '<div class="tinput"><div class="tib"></div><div class="tin"><div class="tic">' + I('sparkles',20) + '</div>' +
          '<input placeholder="Message Tiff AI..."><button class="tsend">' + I('send',18) + '</button></div></div></div>' +
      '<div class="tside"><div><div class="tsl"><span>Knowledge Base</span><button>Edit</button></div>' + kb + '</div>' +
        '<div class="tdiv"></div><div><div class="tsl"><span>Recent Threads</span></div>' + threads + '</div></div></div>';
  }

  function toolbox() {
    const cats = [
      ['Calculators','calc','#00E5C0','Precise field calculations',[['Refrigerant Charge','Per-line calculations','Popular'],['Head Load','Cooling/heating load',null],['Duct Sizing','Velocity & pressure drop',null],['Coil Sizing','Evaporator selection',null]]],
      ['Troubleshooting','alert','#FF3366','Diagnose & resolve',[['Running Pressures','R32 / R410A reference','Popular'],['Manufacturer Helplines','Tech support contacts',null]]],
      ['Design Tools','layers','#2E68FF','System design & layout',[['VRF Builder','System design & layout','Popular'],['Ducted Builder','Duct layout',null],['Ductwork','Flexible duct design','New'],['Globe Builder','Globe valve sizing','Beta']]],
      ['Reference Library','library','#8A2BE2','Specs & standards',[['Plenum Sizes','Standard plenum dims',null],['Colourbond Colours','Approved palette',null],['Training','Manufacturer courses','New'],['Filter Sizes','Standard filter dims',null]]],
    ];
    const badge = { Popular:['rgba(0,229,192,0.1)','#00E5C0'], New:['rgba(46,104,255,0.1)','#2E68FF'], Beta:['rgba(255,51,102,0.1)','#FF3366'] };
    const card = (c) => {
      const tools = c[4].map((t,i) => '<div class="toolrow"><span class="tdot" style="background:' + (i===0?c[2]:'#e5e7eb') + '"></span>' +
        '<div class="tnm"><b>' + t[0] + '</b><em>' + t[1] + '</em></div>' +
        (t[2] ? '<span class="tbg" style="background:' + badge[t[2]][0] + ';color:' + badge[t[2]][1] + ';border-color:' + badge[t[2]][1] + '30">' + t[2] + '</span>' : '') +
        I('chevR',18) + '</div>').join('');
      return '<div class="catwrap"><div class="cat spot" style="--sc:' + c[2] + '1f"><span class="sglow"></span>' +
        '<div class="ctop" style="background:' + c[2] + '"></div>' +
        '<div class="cin"><div class="chd"><div class="cic" style="background:' + c[2] + '15;border:1px solid ' + c[2] + '30">' + I(c[1],24) + '</div>' +
          '<div><div class="cht">' + c[0] + '</div><div class="chs">' + c[3] + '</div></div></div>' + tools + '</div></div></div>';
    };
    return '<div class="wrap"><div class="tbx-head"><div class="stg"><div class="tbx-eb">Field Tools &amp; Reference</div><h1>Toolbox</h1></div>' +
        '<div class="tbx-search">' + I('search',18) + '<input placeholder="Search tools..."></div></div>' +
      '<div class="tbx-grid stgp">' + cats.map(card).join('') + '</div></div>';
  }

  function ductr() {
    const steps = [['Plans',1,'done'],['Design',2,'active'],['Materials',3,''],['Job',4,'']];
    const tools = [['cursor','select',0],['hand','pan',1],['square','room',0],['layers','rect',0],['circle','circle',0],['arrowR','pipe',0],['ruler','ruler',0],['tag','tag',0]];
    const rooms = [['Open Office','84 m\u00b2',3.6],['Meeting','26 m\u00b2',2.2],['Breakout','26 m\u00b2',2.2],['Reception','21 m\u00b2',2.0],['Studio','36 m\u00b2',3.2]];
    const stepEls = steps.map((s,i) => '<button class="dstep ' + s[2] + '"><span class="dn">' + s[1] + '</span>' + s[0] + '</button>').join('');
    const toolEls = tools.map(t => (t[1]==='room'?'<div class="tdv"></div>':'') + '<button class="dtbtn' + (t[1]==='select'?' active':'') + '" title="' + t[1] + '">' + I(t[0],20) + '</button>').join('');
    const roomEls = rooms.map(r => '<div class="droom"><div class="ri">' + I('square',16) + '</div>' +
      '<div class="rk"><b>' + r[0] + '</b><em>' + r[1] + '</em></div><span class="rkw">' + r[2] + ' kW</span></div>').join('');
    return '<div class="ductr"><div class="cad1"></div><div class="cad2"></div>' +
      '<div class="dhead"><div class="dsteps">' + stepEls + '</div>' +
        '<div class="dhr"><button class="dlay">' + I('settings2',16) + ' Layout</button>' +
          '<div class="dscale"><span class="ping"><span class="p1"></span><span class="p2"></span></span>Scale: 1:100 \u00b7 Set</div>' +
          '<span class="dsep"></span><button class="dsave">Save</button>' +
          '<button class="dexport">Export ' + I('download',14) + '</button></div></div>' +
      '<div class="dwork"><div class="dtools">' + toolEls + '</div>' +
        '<div class="dcanvas">' + window.FG_PLAN() +
          '<div class="dstatus"><span class="ping"><span class="p1"></span><span class="p2"></span></span>' +
            '<span class="sl">Auto-routing 5 units</span><span class="slv">\u00b7 level 3</span></div></div>' +
        '<div class="dprops"><div class="ph"><h3>System 1</h3><button>+</button></div>' +
          '<div class="dpbody"><div class="odu"><div class="or"><span class="ol">Outdoor Unit</span><span class="okw">14 kW</span></div>' +
            '<div class="ld"><b>Connected Load</b><em><span data-count="13.2" data-dec="1"></span> / 14 kW</em></div>' +
            '<div class="bar"><i data-w="94"></i></div>' +
            '<div class="of"><span class="a">94% utilised</span><span class="b">DIVERSITY OK</span></div></div>' +
            '<div><div class="dtabs"><button class="dtab on">rooms <span class="dc">5</span></button>' +
              '<button class="dtab">units <span class="dc">5</span></button><button class="dtab">parts <span class="dc">23</span></button></div>' +
              '<div class="stg">' + roomEls + '</div></div></div></div>' +
      '</div>' +
      '<div class="dview"><button>' + I('minus',18,2.5) + '</button><button>' + I('plus',18,2.5) + '</button><button>' + I('maximize',18,2) + '</button></div>' +
      '<div class="dread"><div class="rd">X: 761 \u00b7 Y: 187</div><div class="rd">100%</div></div>' +
    '</div>';
  }

  window.FG_SCREENS = { home, tiff, toolbox, ductr, people: home, admin: home };
})();

// ===== 5eb69039-88af-4adb-bba1-9fad6563f951 =====
/* ===== HeyTiff · v3 — flat single-line nav, no group labels, "Design Studio",
   stripped dashboard, no "New Project" button. Reuses figma.js icons + screens. ===== */
(function () {
  const I = window.FGI;

  // flat nav — one list, no Workspaces / Assist labels. Duct Studio -> Design Studio.
  const NAV = [
    ['home','Dashboard','dashboard'],
    ['toolbox','Toolbox','wrench'],
    ['people','Team','users'],
    ['ductr','Design Studio','wind'],
    ['tiff','Tiff AI','sparkles'],
    ['admin','Admin','shield'],
  ];
  window.FG3_NAV = NAV;

  window.FG3_SIDEBAR = function (active) {
    const item = (n) => {
      const on = n[0] === active;
      return '<button class="ni' + (on?' on':'') + '" data-nav="' + n[0] + '"><span class="nibg"></span>' +
        '<span class="nicon">' + I(n[2],16,on?2.5:2) + '</span><span class="nlbl">' + n[1] + '</span>' +
        (n[0]==='tiff' && !on ? '<span class="pdot"></span>' : '') + '</button>';
    };
    return '<aside class="side"><div class="glow"></div>' +
      '<div class="brand"><div class="logo">' + I('hexagon',24) + '</div>' +
        '<div><div class="bt">HeyTiff <i>\u2726</i></div><div class="bs">Platform</div></div></div>' +
      '<div class="nav no-sb"><div class="navgrp">' + NAV.map(item).join('') + '</div></div>' +
      '<div class="sfoot"><div class="pro"><div class="pg"></div><div class="pt">Pro Access ' + I('sparkles',12) + '</div>' +
        '<div class="pd">VRF commissioning &amp; live team sync</div><button class="pb">Upgrade Now</button></div>' +
        '<div class="me"><div class="av"><div class="ring"><div class="inner">IS</div></div><div class="st"></div></div>' +
          '<div class="mk"><b>Isaac Smith</b><em>Super Admin</em></div>' + I('settings',16) + '</div></div>' +
    '</aside>';
  };

  // topbar without the New Project button
  window.FG3_TOPBAR = function () {
    return '<header class="topbar" id="fg-topbar">' +
      '<button class="searchbtn" data-cmd><span class="si">' + I('search',18) + '</span>' +
        '<div class="sf">Search workspaces, tools, or ask Tiff...</div>' +
        '<span class="kbd">' + I('command',10) + ' K</span></button>' +
      '<div class="tbr"><button class="bell">' + I('bell',20) + '<span class="d"></span></button></div>' +
    '</header>';
  };

  // stripped dashboard — keep the hero greeting shell, remove all cards (stats, ring, bento)
  function home() {
    const date = new Date().toLocaleDateString('en-AU', { weekday:'long', day:'numeric', month:'long' });
    return '<div class="wrap"><div class="stg">' +
      '<div class="hero"><div class="mesh"><i class="m1"></i><i class="m2"></i><i class="m3"></i></div>' +
        '<div class="hrow"><div class="hlead">' +
          '<div class="pill">' + I('activity',12) + date + '</div>' +
          '<h1>Good morning,<br><span>Isaac.</span></h1>' +
          '<p class="lede">Welcome back. Your workspace is ready.</p>' +
        '</div></div></div>' +
    '</div></div>';
  }

  // small empty-state hint (inline-styled so v3 needs no extra CSS)
  function hint(text) {
    return '<div style="padding:22px;text-align:center;color:#9ca3af;font-size:13px;font-weight:600;border:1.5px dashed #e6e8ee;border-radius:16px;background:linear-gradient(180deg,#fafbfc,#fff)">' + text + '</div>';
  }

  // TOOLBOX — keep the 4 category cards, remove the tool rows inside
  function toolbox() {
    const cats = [
      ['Calculators','calc','#00E5C0','Precise field calculations'],
      ['Troubleshooting','alert','#FF3366','Diagnose & resolve'],
      ['Design Tools','layers','#2E68FF','System design & layout'],
      ['Reference Library','library','#8A2BE2','Specs & standards'],
    ];
    const card = (c) =>
      '<div class="catwrap"><div class="cat spot" style="--sc:' + c[2] + '1f"><span class="sglow"></span>' +
        '<div class="ctop" style="background:' + c[2] + '"></div>' +
        '<div class="cin"><div class="chd"><div class="cic" style="background:' + c[2] + '15;border:1px solid ' + c[2] + '30">' + I(c[1],24) + '</div>' +
          '<div><div class="cht">' + c[0] + '</div><div class="chs">' + c[3] + '</div></div></div>' + hint('No tools yet') + '</div></div></div>';
    return '<div class="wrap"><div class="tbx-head"><div class="stg"><div class="tbx-eb">Field Tools &amp; Reference</div><h1>Toolbox</h1></div>' +
        '<div class="tbx-search">' + I('search',18) + '<input placeholder="Search tools..."></div></div>' +
      '<div class="tbx-grid stgp">' + cats.map(card).join('') + '</div></div>';
  }

  // TIFF AI — keep suggestion cards (icons only, no text), remove knowledge base,
  // recent threads becomes an empty state
  function tiff() {
    const S = [['wrench','#00E5C0','rgba(0,229,192,0.1)'],['zap','#2E68FF','rgba(46,104,255,0.1)'],['alert','#FF3366','rgba(255,51,102,0.1)'],['file','#8A2BE2','rgba(138,43,226,0.1)']];
    const cards = S.map(s => '<button class="tsugg"><span class="tsg" style="background:' + s[1] + '"></span>' +
      '<div class="tsh"><div class="tsi" style="background:' + s[2] + '">' + I(s[0],18) + '</div></div></button>').join('');
    return '<div class="tiff"><div class="tmain"><div class="thero"><div class="o1"></div><div class="o2"></div>' +
        '<div class="trow"><div class="tbot"><div class="tb">' + I('bot',40,1.5) + '</div><div class="tst"><i></i></div></div>' +
          '<div class="tlead"><div class="pill">' + I('fingerprint',12) + 'Tiff AI</div>' +
            '<h2>What are we building today?</h2></div></div></div>' +
        '<div class="tsgrid stgp">' + cards + '</div>' +
        '<div class="tinput"><div class="tib"></div><div class="tin"><div class="tic">' + I('sparkles',20) + '</div>' +
          '<input placeholder="Message Tiff AI..."><button class="tsend">' + I('send',18) + '</button></div></div></div>' +
      '<div class="tside"><div><div class="tsl"><span>Recent Threads</span></div>' +
        '<div style="padding:40px 16px;text-align:center"><b style="display:block;font-size:14px;font-weight:700;color:#9ca3af">Nothing to see here</b><em style="font-style:normal;display:block;font-size:12.5px;color:#d1d5db;margin-top:4px">Your conversations will show up here.</em></div></div></div></div>';
  }

  // ADMIN — blank screen behind the nav button
  function admin() {
    return blank('Admin');
  }

  // DESIGN STUDIO — placeholder only, no page built yet
  function ductr() {
    return blank('Design Studio');
  }

  function blank(title) {
    return '<div class="wrap"><div class="stg">' +
      '<div class="v2head" style="margin-bottom:32px"><div><h1 style="font-size:44px;font-weight:800;letter-spacing:-0.03em;margin:0">' + title + '</h1></div></div>' +
      '<div style="padding:80px 16px;text-align:center;border:1.5px dashed #e6e8ee;border-radius:24px;background:linear-gradient(180deg,#fafbfc,#fff)">' +
        '<b style="display:block;font-size:16px;font-weight:700;color:#6b7280">' + title + '</b>' +
        '<em style="font-style:normal;display:block;font-size:13px;color:#9ca3af;margin-top:6px">Nothing here yet.</em></div>' +
    '</div></div>';
  }

  window.FG3_SCREENS = Object.assign({}, window.FG_SCREENS, { home: home, people: home, toolbox: toolbox, tiff: tiff, admin: admin, ductr: ductr });
})();
