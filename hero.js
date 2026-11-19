/* Capflex hero animation (draft 3, grid version): the socket on its lead to the power line runs away,
   the nearly empty plug catches it, charges from the grid, and the pair becomes the Capflex logo. */
(function(){
  'use strict';

  /* ---------- geometry (logo units: the mark file's own coordinates) ---------- */
  var STAGE_W = 960, K = 1.45, GROUND = 104, GROUND_Y = 300;
  var LOCK_W = 520;                      // mark + wordmark, logo units
  var WORD_X0 = 187, WORD_X1 = 520;      // wordmark span after scale(0.8)
  var SOCK = {x: 49, y: 86};             // socket bottom-centre in the logo
  var PLUG = {x: 134, y: 78};            // plug bottom-centre in the logo
  var CONTACT = {x: 95, y: 50};          // where the prongs meet the socket
  var WIRE_Y = -70, SAG = 16, SPAN = 300, PYLONS = 5;
  var LOW = 0.22;                        // the plug's charge before it plugs in

  /* ---------- timeline (seconds) ---------- */
  var T = {chaseEnd: 2.4, crouchEnd: 2.75, land: 3.15, flow: 3.25, charge: 3.75, bolt: 4.05,
           settle: 4.3, pan: 4.8, word: 5.1, fadeOut: 7.45, loop: 8.0};

  /* ---------- easing + springs ---------- */
  function clamp01(v){ return v < 0 ? 0 : v > 1 ? 1 : v; }
  function lerp(a, b, k){ return a + (b - a) * k; }
  function inOut(v){ v = clamp01(v); return v < 0.5 ? 4 * v * v * v : 1 - Math.pow(-2 * v + 2, 3) / 2; }
  function outCubic(v){ v = clamp01(v); return 1 - Math.pow(1 - v, 3); }
  function outQuad(v){ v = clamp01(v); return 1 - (1 - v) * (1 - v); }
  // Underdamped spring from 0 to 1: overshoots once or twice, like a bouncy UI pop.
  function spring(t, freq, damp){ if (t <= 0) return 0; return 1 - Math.exp(-damp * t) * Math.cos(freq * t); }
  // Decaying wobble around 0, for squash after an impact.
  function wobble(t, amp, freq, damp){ if (t < 0) return 0; return amp * Math.exp(-damp * t) * Math.cos(freq * t); }

  /* ---------- elements ---------- */
  function $(id){ return document.getElementById(id); }
  if (!$('hx-scene')) return;
  var svgNS = 'http://www.w3.org/2000/svg';
  var el = {
    world: $('hx-world'), grid: $('hx-grid'), pylons: $('hx-pylons'), wire: $('hx-wire'), tether: $('hx-tether'), trolley: $('hx-trolley'),
    socket: $('hx-socket'), plug: $('hx-plug'), level: $('hx-plug-level'), eyes: $('hx-eyes'), eyeL: $('hx-eye-l'), eyeR: $('hx-eye-r'),
    happy: $('hx-happy'), sweat: $('hx-sweat'), cable: $('hx-cable'), fray: $('hx-fray'), cableG: $('hx-cable-g'), shS: $('hx-sh-s'), shP: $('hx-sh-p'),
    lgS1: $('hx-lg-s1'), lgS2: $('hx-lg-s2'), lgP1: $('hx-lg-p1'), lgP2: $('hx-lg-p2'),
    ring: $('hx-ring'), sparks: $('hx-sparks'), bolt: $('hx-bolt'), word: $('hx-word-in'), wclip: $('hx-wclip-r'), dots: $('hx-dots')
  };
  var shines = Array.prototype.slice.call(document.querySelectorAll('#hx-scene .eye-shine'));

  var SPARK_COLORS = ['#B5DE5C', 'var(--spark-a)', 'var(--spark-b)', '#B5DE5C', 'var(--spark-a)', 'var(--spark-b)', '#B5DE5C', 'var(--spark-a)'];
  var sparkEls = SPARK_COLORS.map(function(c){
    var l = document.createElementNS(svgNS, 'line'); l.setAttribute('style', 'stroke:' + c); el.sparks.appendChild(l); return l;
  });
  // Energy: dots that travel from the grid, down the socket's lead, into the plug, then out along the plug's cable.
  var DOTS_IN = 6, DOTS_OUT = 3;
  var dotEls = [];
  for (var di = 0; di < DOTS_IN + DOTS_OUT; di++){
    var c = document.createElementNS(svgNS, 'circle');
    c.setAttribute('r', '4.2'); c.setAttribute('fill', '#B5DE5C'); c.setAttribute('class', 'ln'); c.setAttribute('stroke-width', '2');
    el.dots.appendChild(c); dotEls.push(c);
  }

  function set(e, attrs){ for (var k in attrs) e.setAttribute(k, attrs[k]); }
  function f(n){ return Math.round(n * 100) / 100; }

  /* ---------- polyline helpers for the energy dots ---------- */
  function polyAt(pts, u){
    if (!pts.length) return null;
    var lens = [0], total = 0;
    for (var i = 1; i < pts.length; i++){ total += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]); lens.push(total); }
    var target = clamp01(u) * total;
    for (var j = 1; j < pts.length; j++){
      if (lens[j] >= target){
        var k = (target - lens[j - 1]) / Math.max(1e-6, lens[j] - lens[j - 1]);
        return [lerp(pts[j - 1][0], pts[j][0], k), lerp(pts[j - 1][1], pts[j][1], k)];
      }
    }
    return pts[pts.length - 1];
  }
  function quad(a, c, b, n){
    var out = [];
    for (var i = 0; i <= n; i++){
      var u = i / n, v = 1 - u;
      out.push([v * v * a[0] + 2 * v * u * c[0] + u * u * b[0], v * v * a[1] + 2 * v * u * c[1] + u * u * b[1]]);
    }
    return out;
  }

  /* ---------- the grid: pylons and one power line, scrolling while they run ---------- */
  var scroll = 0;
  function pylonXs(){
    var xs = [], range = PYLONS * SPAN;
    for (var i = 0; i < PYLONS; i++) xs.push(((i * SPAN + scroll) % range + range) % range - 560);
    return xs.sort(function(a, b){ return a - b; });
  }
  function wireYAt(x, xs){
    for (var i = 0; i < xs.length - 1; i++){
      if (x >= xs[i] && x <= xs[i + 1]){ var k = (x - xs[i]) / (xs[i + 1] - xs[i]); return WIRE_Y + SAG * 4 * k * (1 - k); }
    }
    return WIRE_Y;
  }
  function pylonPath(x){
    function leg(y, side){ return x + side * (16 - (GROUND - y) / (GROUND - (WIRE_Y - 2)) * 11); }
    var d = 'M' + f(x - 16) + ' ' + GROUND + ' L' + f(x - 5) + ' ' + (WIRE_Y - 2) + ' L' + x + ' ' + (WIRE_Y - 14) + ' L' + f(x + 5) + ' ' + (WIRE_Y - 2) + ' L' + f(x + 16) + ' ' + GROUND;
    d += ' M' + f(x - 22) + ' ' + WIRE_Y + ' L' + f(x + 22) + ' ' + WIRE_Y;
    var levels = [GROUND, 58, 14, -30, WIRE_Y - 2];
    for (var i = 0; i < levels.length - 1; i++){
      var s = i % 2 ? -1 : 1;
      d += ' M' + f(leg(levels[i], -s)) + ' ' + levels[i] + ' L' + f(leg(levels[i + 1], s)) + ' ' + levels[i + 1];
      if (i > 0) d += ' M' + f(leg(levels[i], -1)) + ' ' + levels[i] + ' L' + f(leg(levels[i], 1)) + ' ' + levels[i];
    }
    return d;
  }

  /* ---------- the story at time t ---------- */
  var phaseS = 0, phaseP = 0;
  function gapAt(t){
    if (t < T.chaseEnd) return lerp(132, 40, inOut(t / T.chaseEnd));
    if (t < T.crouchEnd) return lerp(40, 46, inOut((t - T.chaseEnd) / (T.crouchEnd - T.chaseEnd)));
    if (t < T.land) return lerp(46, 0, outQuad((t - T.crouchEnd) / (T.land - T.crouchEnd)));
    return 0;
  }
  function scrollSpeed(t){ return t < T.land ? 92 : 92 * Math.max(0, 1 - (t - T.land) / 0.28); }

  function apply(t, dt){
    var socketRuns = t < T.land, plugRuns = t < T.chaseEnd;
    var surprised = t >= T.chaseEnd && t < T.land;
    phaseS += dt * Math.PI * 2 * (socketRuns ? (surprised ? 3.4 : 2.6) : 0);
    phaseP += dt * Math.PI * 2 * (plugRuns ? 3.0 : 0);
    scroll += dt * scrollSpeed(t);

    /* camera: keep the pair centred, then pan to centre the full lockup */
    var gap = gapAt(t);
    var chaseX = (STAGE_W - (160 + gap) * K) / 2;
    var lockX = (STAGE_W - LOCK_W * K) / 2;
    var camX = lerp(chaseX, lockX, inOut((t - T.pan) / 0.75));
    var fadeIn = clamp01(t / 0.25), fadeOut = 1 - clamp01((t - T.fadeOut) / 0.4);
    set(el.world, {transform: 'translate(' + f(camX) + ' ' + f(GROUND_Y - GROUND * K) + ') scale(' + K + ')', opacity: f(Math.min(fadeIn, fadeOut))});

    /* grid: pylons and the power line, fading out once the pair becomes the logo */
    var gridK = 1 - clamp01((t - T.settle) / 0.45);
    var xs = pylonXs();
    var pd = '';
    xs.forEach(function(x){ pd += pylonPath(x) + ' '; });
    var wd = 'M' + f(xs[0]) + ' ' + WIRE_Y;
    for (var i = 0; i < xs.length - 1; i++){
      for (var s = 1; s <= 14; s++){ var xx = lerp(xs[i], xs[i + 1], s / 14); wd += ' L' + f(xx) + ' ' + f(wireYAt(xx, xs)); }
    }
    set(el.pylons, {d: pd}); set(el.wire, {d: wd});
    set(el.grid, {opacity: f(gridK)});

    /* socket */
    var hopS = socketRuns ? Math.abs(Math.sin(phaseS)) * (surprised ? 8 : 6) : 0;
    var contactS = socketRuns ? 1 - Math.abs(Math.sin(phaseS)) : 0;
    var impactT = t - T.land;
    var squashS = (socketRuns ? 0.07 * Math.pow(contactS, 3) : 0) + wobble(impactT, 0.12, 17, 6);
    var pushS = impactT > 0 ? -12 * Math.exp(-6 * impactT) * Math.sin(16 * impactT) : 0;
    var leanS = socketRuns ? -5 : lerp(4, 0, outCubic(impactT / 0.5));
    var sx = SOCK.x + pushS, sy = SOCK.y - hopS;
    set(el.socket, {transform: 'translate(' + f(sx) + ' ' + f(sy) + ') rotate(' + f(leanS) + ') scale(' + f(1 + squashS * 0.8) + ' ' + f(1 - squashS) + ')'});

    /* the socket's lead: from its clip up to a trolley riding the power line */
    var tx = sx + 22;
    var nearest = xs.reduce(function(m, x){ return Math.min(m, Math.abs(x - tx)); }, 999);
    var bump = Math.max(0, 1 - nearest / 26);
    var ty = wireYAt(tx, xs) - 5 - 9 * Math.sin(bump * Math.PI / 2);
    var topX = sx, topY = sy - 80;
    var slack = 10 + 3 * Math.sin(t * 9);
    var ctrl = [lerp(topX, tx, 0.5) - 6, lerp(topY, ty, 0.5) + slack];
    set(el.tether, {d: 'M' + f(topX) + ' ' + f(topY) + ' Q' + f(ctrl[0]) + ' ' + f(ctrl[1]) + ' ' + f(tx) + ' ' + f(ty), opacity: f(gridK)});
    set(el.trolley, {cx: f(tx), cy: f(ty), opacity: f(gridK)});

    /* eyes: look back at the plug, blink once, widen when surprised, smile when caught, then become the logo's holes */
    var look = t > 1.1 && t < T.land ? 3 * inOut((t - 1.1) / 0.3) : 0;
    var blink = (t > 0.7 && t < 0.82) ? 0.12 : 1;
    var wide = surprised ? 1 + 0.32 * spring(t - T.chaseEnd, 22, 7) : 1;
    var happy = t >= T.land + 0.05 && t < T.settle + 0.1;
    [[el.eyeL, -13], [el.eyeR, 13]].forEach(function(e){
      set(e[0], {transform: 'translate(' + f(e[1] + look) + ' -36) scale(' + f(wide) + ' ' + f(wide * blink) + ')'});
    });
    set(el.eyes, {opacity: happy ? 0 : 1});
    set(el.happy, {opacity: happy ? 1 : 0, transform: 'translate(0 ' + f(happy ? -2 * spring(t - T.land, 20, 8) : 0) + ')'});
    var shine = 1 - clamp01((t - T.settle - 0.1) / 0.3);
    shines.forEach(function(sh){ sh.setAttribute('opacity', f(shine)); });

    /* one sweat drop flying off while the plug closes in */
    var sw = (t - 1.6) / 0.7;
    if (sw > 0 && sw < 1){
      set(el.sweat, {opacity: f(1 - sw * sw), transform: 'translate(' + f(36 + 16 * sw) + ' ' + f(-74 - 22 * sw + 40 * sw * sw) + ') rotate(' + f(30 * sw) + ')'});
    } else set(el.sweat, {opacity: 0});

    /* plug: run, crouch, leap, land, charge, settle into the logo position */
    var px, py, rot = 0, scx = 1, scy = 1, lift = 0;
    var runDrop = 8 * (1 - inOut((t - T.settle) / 0.4));
    if (t < T.chaseEnd){
      lift = Math.abs(Math.sin(phaseP)) * 5;
      var cP = 1 - Math.abs(Math.sin(phaseP));
      var sq = 0.08 * Math.pow(cP, 3);
      scx = 1 + sq * 0.8; scy = 1 - sq; rot = -6;
    } else if (t < T.crouchEnd){
      var c = inOut((t - T.chaseEnd) / (T.crouchEnd - T.chaseEnd));
      scy = 1 - 0.22 * c; scx = 1 + 0.16 * c; rot = lerp(-6, 8, c);
    } else if (t < T.land){
      var k = (t - T.crouchEnd) / (T.land - T.crouchEnd);
      lift = Math.sin(Math.PI * k) * 44;
      scx = 1 + 0.16 * Math.sin(Math.PI * k); scy = 1 - 0.1 * Math.sin(Math.PI * k);
      rot = lerp(-14, 0, k);
    } else {
      var w = wobble(impactT, 0.16, 18, 6) + wobble(t - T.charge, 0.1, 20, 7);
      scx = 1 + w * 0.8; scy = 1 - w;
    }
    px = PLUG.x + gap; py = PLUG.y + runDrop - lift;
    set(el.plug, {transform: 'translate(' + f(px) + ' ' + f(py) + ') rotate(' + f(rot) + ') scale(' + f(scx) + ' ' + f(scy) + ')'});

    /* charge level: low while it chases, fills up when grid power arrives */
    var level = LOW + (1 - LOW) * spring(t - T.charge, 13, 6.5);
    var lvlWave = t < T.charge ? 1.2 * Math.sin(t * 7) : 0;
    set(el.level, {y: f(-56 * level + lvlWave), height: f(56 * level + 4)});

    /* legs: run cycles, tuck during the leap, retract into the logo */
    var legK = 1 - clamp01((t - T.settle) / 0.35);
    function legs(e1, e2, hipX, hipY, spread, phase, running, tucked, reach){
      [[e1, -spread, 0], [e2, spread, Math.PI]].forEach(function(L){
        var hx = hipX + L[1], hy = hipY;
        var fx, fy;
        if (tucked){ fx = hx + 4; fy = hy + 8; }
        else if (running){
          fx = hx - 8 * Math.cos(phase + L[2]);
          fy = GROUND - Math.max(0, Math.sin(phase + L[2])) * 7;
        } else { fx = hx; fy = GROUND; }
        fx = lerp(hx, fx, reach); fy = lerp(hy, fy, reach);
        set(L[0], {x1: f(hx), y1: f(hy), x2: f(fx), y2: f(fy), opacity: reach > 0.02 ? 1 : 0});
      });
    }
    legs(el.lgS1, el.lgS2, sx, sy - 3, 15, phaseS, socketRuns, false, legK);
    legs(el.lgP1, el.lgP2, px, py - 3, 9, phaseP, plugRuns, t >= T.crouchEnd && t < T.land, legK);

    /* shadows shrink with height and fade as the pair becomes the logo */
    set(el.shS, {cx: f(sx), rx: f(40 * (1 - hopS / 40)), opacity: f(legK)});
    set(el.shP, {cx: f(px), rx: f(22 * (1 - lift / 70)), opacity: f(legK)});

    /* the plug's own cable: short, loose, dragging on the ground with a frayed end */
    var cableK = 1 - clamp01((t - T.settle) / 0.3);
    var cablePts = [];
    if (cableK > 0){
      var x0 = px + 20, y0 = py - 28, len = 118;
      for (var ci = 0; ci <= 22; ci++){
        var u = ci / 22, cx = x0 + len * u;
        var drop = Math.min(1, u * 2.6);
        var wig = 5 * Math.sin(u * 8 - t * (plugRuns ? 12 : 4)) * Math.min(1, u * 3) * (plugRuns || t < T.crouchEnd + 0.4 ? 1 : 0.3);
        var cy = lerp(y0, GROUND - 3, inOut(drop)) + (u > 0.38 ? Math.min(0, wig) : wig * 0.5);
        cablePts.push([cx, Math.min(GROUND - 3, cy)]);
      }
      var d = 'M' + cablePts.map(function(p){ return f(p[0]) + ' ' + f(p[1]); }).join(' L');
      var end = cablePts[cablePts.length - 1];
      var fd = 'M' + f(end[0]) + ' ' + f(end[1]) + ' l6 -4 M' + f(end[0]) + ' ' + f(end[1]) + ' l7 1 M' + f(end[0]) + ' ' + f(end[1]) + ' l5 4';
      set(el.cable, {d: d}); set(el.fray, {d: fd});
      set(el.cableG, {opacity: f(cableK)});
    } else set(el.cableG, {opacity: 0});

    /* energy: grid power flows along the line, down the lead, through the socket into the plug, then out of its cable */
    var inPts = [];
    for (var wx = tx - 190; wx <= tx; wx += 10) inPts.push([wx, wireYAt(wx, xs) - 1]);
    inPts.push([tx, ty]);
    inPts = inPts.concat(quad([tx, ty], ctrl, [topX, topY], 10));
    inPts.push([sx, sy - 40], [CONTACT.x, CONTACT.y], [px, py - 28]);
    dotEls.forEach(function(dot, i){
      var u, p = null;
      if (i < DOTS_IN){
        u = (t - T.flow - i * 0.07) / 0.55;
        if (u > 0 && u < 1) p = polyAt(inPts, outQuad(u));
      } else {
        u = (t - T.charge - 0.15 - (i - DOTS_IN) * 0.1) / 0.45;
        if (u > 0 && u < 1 && cablePts.length) p = polyAt(cablePts, u);
      }
      if (p) set(dot, {cx: f(p[0]), cy: f(p[1]), opacity: 1, r: f(i < DOTS_IN ? 4.2 : 3.6)});
      else dot.setAttribute('opacity', 0);
    });

    /* impact: ring pulse and a burst of sparks at the contact point */
    var rk = impactT / 0.6;
    if (rk > 0 && rk < 1) set(el.ring, {r: f(8 + 64 * outCubic(rk)), opacity: f(1 - rk), 'stroke-width': f(5 * (1 - rk) + 1)});
    else set(el.ring, {opacity: 0});
    var sk = impactT / 0.5;
    sparkEls.forEach(function(sp, i){
      if (sk <= 0 || sk >= 1){ sp.setAttribute('opacity', 0); return; }
      var a = -Math.PI / 2 + i * Math.PI * 2 / sparkEls.length + 0.2;
      var r1 = 18 + 46 * outCubic(sk), r2 = r1 + 12 * (1 - sk);
      set(sp, {x1: f(CONTACT.x + Math.cos(a) * r1), y1: f(CONTACT.y + Math.sin(a) * r1), x2: f(CONTACT.x + Math.cos(a) * r2), y2: f(CONTACT.y + Math.sin(a) * r2), opacity: 1});
    });

    /* lime bolt pops once the plug is charged, then floats away before the wordmark arrives */
    var bt = t - T.bolt;
    if (bt > 0 && t < T.word + 0.3){
      var pop = spring(bt, 16, 6.5);
      var leave = clamp01((t - T.pan) / 0.45);
      set(el.bolt, {opacity: f(1 - leave), transform: 'translate(' + f(CONTACT.x + 9) + ' ' + f(-8 - 14 * outQuad(leave)) + ') rotate(' + f(-14 * Math.exp(-5 * bt) * Math.cos(12 * bt)) + ') scale(' + f(1.25 * pop) + ')'});
    } else set(el.bolt, {opacity: 0});

    /* wordmark: wipes in from the left with a small spring rise */
    var wk = outCubic((t - T.word) / 0.65);
    set(el.wclip, {width: f((WORD_X1 - WORD_X0 + 20) * wk)});
    set(el.word, {transform: 'translate(0 ' + f(12 * (1 - spring(t - T.word, 14, 7))) + ')'});
  }

  /* ---------- clock ---------- */
  var state = {t: 0, playing: true};
  var last = null;
  function loop(now){
    if (last === null) last = now;
    var dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    if (state.playing && visible){
      var prev = state.t;
      state.t += dt;
      if (state.t >= T.loop){ state.t -= T.loop; phaseS = 0; phaseP = 0; }
      apply(state.t, state.t < prev ? 0 : dt);
    }
    requestAnimationFrame(loop);
  }

  /* ---------- start: play only while the hero is on screen; reduced motion shows the finished logo ---------- */
  var visible = true;
  if ('IntersectionObserver' in window){
    new IntersectionObserver(function(entries){ visible = entries[0].isIntersecting; last = null; }, {threshold: 0.05}).observe($('hx-scene'));
  }
  var reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (reduce){ state.t = 6.2; apply(6.2, 0); return; }
  apply(0, 0);
  requestAnimationFrame(loop);
})();
