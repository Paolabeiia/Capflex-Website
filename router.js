/* Capflex site: switches between the main page and Site Match.
   #matches, #map, #projects, #listings, #rules and #desk open Site Match (market.js renders them).
   Anything else (no hash, #home, #film, #what) shows the main page and scrolls to that section. */
(function () {
  'use strict';
  var APP = ['matches', 'map', 'projects', 'listings', 'rules', 'desk'];
  var home = document.getElementById('home');
  var app = document.getElementById('app');
  var video = document.getElementById('film-video');
  var navApp = document.querySelector('.site-nav .nav-app');
  var navSecs = Array.prototype.slice.call(document.querySelectorAll('.site-nav .nav-sec'));
  if (!home || !app) return;

  var reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (video && reduce) { video.removeAttribute('autoplay'); video.pause(); video.controls = true; }

  function headHeight() {
    var h = document.querySelector('.site-head');
    return h ? h.offsetHeight : 0;
  }

  function show(first) {
    var id = (location.hash || '').slice(1);
    var inApp = APP.indexOf(id) >= 0;
    home.hidden = inApp;
    app.hidden = !inApp;
    document.documentElement.setAttribute('data-page', inApp ? 'app' : 'home');
    if (navApp) { if (inApp) navApp.setAttribute('aria-current', 'page'); else navApp.removeAttribute('aria-current'); }
    navSecs.forEach(function (a) {
      if (!inApp && a.getAttribute('href') === '#' + id) a.setAttribute('aria-current', 'true'); else a.removeAttribute('aria-current');
    });
    if (video && !reduce) {
      if (inApp) video.pause();
      else { var p = video.play(); if (p && p.catch) p.catch(function () {}); }
    }
    if (inApp) { window.scrollTo(0, 0); return; }
    var target = id && id !== 'home' ? document.getElementById(id) : null;
    if (target) window.scrollTo(0, target.getBoundingClientRect().top + window.pageYOffset - headHeight() + 1);
    else if (!first) window.scrollTo(0, 0);
  }

  window.addEventListener('hashchange', function () { show(false); });
  show(true);
})();
