/**
 * nav.js — shared hamburger menu + slide-out nav panel.
 *
 * Drop into any page with <script src="nav.js"></script>. Injects its own
 * styles, hamburger button (top-right, fixed), and side panel with links
 * to every page in the app. Marks the current page's link as active by
 * matching window.location.pathname.
 */

(function() {
  'use strict';

  var PAGES = [
    { href: 'index.html', label: 'Entry' },
    { href: 'stats.html', label: 'Stats' },
    { href: 'history.html', label: 'History' },
    { href: 'shoes.html', label: 'Shoes' }
  ];

  // Bump this on every release; mirror it in the footer link + changelog.html.
  var VERSION = 'v4.11.0';

  /* ===================== Theme (light / dark) =====================
     Default is dark. The user's choice is remembered in localStorage.
     This runs synchronously while the <head> is still parsing (nav.js
     is a plain <head> script on every page), so the theme is applied
     before the body paints — no flash. The light look is an additive
     override layer keyed on html[data-theme="light"]; the existing
     dark CSS is never touched, so dark mode can't regress. */

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
    // iOS standalone paints the status-bar band from <meta theme-color>;
    // repaint it on toggle so a dark->light flip doesn't leave a stale bar.
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

  // --- light override layer (shared chrome only; per-page surfaces
  //     are overridden in each page's own stylesheet) ---
  var LIGHT_BG     = '#f1ebdd'; // warm cream page background
  var LIGHT_TEXT   = '#171717'; // near-black so opacity-faded subtle text still reads on cream
  var LIGHT_SURF   = '#fffdf7'; // cards / nav panel
  var LIGHT_BORDER = 'rgba(0, 0, 0, 0.10)';
  var LIGHT_ACCENT = '#C77A0C'; // mustard deepened for contrast on cream

  var themeCss = [
    // smooth the flip (no html background — that breaks the body-bg→canvas
    // propagation the .mt-bg stripe wedge relies on, hiding the stripe)
    'body { transition: background-color 0.25s ease, color 0.25s ease; }',
    '',
    'html[data-theme="light"] body {',
    '  background: ' + LIGHT_BG + ' !important; color: ' + LIGHT_TEXT + ' !important;',
    '}',
    // signature stripe wedge stays at full strength on light too —
    // fading it washed the bands out and hid the cream stripe entirely
    '',
    // hamburger + drawer
    'html[data-theme="light"] #mt-nav-toggle span { background: ' + LIGHT_TEXT + '; }',
    'html[data-theme="light"] #mt-nav-backdrop { background: rgba(0, 0, 0, 0.32); }',
    'html[data-theme="light"] #mt-nav-panel {',
    '  background: ' + LIGHT_SURF + '; color: ' + LIGHT_TEXT + ';',
    '}',
    'html[data-theme="light"] #mt-nav-panel.mt-nav-open {',
    '  box-shadow: -16px 0 48px rgba(0, 0, 0, 0.18);',
    '}',
    'html[data-theme="light"] .mt-nav-link { color: ' + LIGHT_TEXT + '; }',
    'html[data-theme="light"] .mt-nav-link:hover { background: rgba(0, 0, 0, 0.04); }',
    'html[data-theme="light"] .mt-nav-link.mt-nav-link-active {',
    '  color: ' + LIGHT_ACCENT + '; border-left-color: ' + LIGHT_ACCENT + ';',
    '}',
    'html[data-theme="light"] .mt-nav-foot { border-top-color: ' + LIGHT_BORDER + '; }',
    'html[data-theme="light"] .mt-nav-foot a { color: ' + LIGHT_TEXT + '; }',
    '',
    // footer version stamp on the content pages
    'html[data-theme="light"] .mt-footer .mt-ver { color: ' + LIGHT_TEXT + '; }',
    '',
    // the theme switch control itself
    '#mt-theme-switch {',
    '  display: flex; align-items: center; gap: 10px;',
    '  background: none; border: none; padding: 0 0 1.15rem; margin: 0;',
    '  cursor: pointer; color: inherit; opacity: 0.6;',
    '  transition: opacity 0.15s ease;',
    '}',
    '#mt-theme-switch:hover { opacity: 0.95; }',
    '#mt-theme-switch .mt-ts-ico { font-size: 0.95rem; line-height: 1; }',
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

  // Apply immediately (head still parsing → no flash).
  var theme = readTheme();
  applyTheme(theme);
  (function injectThemeStyle() {
    var s = document.createElement('style');
    s.id = 'mt-theme-style';
    s.textContent = themeCss;
    (document.head || document.documentElement).appendChild(s);
  })();

  var css = [
    '#mt-nav-toggle {',
    '  position: fixed; top: 22px; right: 22px; z-index: 10001;',
    '  width: 36px; height: 36px;',
    '  background: transparent;',
    '  border: none;',
    '  cursor: pointer;',
    '  display: flex; flex-direction: column; align-items: center; justify-content: center;',
    '  gap: 5px; padding: 0;',
    '}',
    '#mt-nav-toggle span {',
    '  display: block; width: 18px; height: 2px; background: #f5f5f5; border-radius: 1px;',
    '  transition: transform 0.25s ease, opacity 0.2s ease;',
    '}',
    '#mt-nav-toggle.mt-nav-toggle-open span:nth-child(1) { transform: translateY(7px) rotate(45deg); }',
    '#mt-nav-toggle.mt-nav-toggle-open span:nth-child(2) { opacity: 0; }',
    '#mt-nav-toggle.mt-nav-toggle-open span:nth-child(3) { transform: translateY(-7px) rotate(-45deg); }',
    '',
    '#mt-nav-backdrop {',
    '  position: fixed; inset: 0; background: rgba(0, 0, 0, 0.5);',
    '  backdrop-filter: blur(3px); -webkit-backdrop-filter: blur(3px);',
    '  z-index: 9999; opacity: 0; pointer-events: none;',
    '  transition: opacity 0.25s ease;',
    '}',
    '#mt-nav-backdrop.mt-nav-backdrop-show { opacity: 1; pointer-events: auto; }',
    '',
    '#mt-nav-panel {',
    '  position: fixed; top: 0; right: 0; bottom: 0;',
    '  width: 78%; max-width: 320px;',
    '  background: #1c1c1c;',
    '  color: #f5f5f5;',
    '  z-index: 10000;',
    '  transform: translateX(100%);',
    '  transition: transform 0.32s cubic-bezier(0.2, 0.8, 0.2, 1), box-shadow 0.2s ease;',
    '  display: flex; flex-direction: column;',
    '  padding: 88px 0 2rem;',
    '  box-shadow: none;',
    '}',
    '#mt-nav-panel.mt-nav-open {',
    '  transform: translateX(0);',
    '  box-shadow: -16px 0 48px rgba(0, 0, 0, 0.4);',
    '}',
    '',
    '.mt-nav-link {',
    '  display: block; padding: 1rem 2rem;',
    '  font-family: "omnes", -apple-system, BlinkMacSystemFont, sans-serif;',
    '  font-size: 1.5rem; font-weight: 800; letter-spacing: 0.02em;',
    '  color: #f5f5f5; text-decoration: none;',
    '  border-left: 4px solid transparent;',
    '  transition: background 0.15s ease, color 0.15s ease, border-color 0.15s ease;',
    '}',
    '.mt-nav-link:hover { background: rgba(255, 255, 255, 0.04); }',
    '.mt-nav-link.mt-nav-link-active {',
    '  color: #E89A1F; border-left-color: #E89A1F;',
    '}',
    '',
    '.mt-nav-foot {',
    '  margin-top: auto; padding: 1.25rem 2rem 0;',
    '  border-top: 1px solid rgba(255, 255, 255, 0.08);',
    '}',
    '.mt-nav-foot a {',
    '  display: inline-block;',
    '  color: #f5f5f5; text-decoration: none; opacity: 0.5;',
    '  transition: opacity 0.15s ease;',
    '}',
    '.mt-nav-foot a:hover { opacity: 0.9; }',
    '.mt-nav-foot .mt-nav-foot-ver {',
    '  font-size: 0.9rem; letter-spacing: 0.12em;',
    '  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;',
    '}'
  ].join('\n');

  function inject() {
    var style = document.createElement('style');
    style.textContent = css;
    document.head.appendChild(style);

    var html = '' +
      '<button id="mt-nav-toggle" aria-label="Menu">' +
        '<span></span><span></span><span></span>' +
      '</button>' +
      '<div id="mt-nav-backdrop"></div>' +
      '<nav id="mt-nav-panel">' +
        PAGES.map(function(p) {
          return '<a class="mt-nav-link" href="' + p.href + '">' + p.label + '</a>';
        }).join('') +
        '<div class="mt-nav-foot">' +
          '<button id="mt-theme-switch" type="button" role="switch" ' +
                  'aria-label="Switch between light and dark mode">' +
            '<span class="mt-ts-ico">☾</span>' +
            '<span class="mt-ts-track"><span class="mt-ts-knob"></span></span>' +
            '<span class="mt-ts-ico">☀</span>' +
          '</button>' +
          '<a href="changelog.html">' +
            '<span class="mt-nav-foot-ver">' + VERSION + '</span>' +
          '</a>' +
        '</div>' +
      '</nav>';
    document.body.insertAdjacentHTML('afterbegin', html);

    var toggle   = document.getElementById('mt-nav-toggle');
    var panel    = document.getElementById('mt-nav-panel');
    var backdrop = document.getElementById('mt-nav-backdrop');

    function openMenu() {
      panel.classList.add('mt-nav-open');
      backdrop.classList.add('mt-nav-backdrop-show');
      toggle.classList.add('mt-nav-toggle-open');
    }
    function closeMenu() {
      panel.classList.remove('mt-nav-open');
      backdrop.classList.remove('mt-nav-backdrop-show');
      toggle.classList.remove('mt-nav-toggle-open');
    }
    toggle.addEventListener('click', function() {
      if (panel.classList.contains('mt-nav-open')) closeMenu();
      else openMenu();
    });
    backdrop.addEventListener('click', closeMenu);

    var themeSwitch = document.getElementById('mt-theme-switch');
    function syncSwitch() {
      themeSwitch.setAttribute('aria-checked', theme === 'light' ? 'true' : 'false');
    }
    syncSwitch();
    themeSwitch.addEventListener('click', function() {
      theme = (theme === 'light') ? 'dark' : 'light';
      applyTheme(theme);
      saveTheme(theme);
      syncSwitch();
    });

    // Active state for the current page
    var path = window.location.pathname.split('/').pop() || 'index.html';
    if (path === '' || path === '/') path = 'index.html';
    document.querySelectorAll('.mt-nav-link').forEach(function(a) {
      if (a.getAttribute('href') === path) a.classList.add('mt-nav-link-active');
    });

    // Single source of truth for the displayed version: nav.js fills every
    // footer .mt-ver link, so a release bump = change VERSION above only.
    document.querySelectorAll('a.mt-ver').forEach(function(a) {
      a.textContent = VERSION;
      if (!a.getAttribute('href')) a.setAttribute('href', 'changelog.html');
    });

    setupPullToRefresh();
  }

  // Custom pull-to-refresh for the standalone PWA (iOS doesn't give us one).
  // Reloads with a cache-busting query so it can't serve the stale page.
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
      var p = document.getElementById('mt-nav-panel');
      if (p && p.classList.contains('mt-nav-open')) return true;
      var m = document.querySelector('[aria-modal="true"]');
      if (m && getComputedStyle(m).display !== 'none') return true;
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
