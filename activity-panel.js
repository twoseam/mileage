/**
 * activity-panel.js — the full activity detail as an in-page panel that
 * slides over whatever list opened it (History / Stats Recent), so it
 * tracks your finger like a native iOS push instead of being a page load.
 *
 *   ActivityPanel.open(key[, { animate:false, replace:true }])
 *
 * - Renders the same NRC-style detail as before (hero, stat grid, brand
 *   map + fullscreen, shoe photo + fullscreen).
 * - Drag from the left edge to pop it back; it follows your finger and
 *   snaps. Back button + system/browser back also close it.
 * - history.pushState keeps the URL (?id=) and the back gesture in sync;
 *   the list underneath stays mounted so scroll position is preserved.
 */
(function (global) {
  'use strict';

  var GMAPS_KEY = 'AIzaSyBKFBwCfrXN_FuC7clWzqc8G_p73kpj8oE';
  var A_STYLE = [
    { elementType:'geometry', stylers:[{color:'#ECE0BE'}] },
    { elementType:'labels.text.fill', stylers:[{color:'#3A2E12'}] },
    { elementType:'labels.text.stroke', stylers:[{color:'#F4ECD3'}] },
    { elementType:'labels.icon', stylers:[{visibility:'off'}] },
    { featureType:'administrative', elementType:'geometry.stroke', stylers:[{color:'#B98A3C'}] },
    { featureType:'landscape.natural', elementType:'geometry', stylers:[{color:'#DCD3A6'}] },
    { featureType:'poi', stylers:[{visibility:'off'}] },
    { featureType:'poi.park', elementType:'geometry', stylers:[{color:'#BFD8B8'}] },
    { featureType:'road', elementType:'geometry', stylers:[{color:'#E8C77A'}] },
    { featureType:'road.arterial', elementType:'geometry', stylers:[{color:'#E3B45A'}] },
    { featureType:'road.highway', elementType:'geometry', stylers:[{color:'#E89A1F'}] },
    { featureType:'road', elementType:'labels', stylers:[{visibility:'off'}] },
    { featureType:'transit', stylers:[{visibility:'off'}] },
    { featureType:'water', elementType:'geometry', stylers:[{color:'#8FCFC2'}] }
  ];

  var CSS = [
    'html{overflow-x:hidden;}',  /* the off-screen panel must not add scroll */
    '#apanel{position:fixed;inset:0;z-index:9000;overflow-y:auto;',
    '-webkit-overflow-scrolling:touch;background:#252525;color:#f5f5f5;',
    'transform:translateX(100%);transition:transform .32s cubic-bezier(.2,.8,.2,1);',
    'will-change:transform;}',
    '#apanel.open{transform:translateX(0);}',
    '#apanel.dragging{transition:none;}',
    '#apanel.closing{transform:translateX(100%);}',
    'html[data-theme="light"] #apanel{background:#f1ebdd;color:#171717;}',
    '#apanel::-webkit-scrollbar{display:none;}',
    '#apanel{scrollbar-width:none;}',
    '.ap-back{position:fixed;top:18px;left:18px;z-index:9050;width:42px;height:42px;',
    'padding:0;border:none;border-radius:50%;background:rgba(0,0,0,.45);cursor:pointer;',
    'display:flex;align-items:center;justify-content:center;',
    'box-shadow:0 3px 10px rgba(0,0,0,.35);-webkit-backdrop-filter:blur(4px);backdrop-filter:blur(4px);}',
    '.ap-back::before{content:"";width:11px;height:11px;border-left:2.5px solid #fff;',
    'border-bottom:2.5px solid #fff;transform:translateX(2px) rotate(45deg);border-radius:1px;}',
    '.ap-back:active{transform:scale(.93);}',
    '.a-wrap{max-width:520px;margin:0 auto;min-height:100vh;padding:4.6rem 1.5rem 3rem;}',
    '.a-when{display:flex;align-items:center;gap:.7rem;font-size:.92rem;font-weight:700;letter-spacing:.01em;}',
    '.a-when .wt{opacity:.5;}',
    '.a-name{font-size:2rem;font-weight:900;letter-spacing:-.02em;margin:.35rem 0 1rem;line-height:1.04;}',
    '.a-rule{height:4px;border:none;border-radius:2px;margin:0 0 1.7rem;background:linear-gradient(90deg,',
    '#016074 0 16.66%,#94D3BE 16.66% 33.33%,#E7D7A4 33.33% 50%,',
    '#EB9A00 50% 66.66%,#CA6902 66.66% 83.33%,#B02113 83.33% 100%);}',
    '.a-hero{margin-bottom:1.8rem;}',
    '.a-hero b{display:block;font-size:clamp(3.4rem,18vw,4.6rem);',
    'font-weight:900;letter-spacing:-.02em;line-height:.95;}',
    '.a-hero span{display:block;margin-top:.5rem;font-size:.9rem;font-weight:700;opacity:.5;}',
    '.a-grid{display:grid;grid-template-columns:repeat(3,1fr);row-gap:1.7rem;column-gap:1rem;}',
    '.a-cell b{display:block;font-size:1.55rem;font-weight:900;letter-spacing:-.01em;line-height:1;}',
    '.a-wx{width:30px;height:30px;display:block;color:inherit;margin-bottom:-2px;}',
    '.a-cell span{display:block;margin-top:.4rem;font-size:.78rem;font-weight:800;',
    'letter-spacing:.05em;line-height:1.15;}',
    /* one brand color per row, contrast-picked for the dark surface */
    '.a-grid .a-cell:nth-child(-n+3) span{color:#94D3BE;}',
    '.a-grid .a-cell:nth-child(n+4) span{color:#EB9A00;}',
    'html[data-theme="light"] .a-grid .a-cell:nth-child(-n+3) span{color:#0E7A8C;}',
    'html[data-theme="light"] .a-grid .a-cell:nth-child(n+4) span{color:#C77A0C;}',
    '.a-cell a{color:#8FCFC2;text-decoration:none;}',
    'html[data-theme="light"] .a-cell a{color:#016074;}',
    /* fade + slide cascade (count-up handled in JS) */
    '.a-hero.ap-anim,.a-cell.ap-anim{opacity:0;transform:translateY(8px);}',
    '.a-hero.ap-anim.in,.a-cell.ap-anim.in{opacity:1;transform:none;',
    'transition:opacity .45s ease,transform .45s ease;}',
    '@media (prefers-reduced-motion:reduce){.a-hero.ap-anim,.a-cell.ap-anim{opacity:1;transform:none;}}',
    '.a-notes{margin-top:1.8rem;background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.09);',
    'border-left:3px solid #EB9A00;border-radius:12px;padding:1rem 1.15rem 1.1rem;}',
    'html[data-theme="light"] .a-notes{background:rgba(0,0,0,.035);border-color:rgba(0,0,0,.08);border-left-color:#C77A0C;}',
    '.a-notes-h{font-size:.66rem;font-weight:800;letter-spacing:.16em;text-transform:uppercase;',
    'opacity:.5;margin-bottom:.5rem;}',
    '.a-notes-b{font-size:1.02rem;line-height:1.6;white-space:pre-wrap;word-break:break-word;}',
    '.a-shoe{margin-top:1.8rem;padding-top:1.4rem;border-top:1px solid rgba(255,255,255,.12);}',
    'html[data-theme="light"] .a-notes,html[data-theme="light"] .a-shoe{border-top-color:rgba(0,0,0,.12);}',
    '.a-shoe .snm{font-size:1.4rem;font-weight:900;letter-spacing:-.01em;}',
    '.a-shoe .smd{font-size:.95rem;font-weight:600;opacity:.55;margin-top:.2rem;}',
    '.a-shoe-pic{position:relative;margin:1.2rem -1.5rem 0;overflow:hidden;}',
    '.a-shoe-pic img{display:block;width:100%;aspect-ratio:1/1;object-fit:cover;}',
    '.a-shoe-full{position:absolute;top:10px;right:10px;width:34px;height:34px;padding:0;',
    'border:none;border-radius:8px;background:rgba(0,0,0,.5);color:#fff;font-size:.95rem;',
    'cursor:pointer;display:flex;align-items:center;justify-content:center;box-shadow:0 2px 6px rgba(0,0,0,.35);}',
    '.a-map{position:relative;height:340px;margin:1.6rem 0;background:rgba(255,255,255,.05);',
    'border-radius:16px;overflow:hidden;}',
    'html[data-theme="light"] .a-map{background:rgba(0,0,0,.06);}',
    '.a-map-canvas{position:absolute;inset:0;}',
    '.a-map-full{position:absolute;top:10px;right:10px;z-index:400;width:36px;height:36px;',
    'padding:0;border:none;border-radius:8px;background:rgba(0,0,0,.55);color:#fff;font-size:1rem;',
    'line-height:1;cursor:pointer;display:flex;align-items:center;justify-content:center;',
    'box-shadow:0 2px 6px rgba(0,0,0,.35);}',
    '.a-type{display:inline-block;flex:0 0 auto;font-size:.55rem;letter-spacing:.12em;',
    'text-transform:uppercase;font-weight:800;padding:3px 9px;border-radius:999px;color:#1a1a1a;background:#8FCFC2;}',
    '.a-type.run{background:#E7D7A4;}',
    '.a-msg{text-align:center;opacity:.5;padding:6rem 1rem;font-size:.95rem;}',
    '#afull{display:none;position:fixed;inset:0;z-index:10001;background:#ECE0BE;}',
    '#afull.show{display:block;}',
    '#afull-map{position:absolute;inset:0;}',
    '.afull-x,#sfull .sx{position:absolute;top:16px;right:16px;z-index:2;width:42px;height:42px;',
    'padding:0;border:none;border-radius:50%;background:rgba(0,0,0,.6);cursor:pointer;',
    'box-shadow:0 2px 8px rgba(0,0,0,.45);}',
    '.afull-x::before,.afull-x::after,#sfull .sx::before,#sfull .sx::after{content:"";position:absolute;',
    'top:50%;left:50%;width:18px;height:2px;border-radius:1px;background:#fff;}',
    '.afull-x::before,#sfull .sx::before{transform:translate(-50%,-50%) rotate(45deg);}',
    '.afull-x::after,#sfull .sx::after{transform:translate(-50%,-50%) rotate(-45deg);}',
    '#sfull{display:none;position:fixed;inset:0;z-index:10001;background:rgba(10,10,10,.96);',
    'align-items:center;justify-content:center;padding:1.5rem;}',
    '#sfull.show{display:flex;}',
    '#sfull img{max-width:100%;max-height:100%;object-fit:contain;}',
    '@media (prefers-reduced-motion: reduce){#apanel{transition:none;}}'
  ].join('');

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"]/g, function(c) {
      return { '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;' }[c];
    });
  }
  function dParts(d) {
    var m = String(d || '').match(/(\d{4})-(\d{2})-(\d{2})/);
    return m ? { y:+m[1], mo:+m[2]-1, da:+m[3] } : null;
  }
  function dShort(d) {
    var p = dParts(d); if (!p) return String(d || '');
    return (p.mo + 1) + '/' + p.da + '/' + String(p.y).slice(-2);
  }
  function weekday(d) {
    var p = dParts(d); if (!p) return '';
    return new Date(p.y, p.mo, p.da, 12).toLocaleDateString('en-US', { weekday:'long' });
  }
  function title(r) {
    var t = String(r.start_time || '').match(/^(\d{1,2}):/);
    var part = '';
    if (t) {
      var h = +t[1];
      part = h < 12 ? 'Morning' : (h < 17 ? 'Afternoon' : (h < 21 ? 'Evening' : 'Night'));
    }
    return [weekday(r.date), part].filter(Boolean).join(' ');
  }
  function t12(t) {
    var m = String(t || '').match(/^(\d{1,2}):(\d{2})/);
    if (!m) return '';
    var h = +m[1], ap = h < 12 ? 'AM' : 'PM', h12 = (h % 12) || 12;
    return h12 + ':' + m[2] + ' ' + ap;
  }
  function keyOf(r) {
    if (r.activity_id) return String(r.activity_id);
    return [r.date, r.miles, r.start_time || ''].join('|');
  }
  function shoeIndex(shoes) {
    var idx = {};
    (shoes || []).forEach(function(s) {
      [s.display, s.name].concat(s.matchKeys || []).forEach(function(k) {
        if (k) idx[String(k).trim().toLowerCase()] = s;
      });
    });
    return idx;
  }

  var _gmP = null;
  function loadGMaps() {
    if (_gmP) return _gmP;
    if (!GMAPS_KEY) return Promise.reject('no key');
    _gmP = new Promise(function(res, rej) {
      var s = document.createElement('script');
      s.src = 'https://maps.googleapis.com/maps/api/js?key=' +
              encodeURIComponent(GMAPS_KEY) + '&v=quarterly';
      s.async = true; s.defer = true;
      s.onload = function() { (window.google && google.maps) ? res(google.maps) : rej('x'); };
      s.onerror = function() { rej('x'); };
      document.head.appendChild(s);
    });
    return _gmP;
  }
  function drawMap(el, pts, interactive) {
    return loadGMaps().then(function(gm) {
      var m = new gm.Map(el, {
        disableDefaultUI: true, clickableIcons: false, keyboardShortcuts: false,
        gestureHandling: interactive ? 'greedy' : 'none',
        disableDoubleClickZoom: !interactive,
        backgroundColor: '#ECE0BE', styles: A_STYLE
      });
      var path = pts.map(function(p) { return { lat:p[0], lng:p[1] }; });
      new gm.Polyline({ path:path, map:m, strokeColor:'#B02113',
        strokeOpacity:0.95, strokeWeight:4 });
      var b = new gm.LatLngBounds();
      path.forEach(function(p) { b.extend(p); });
      m.fitBounds(b, 24);
      return m;
    });
  }

  var elPanel, elContent, elAfull, elSfull, mounted = false, curPts = null;

  function mount() {
    if (mounted) return;
    mounted = true;
    var st = document.createElement('style');
    st.id = 'ap-style'; st.textContent = CSS;
    document.head.appendChild(st);

    elPanel = document.createElement('div');
    elPanel.id = 'apanel';
    elPanel.innerHTML =
      '<button class="ap-back" type="button" aria-label="Back"></button>' +
      '<div class="a-wrap"><div id="ap-content"><div class="a-msg">Loading…</div></div></div>';
    document.body.appendChild(elPanel);

    elSfull = document.createElement('div');
    elSfull.id = 'sfull';
    elSfull.innerHTML = '<img alt=""><button class="sx" type="button" aria-label="Close"></button>';
    document.body.appendChild(elSfull);

    elAfull = document.createElement('div');
    elAfull.id = 'afull';
    elAfull.innerHTML =
      '<div id="afull-map"></div>' +
      '<button class="afull-x" type="button" aria-label="Close map"></button>';
    document.body.appendChild(elAfull);

    elContent = elPanel.querySelector('#ap-content');

    elPanel.querySelector('.ap-back').addEventListener('click', requestClose);
    elAfull.querySelector('.afull-x').addEventListener('click', function() {
      elAfull.classList.remove('show');
    });
    elSfull.addEventListener('click', function() { elSfull.classList.remove('show'); });

    wireDrag();
  }

  function render(r, shoeIdx) {
    var isRun = r.type === 'Run';
    var miles = (parseFloat(r.miles) || 0).toFixed(2);
    var aid = String(r.activity_id || '').trim();

    var shoeBlock = '';
    if (r.shoe) {
      var so = shoeIdx[String(r.shoe).trim().toLowerCase()];
      var snm = esc((so && (so.display || so.name)) || r.shoe);
      var smd = so ? esc(((so.brand || '') + ' ' + (so.model || '')).trim()) : '';
      var pic = '';
      if (so && so.photo) {
        var ps = esc(so.photo);
        pic = '<div class="a-shoe-pic">' +
          '<img src="' + ps + '" alt="" loading="lazy" ' +
            'onerror="this.closest(\'.a-shoe-pic\').style.display=\'none\'">' +
          '<button class="a-shoe-full" type="button" aria-label="View photo" ' +
            'data-shoe="' + ps + '">⤢</button></div>';
      }
      shoeBlock = '<div class="a-shoe"><div class="snm">' + snm + '</div>' +
        (smd && smd.toLowerCase() !== snm.toLowerCase()
          ? '<div class="smd">' + smd + '</div>' : '') + pic + '</div>';
    }

    var num = function(v) { return (v != null && v !== '') ? v : ''; };
    function cell(label, val) {
      if (val === '' || val == null) return '';
      return '<div class="a-cell"><b>' + val + '</b><span>' + label + '</span></div>';
    }
    function weatherIcon(w) {
      var key = String(w || '').trim().toLowerCase();
      var sun  = '<circle cx="12" cy="12" r="4.2"/><path d="M12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2M5.3 5.3l1.4 1.4M17.3 17.3l1.4 1.4M18.7 5.3l-1.4 1.4M6.7 17.3l-1.4 1.4"/>';
      var cloud = '<path d="M7 18h9.5a3.5 3.5 0 0 0 .5-6.96A5 5 0 0 0 7.2 9.2 3.9 3.9 0 0 0 7 18z"/>';
      var drops = '<path d="M9 20l-1 2M13 20l-1 2M17 20l-1 2"/>';
      var rain  = '<path d="M9 20l-1.3 2.5M13 20l-1.3 2.5M17 20l-1.3 2.5"/>';
      var bolt  = '<path d="M13 19l-3 4 1-3H8l3-4"/>';
      var flake = '<path d="M12 18v5M9.5 19.3l5 2.4M14.5 19.3l-5 2.4"/>';
      var fog   = '<path d="M6 20h12M7 23h10"/>';
      var SET = {
        'clear':       sun,
        'sunny':       sun,
        'cloudy':      cloud,
        'partly cloudy': cloud,
        'overcast':    cloud,
        'fog':         cloud + fog,
        'mist':        cloud + fog,
        'haze':        cloud + fog,
        'drizzle':     cloud + drops,
        'showers':     cloud + drops,
        'rain':        cloud + rain,
        'thunder':     cloud + bolt,
        'thunderstorm':cloud + bolt,
        'snow':        cloud + flake,
        'snow showers':cloud + flake,
        'sleet':       cloud + flake
      };
      var body = SET[key];
      if (!body) return '';
      return '<svg class="a-wx" viewBox="0 0 24 24" title="' + esc(w) + '" ' +
             'fill="none" stroke="currentColor" stroke-width="1.7" ' +
             'stroke-linecap="round" stroke-linejoin="round">' + body + '</svg>';
    }
    function cadence(r) {
      var st = parseFloat(r.steps); if (!(st > 0)) return '';
      var mi = parseFloat(r.miles) || 0;
      var pm = /^(\d{1,3}):(\d{2})$/.exec(String(r.pace || '').trim());
      var ps = pm ? (+pm[1]) * 60 + (+pm[2]) : null, min = null;
      if (ps > 0 && mi > 0) min = ps * mi / 60;
      if (min == null) {
        var d = String(r.duration || '').split(':').map(Number);
        if (d.length === 3 && d.every(function (x) { return !isNaN(x); })) min = (d[0] * 3600 + d[1] * 60 + d[2]) / 60;
        else if (d.length === 2 && d.every(function (x) { return !isNaN(x); })) min = (d[0] * 60 + d[1]) / 60;
      }
      if (min == null) { var sp = parseFloat(r.avg_speed); if (sp > 0 && mi > 0) min = mi / sp * 60; }
      return (min && min > 0) ? Math.round(st / min) + ' spm' : '';
    }
    var when = esc(dShort(r.date)) + (t12(r.start_time) ? ' · ' + t12(r.start_time) : '');
    var primary =
      cell('Avg HR', num(r.avg_hr) !== '' ? Math.round(r.avg_hr) : '') +
      cell('Avg. Pace', r.pace ? esc(r.pace) : '') +
      cell('Time', r.duration ? esc(r.duration) : '') +
      cell('Calories', num(r.calories) !== '' ? Math.round(r.calories) : '') +
      cell('Cadence', cadence(r)) +
      cell('Steps', num(r.steps) !== '' ? Math.round(r.steps).toLocaleString() : '');
    var secondary =
      cell('Start', t12(r.start_time)) +
      cell('End', t12(r.end_time)) +
      cell('Elevation Gain', num(r.ascent) !== '' ? Math.round(r.ascent) + ' ft' : '') +
      cell('Temp', (r.temp_f != null && r.temp_f !== '') ? Math.round(r.temp_f) + '°F' : '') +
      cell('Conditions', r.weather ? (weatherIcon(r.weather) || esc(r.weather))
            : ((r.temp_f != null && r.temp_f !== '') ? '—' : ''));

    elContent.innerHTML =
      '<div class="a-when"><span class="wt">' + when + '</span>' +
        '<span class="a-type' + (isRun ? ' run' : '') + '">' +
          (isRun ? 'Run' : 'Walk') + '</span></div>' +
      '<div class="a-name">' + esc(title(r)) + '</div>' +
      '<hr class="a-rule">' +
      '<div class="a-hero' + (isRun ? ' run' : '') + '"><b>' + miles +
        '</b><span>Miles</span></div>' +
      (primary ? '<div class="a-grid">' + primary + '</div>' : '') +
      (aid ? '<div class="a-map"><div id="ap-map" class="a-map-canvas"></div>' +
             '<button class="a-map-full" type="button" aria-label="Fullscreen map">⤢</button></div>' : '') +
      (secondary ? '<div class="a-grid">' + secondary + '</div>' : '') +
      (r.notes ? '<div class="a-notes"><div class="a-notes-h">Notes</div>' +
                 '<div class="a-notes-b">' + esc(r.notes) + '</div></div>' : '') +
      shoeBlock;

    elPanel.scrollTop = 0;
    curPts = null;

    var sf = elContent.querySelector('.a-shoe-full');
    if (sf) sf.addEventListener('click', function() {
      elSfull.querySelector('img').src = sf.getAttribute('data-shoe');
      elSfull.classList.add('show');
    });
    var mf = elContent.querySelector('.a-map-full');
    if (mf) mf.addEventListener('click', function() {
      if (!curPts) return;
      var em = elAfull.querySelector('#afull-map');
      em.innerHTML = ''; elAfull.classList.add('show');
      drawMap(em, curPts, true).catch(function() { elAfull.classList.remove('show'); });
    });

    animateIn();

    if (aid) {
      fetch('routes/' + encodeURIComponent(aid) + '.json')
        .then(function(res) { if (!res.ok) throw 0; return res.json(); })
        .then(function(pts) {
          if (!pts || pts.length < 2) { hideMap(); return; }
          curPts = pts;
          drawMap(elContent.querySelector('#ap-map'), pts).catch(hideMap);
        })
        .catch(hideMap);
    }
  }

  // count a numeric <b> up from 0; leaves pace/time/text untouched
  function countEl(host) {
    var b = host.querySelector('b'); if (!b) return;
    var raw = b.textContent.trim();
    if (raw.indexOf(':') !== -1) return;                 // pace / time
    var m = raw.match(/^([\d,]+(?:\.\d+)?)(.*)$/);
    if (!m) return;                                      // non-numeric
    var target = parseFloat(m[1].replace(/,/g, ''));
    if (isNaN(target)) return;
    var dec = (m[1].split('.')[1] || '').length;
    var suffix = m[2] || '', dur = 850, t0 = null;
    b.textContent = (dec ? (0).toFixed(dec) : '0') + suffix;
    requestAnimationFrame(function step(now) {
      if (t0 === null) t0 = now;
      var t = Math.min(1, (now - t0) / dur), e = 1 - Math.pow(1 - t, 3);
      var v = target * e;
      b.textContent = (dec ? v.toFixed(dec)
                           : Math.round(v).toLocaleString()) + suffix;
      if (t < 1) requestAnimationFrame(step);
    });
  }

  // stagger hero + every stat cell so they cascade in
  function animateIn() {
    var seq = [];
    var hero = elContent.querySelector('.a-hero');
    if (hero) seq.push(hero);
    [].forEach.call(elContent.querySelectorAll('.a-cell'), function(c) {
      seq.push(c);
    });
    seq.forEach(function(el) { el.classList.add('ap-anim'); });
    seq.forEach(function(el, i) {
      setTimeout(function() {
        el.classList.add('in');
        countEl(el);
      }, 90 + i * 55);
    });
  }
  function hideMap() {
    var mp = elContent.querySelector('.a-map');
    if (mp) mp.style.display = 'none';
  }

  function loadAndRender(key) {
    var rowsIn = null, shoesIn = null, done = false;
    function go(finalCall) {
      if (done) return;
      if (!finalCall && (rowsIn == null || shoesIn == null)) return;
      var rows = rowsIn || [], shoes = shoesIn || [], match = null;
      for (var i = 0; i < rows.length; i++) {
        if (keyOf(rows[i]) === key) { match = rows[i]; break; }
      }
      if (match) { done = true; render(match, shoeIndex(shoes)); }
      else if (finalCall) {
        done = true;
        elContent.innerHTML = '<div class="a-msg">That activity couldn’t be found.</div>';
      }
    }
    setTimeout(function() { go(true); }, 12000);
    MilesTracker.fetchAllEntries(function(rows) { rowsIn = rows || []; go(false); });
    MilesTracker.fetchShoes(function(shoes) { shoesIn = shoes || []; go(false); });
  }

  /* ---- history-synced open / close ---- */
  var isOpen = false, suppressPop = false, pushedEntry = false;

  function visualClose(cb) {
    if (!elPanel) return;
    elPanel.classList.remove('dragging');
    elPanel.style.transform = '';
    elPanel.classList.add('closing');
    isOpen = false; pushedEntry = false;
    setTimeout(function() {
      elPanel.classList.remove('open', 'closing');
      elContent.innerHTML = '<div class="a-msg">Loading…</div>';
      if (cb) cb();
    }, 340);
  }

  // user asked to leave (back button / drag past threshold / Esc)
  function requestClose() {
    if (!isOpen) return;
    if (pushedEntry) {
      history.back();              // → popstate → visualClose (list still mounted)
    } else {
      // deep link / shared URL: no list underneath to return to
      visualClose(function() { location.replace('history.html'); });
    }
  }

  window.addEventListener('popstate', function() {
    if (suppressPop) { suppressPop = false; return; }
    if (isOpen && !(history.state && history.state.apanel)) visualClose();
  });

  /* ---- drag-to-dismiss (follows the finger) ---- */
  function wireDrag() {
    var startX = 0, startY = 0, dx = 0, tracking = false, decided = false, horiz = false;
    elPanel.addEventListener('touchstart', function(e) {
      if (!isOpen || elAfull.classList.contains('show') ||
          elSfull.classList.contains('show')) return;
      var t = e.touches[0];
      // start a pop only from the left edge (like iOS) so it doesn't
      // fight vertical scrolling or the map
      if (t.clientX > 32) return;
      startX = t.clientX; startY = t.clientY;
      dx = 0; tracking = true; decided = false; horiz = false;
      elPanel.classList.add('dragging');
    }, { passive: true });

    elPanel.addEventListener('touchmove', function(e) {
      if (!tracking) return;
      var t = e.touches[0];
      var mx = t.clientX - startX, my = t.clientY - startY;
      if (!decided) {
        decided = true;
        horiz = Math.abs(mx) > Math.abs(my);
        if (!horiz) { tracking = false; elPanel.classList.remove('dragging'); return; }
      }
      dx = Math.max(0, mx);
      if (e.cancelable) e.preventDefault();
      elPanel.style.transform = 'translateX(' + dx + 'px)';
    }, { passive: false });

    function end() {
      if (!tracking) return;
      tracking = false;
      elPanel.classList.remove('dragging');
      var w = elPanel.offsetWidth || window.innerWidth;
      if (dx > w * 0.32) {
        // continue the motion off-screen, then sync history
        elPanel.style.transform = '';
        requestClose();
      } else {
        elPanel.style.transform = '';   // snaps back to .open (translateX 0)
      }
      dx = 0;
    }
    elPanel.addEventListener('touchend', end);
    elPanel.addEventListener('touchcancel', end);
  }

  /* ---- shared Static Maps thumbnail (real water/roads, brand-styled) ---- */
  function encPoly(pts) {
    var lastLat = 0, lastLon = 0, out = '';
    function enc(v) {
      v = v < 0 ? ~(v << 1) : (v << 1);
      var s = '';
      while (v >= 0x20) { s += String.fromCharCode((0x20 | (v & 0x1f)) + 63); v >>>= 5; }
      return s + String.fromCharCode(v + 63);
    }
    pts.forEach(function(p) {
      var la = Math.round(p[0] * 1e5), lo = Math.round(p[1] * 1e5);
      out += enc(la - lastLat) + enc(lo - lastLon);
      lastLat = la; lastLon = lo;
    });
    return out;
  }
  var _styleParams = null;
  function styleParams() {
    if (_styleParams != null) return _styleParams;
    _styleParams = A_STYLE.map(function(s) {
      var parts = [];
      if (s.featureType) parts.push('feature:' + s.featureType);
      if (s.elementType) parts.push('element:' + s.elementType);
      (s.stylers || []).forEach(function(st) {
        for (var k in st) {
          var v = st[k];
          if (k === 'color') v = '0x' + String(v).replace('#', '');
          parts.push(k + ':' + v);
        }
      });
      return 'style=' + encodeURIComponent(parts.join('|'));
    }).join('&');
    return _styleParams;
  }

  var ActivityPanel = {
    // Brand-styled Static Maps picture of a route (real water/roads).
    staticMapUrl: function (pts) {
      if (!GMAPS_KEY || !pts || pts.length < 2) return '';
      var path = 'path=' + encodeURIComponent(
        'color:0xB02113ff|weight:4|enc:' + encPoly(pts));
      return 'https://maps.googleapis.com/maps/api/staticmap' +
        '?size=200x200&scale=2&maptype=roadmap&' +
        path + '&' + styleParams() + '&key=' + encodeURIComponent(GMAPS_KEY);
    },

    open: function (key, opts) {
      opts = opts || {};
      mount();
      loadAndRender(key);
      var url = location.pathname + '?id=' + encodeURIComponent(key);
      if (opts.replace || (history.state && history.state.apanel)) {
        history.replaceState({ apanel: key }, '', url);
        // keep whatever pushedEntry was (replace doesn't add an entry)
      } else {
        history.pushState({ apanel: key }, '', url);
        pushedEntry = true;
      }
      isOpen = true;
      elPanel.classList.remove('closing');
      if (opts.animate === false) {
        elPanel.style.transition = 'none';
        elPanel.classList.add('open');
        // re-enable transition next frame for the eventual close
        requestAnimationFrame(function() {
          requestAnimationFrame(function() { elPanel.style.transition = ''; });
        });
      } else {
        requestAnimationFrame(function() {
          requestAnimationFrame(function() { elPanel.classList.add('open'); });
        });
      }
    }
  };

  global.ActivityPanel = ActivityPanel;
})(window);
