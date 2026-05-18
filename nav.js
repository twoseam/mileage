/**
 * nav.js — shared bottom tab bar + swipe-up drawer.
 *
 * Drop into any page with <script src="nav.js"></script>. Injects a
 * fixed bottom navigation bar (pictograph + label per page) that sits on
 * top of the content, a yellow bar marking the current page, and a
 * swipe-up sheet holding the light/dark toggle and the version link.
 * Also keeps the theme system and the PWA pull-to-refresh.
 */

(function() {
  'use strict';

  // Each page: href, label, and inline SVG body (24x24 viewBox).
  var PAGES = [
    { href: 'index.html', label: 'Entry',
      icon: '<path d="M12 5v14M5 12h14"/>' },
    { href: 'stats.html', label: 'Stats',
      icon: '<path d="M4 20h16M7.5 20v-7M12 20V5M16.5 20v-9"/>' },
    { href: 'trends.html', label: 'Trends',
      icon: '<path d="M4 16l5-5 4 3 7-8"/><path d="M16 6h4v4"/>' },
    { href: 'history.html', label: 'History',
      icon: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3.5 2"/>' },
    { href: 'shoes.html', label: 'Shoes',
      icon: '<path d="M3 16.4c0-.9.4-1.7 1.1-2.2L8 11l2 1.3L12.6 9l3 3.2c2.2.5 4.3 1 5.4 2.3.5.6.6 1.3.6 2v1.4H3z"/><path d="M3 18.7h18"/>' }
  ];

  var VERSION = 'v4.13.1';

  /* ===================== Theme (light / dark) ===================== */
  var THEME_KEY = 'mt-theme';
  function readTheme() {
    try {
      var t = localStorage.getItem(THEME_KEY);
      return t === 'light' ? 'light' : 'dark';
    } catch (e) { return 'dark'; }
  }
  var DARK_BG = '#252525';
  function applyTheme(t) {
    document.documentElement.setAttribute('data-theme', t);
    var m = document.querySelector('meta[name="theme-color"]');
    if (!m) {
      m = document.createElement('meta');
      m.setAttribute('name', 'theme-color');
      document.head.appendChild(m);
    }
    m.setAttribute('content', t === 'light' ? LIGHT_BG : DARK_BG);
  }
  function saveTheme(t) {
    try { localStorage.setItem(THEME_KEY, t); } catch (e) {}
  }

  var LIGHT_BG     = '#f1ebdd';
  var LIGHT_TEXT   = '#171717';
  var LIGHT_SURF   = '#fffdf7';
  var LIGHT_BORDER = 'rgba(0, 0, 0, 0.10)';
  var LIGHT_ACCENT = '#C77A0C';

  var themeCss = [
    'body { transition: background-color 0.25s ease, color 0.25s ease; }',
    'html[data-theme="light"] body {',
    '  background: ' + LIGHT_BG + ' !important; color: ' + LIGHT_TEXT + ' !important;',
    '}',
    // bottom bar + sheet in light mode
    'html[data-theme="light"] #mt-tabbar {',
    '  background: ' + LIGHT_SURF + '; border-top-color: ' + LIGHT_BORDER + ';',
    '}',
    'html[data-theme="light"] .mt-tab { color: ' + LIGHT_TEXT + '; }',
    'html[data-theme="light"] #mt-sheet {',
    '  background: ' + LIGHT_SURF + '; color: ' + LIGHT_TEXT + ';',
    '}',
    'html[data-theme="light"] .mt-sheet-grab { background: rgba(0,0,0,0.18); }',
    'html[data-theme="light"] #mt-sheet-bd { background: rgba(0,0,0,0.32); }',
    'html[data-theme="light"] .mt-sheet-ver { color: ' + LIGHT_TEXT + '; }',
    'html[data-theme="light"] .mt-footer .mt-ver { color: ' + LIGHT_TEXT + '; }',
    // theme switch control
    '#mt-theme-switch {',
    '  display: flex; align-items: center; gap: 10px;',
    '  background: none; border: none; padding: 0; margin: 0;',
    '  cursor: pointer; color: inherit;',
    '}',
    '#mt-theme-switch .mt-ts-ico { font-size: 0.95rem; line-height: 1; opacity: 0.7; }',
    '#mt-theme-switch .mt-ts-track {',
    '  position: relative; width: 44px; height: 24px; border-radius: 999px;',
    '  background: rgba(255, 255, 255, 0.16); transition: background 0.2s ease;',
    '}',
    'html[data-theme="light"] #mt-theme-switch .mt-ts-track {',
    '  background: rgba(0, 0, 0, 0.16);',
    '}',
    '#mt-theme-switch .mt-ts-knob {',
    '  position: absolute; top: 3px; left: 3px;',
    '  width: 18px; height: 18px; border-radius: 50%;',
    '  background: #E89A1F;',
    '  transition: transform 0.22s cubic-bezier(0.2, 0.8, 0.2, 1);',
    '}',
    'html[data-theme="light"] #mt-theme-switch .mt-ts-knob {',
    '  transform: translateX(20px);',
    '}'
  ].join('\n');

  var theme = readTheme();
  applyTheme(theme);
  (function injectThemeStyle() {
    var s = document.createElement('style');
    s.id = 'mt-theme-style';
    s.textContent = themeCss;
    (document.head || document.documentElement).appendChild(s);
  })();

  var BAR_H = 62;   // px (excludes the iOS safe-area inset added below)
  var BAR_LIFT = 12; // extra bottom pad so the row floats off the edge
  // total reserved height below content
  var BAR_PAD = 'calc(env(safe-area-inset-bottom, 0px) + ' + BAR_LIFT + 'px)';

  var css = [
    // content must clear the fixed bar
    'body { padding-bottom: calc(' + BAR_H + 'px + ' + BAR_PAD + '); }',

    '#mt-tabbar {',
    '  position: fixed; left: 0; right: 0; bottom: 0; z-index: 8000;',
    '  height: calc(' + BAR_H + 'px + ' + BAR_PAD + ');',
    '  padding-bottom: ' + BAR_PAD + ';',
    '  display: flex; align-items: stretch;',
    '  background: #1c1c1c; color: #f5f5f5;',
    '  border-top: 1px solid rgba(255, 255, 255, 0.07);',
    '  box-shadow: 0 -6px 20px rgba(0, 0, 0, 0.28);',
    '  touch-action: none;',
    '}',
    '.mt-tab {',
    '  flex: 1; position: relative;',
    '  display: flex; flex-direction: column;',
    '  align-items: center; justify-content: center; gap: 3px;',
    '  background: none; border: none; cursor: pointer;',
    '  color: inherit; font-family: inherit; text-decoration: none;',
    '  opacity: 0.5; -webkit-tap-highlight-color: transparent;',
    '  transition: opacity 0.15s ease;',
    '}',
    '.mt-tab.active { opacity: 1; }',
    '.mt-tab svg {',
    '  width: 23px; height: 23px; display: block;',
    '  fill: none; stroke: currentColor; stroke-width: 2;',
    '  stroke-linecap: round; stroke-linejoin: round;',
    '}',
    '.mt-tab-lbl {',
    '  font-size: 0.58rem; font-weight: 800;',
    '  letter-spacing: 0.06em; text-transform: uppercase;',
    '}',
    // the yellow current-page bar
    '.mt-tab-ind {',
    '  position: absolute; top: 0; left: 50%; transform: translateX(-50%);',
    '  width: 26px; height: 3px; border-radius: 0 0 3px 3px;',
    '  background: #F7C948; opacity: 0;',
    '  transition: opacity 0.15s ease;',
    '}',
    '.mt-tab.active .mt-tab-ind { opacity: 1; }',
    // grab handle (signifies swipe-up)
    '.mt-grab {',
    '  position: absolute; top: 6px; left: 50%; transform: translateX(-50%);',
    '  width: 38px; height: 4px; border-radius: 2px;',
    '  background: rgba(255, 255, 255, 0.22);',
    '}',

    '#mt-sheet-bd {',
    '  position: fixed; inset: 0; z-index: 8090;',
    '  background: rgba(0, 0, 0, 0.5);',
    '  -webkit-backdrop-filter: blur(3px); backdrop-filter: blur(3px);',
    '  opacity: 0; pointer-events: none; transition: opacity 0.25s ease;',
    '}',
    '#mt-sheet-bd.show { opacity: 1; pointer-events: auto; }',
    '#mt-sheet {',
    '  position: fixed; left: 0; right: 0; bottom: 0; z-index: 8100;',
    '  background: #1c1c1c; color: #f5f5f5;',
    '  border-radius: 20px 20px 0 0;',
    '  padding: 14px 1.6rem calc(1.6rem + env(safe-area-inset-bottom, 0px));',
    '  transform: translateY(110%);',
    '  transition: transform 0.32s cubic-bezier(0.2, 0.8, 0.2, 1);',
    '  box-shadow: 0 -16px 48px rgba(0, 0, 0, 0.45);',
    '}',
    '#mt-sheet.show { transform: translateY(0); }',
    '#mt-sheet.dragging { transition: none; }',
    '.mt-sheet-grab {',
    '  width: 44px; height: 5px; border-radius: 3px; margin: 0 auto 1.4rem;',
    '  background: rgba(255, 255, 255, 0.22);',
    '}',
    '.mt-sheet-row {',
    '  display: flex; align-items: center; justify-content: space-between;',
    '  padding: 0.7rem 0; gap: 1rem;',
    '}',
    '.mt-sheet-row + .mt-sheet-row {',
    '  border-top: 1px solid rgba(255, 255, 255, 0.08);',
    '}',
    'html[data-theme="light"] .mt-sheet-row + .mt-sheet-row {',
    '  border-top-color: ' + LIGHT_BORDER + ';',
    '}',
    '.mt-sheet-k {',
    '  font-size: 0.7rem; font-weight: 800; letter-spacing: 0.12em;',
    '  text-transform: uppercase; opacity: 0.55;',
    '}',
    '.mt-sheet-ver {',
    '  color: inherit; text-decoration: none; font-weight: 800;',
    '  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;',
    '  letter-spacing: 0.08em; opacity: 0.85;',
    '}'
  ].join('\n');

  function inject() {
    var style = document.createElement('style');
    style.textContent = css;
    document.head.appendChild(style);

    var path = window.location.pathname.split('/').pop() || 'index.html';
    if (path === '' || path === '/') path = 'index.html';

    var tabsHtml = PAGES.map(function(p) {
      var active = (p.href === path) ? ' active' : '';
      return '<a class="mt-tab' + active + '" href="' + p.href + '">' +
        '<span class="mt-tab-ind"></span>' +
        '<svg viewBox="0 0 24 24">' + p.icon + '</svg>' +
        '<span class="mt-tab-lbl">' + p.label + '</span>' +
      '</a>';
    }).join('');

    var html = '' +
      '<nav id="mt-tabbar"><div class="mt-grab"></div>' + tabsHtml + '</nav>' +
      '<div id="mt-sheet-bd"></div>' +
      '<div id="mt-sheet">' +
        '<div class="mt-sheet-grab"></div>' +
        '<div class="mt-sheet-row">' +
          '<span class="mt-sheet-k">Appearance</span>' +
          '<button id="mt-theme-switch" type="button" role="switch" ' +
                  'aria-label="Switch between light and dark mode">' +
            '<span class="mt-ts-ico">☾</span>' +
            '<span class="mt-ts-track"><span class="mt-ts-knob"></span></span>' +
            '<span class="mt-ts-ico">☀</span>' +
          '</button>' +
        '</div>' +
        '<div class="mt-sheet-row">' +
          '<span class="mt-sheet-k">Version history</span>' +
          '<a class="mt-sheet-ver" href="changelog.html">' + VERSION + '</a>' +
        '</div>' +
      '</div>';
    document.body.insertAdjacentHTML('beforeend', html);

    var bar    = document.getElementById('mt-tabbar');
    var sheet  = document.getElementById('mt-sheet');
    var sheetB = document.getElementById('mt-sheet-bd');

    function openSheet()  { sheet.classList.add('show'); sheetB.classList.add('show'); }
    function closeSheet() { sheet.classList.remove('show'); sheetB.classList.remove('show'); }
    sheetB.addEventListener('click', closeSheet);

    // Theme switch lives in the sheet now
    var themeSwitch = document.getElementById('mt-theme-switch');
    function syncSwitch() {
      themeSwitch.setAttribute('aria-checked', theme === 'light' ? 'true' : 'false');
    }
    syncSwitch();
    themeSwitch.addEventListener('click', function() {
      theme = (theme === 'light') ? 'dark' : 'light';
      applyTheme(theme); saveTheme(theme); syncSwitch();
    });

    // --- swipe up on the bar opens the sheet; drag the sheet down closes ---
    var sy = 0, tracking = false, sdy = 0;
    bar.addEventListener('touchstart', function(e) {
      sy = e.touches[0].clientY; tracking = true;
    }, { passive: true });
    bar.addEventListener('touchmove', function(e) {
      if (!tracking) return;
      if (sy - e.touches[0].clientY > 36) { tracking = false; openSheet(); }
    }, { passive: true });
    bar.addEventListener('touchend', function() { tracking = false; });
    // tapping the handle also opens (discoverable without the gesture)
    bar.querySelector('.mt-grab').addEventListener('click', function(e) {
      e.preventDefault(); e.stopPropagation(); openSheet();
    });

    sheet.addEventListener('touchstart', function(e) {
      sdy = e.touches[0].clientY; sheet.classList.add('dragging');
    }, { passive: true });
    sheet.addEventListener('touchmove', function(e) {
      var d = e.touches[0].clientY - sdy;
      if (d > 0) sheet.style.transform = 'translateY(' + d + 'px)';
    }, { passive: true });
    sheet.addEventListener('touchend', function(e) {
      sheet.classList.remove('dragging');
      sheet.style.transform = '';
      var d = (e.changedTouches[0] || {}).clientY - sdy;
      if (d > 70) closeSheet();
    });

    // Single source of truth for any in-page version stamps.
    document.querySelectorAll('a.mt-ver').forEach(function(a) {
      a.textContent = VERSION;
      if (!a.getAttribute('href')) a.setAttribute('href', 'changelog.html');
    });

    setupPullToRefresh();
  }

  // Custom pull-to-refresh for the standalone PWA.
  function setupPullToRefresh() {
    if (document.getElementById('mt-ptr')) return;
    var st = document.createElement('style');
    st.textContent =
      '#mt-ptr{position:fixed;top:0;left:0;right:0;display:flex;' +
      'justify-content:center;pointer-events:none;z-index:10002;' +
      'transform:translateY(-48px);transition:transform .2s ease;}' +
      '#mt-ptr i{margin-top:12px;width:26px;height:26px;border-radius:50%;' +
      'border:3px solid rgba(140,140,140,.3);border-top-color:#E89A1F;' +
      'display:block;}' +
      '@keyframes mt-ptr-spin{to{transform:rotate(360deg)}}';
    document.head.appendChild(st);
    var ind = document.createElement('div');
    ind.id = 'mt-ptr';
    ind.innerHTML = '<i></i>';
    document.body.appendChild(ind);
    var spin = ind.firstChild;

    var startY = 0, pulling = false, dist = 0;
    var TRIG = 70, MAX = 110;

    function blocked() {
      var s = document.getElementById('mt-sheet');
      if (s && s.classList.contains('show')) return true;
      var m = document.querySelector('[aria-modal="true"]');
      if (m && getComputedStyle(m).display !== 'none') return true;
      var ap = document.getElementById('apanel');
      if (ap && ap.classList.contains('open')) return true;
      return false;
    }
    window.addEventListener('touchstart', function(e) {
      if (blocked() || window.scrollY > 0 || e.touches.length !== 1) {
        pulling = false; return;
      }
      startY = e.touches[0].clientY; pulling = true; dist = 0;
    }, { passive: true });
    window.addEventListener('touchmove', function(e) {
      if (!pulling) return;
      dist = e.touches[0].clientY - startY;
      if (dist <= 0 || window.scrollY > 0) {
        pulling = false; ind.style.transform = 'translateY(-48px)'; return;
      }
      if (dist > 6 && e.cancelable) e.preventDefault();
      var pull = Math.min(dist, MAX);
      ind.style.transition = 'none';
      ind.style.transform = 'translateY(' + (Math.min(pull, TRIG) - 48) + 'px)';
    }, { passive: false });
    window.addEventListener('touchend', function() {
      if (!pulling) return;
      pulling = false;
      ind.style.transition = 'transform .2s ease';
      if (dist >= TRIG) {
        ind.style.transform = 'translateY(10px)';
        spin.style.animation = 'mt-ptr-spin .7s linear infinite';
        var u = location.pathname + '?r=' + Date.now() + location.hash;
        setTimeout(function() { location.replace(u); }, 150);
      } else {
        ind.style.transform = 'translateY(-48px)';
      }
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', inject);
  } else {
    inject();
  }
})();
