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
    { href: 'index.html',    label: 'Entry' },
    { href: 'stats.html',    label: 'Stats' },
    { href: 'shoes.html',    label: 'Shoes' },
    { href: 'history.html',  label: 'History' },
    { href: 'settings.html', label: 'Settings' }
  ];

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
    '  transition: transform 0.32s cubic-bezier(0.2, 0.8, 0.2, 1);',
    '  display: flex; flex-direction: column;',
    '  padding: 88px 0 2rem;',
    '  box-shadow: -16px 0 48px rgba(0, 0, 0, 0.4);',
    '}',
    '#mt-nav-panel.mt-nav-open { transform: translateX(0); }',
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

    // Active state for the current page
    var path = window.location.pathname.split('/').pop() || 'index.html';
    if (path === '' || path === '/') path = 'index.html';
    document.querySelectorAll('.mt-nav-link').forEach(function(a) {
      if (a.getAttribute('href') === path) a.classList.add('mt-nav-link-active');
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', inject);
  } else {
    inject();
  }
})();
