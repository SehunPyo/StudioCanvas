/* ══════════════════════════════════════════════════════════════════════
   Studio Canvas — 동작

   1. 첫 화면   : 글자 모양으로 잘라낸 유체(fluid-text.js). 커서를 올리면 번진다.
   2. 선언      : 붙박이(sticky) 화면에서 스크롤 진행에 맞춰 단어가 켜진다.
   3. 제품 그리드: 화면에 들어온 카드가 한 칸씩 늦게 올라온다.
   4. 거르기    : 전체 / 출시 / 준비 중.

   스크롤 계산은 rAF 한 번에 모아서 한다. 스크롤 이벤트에서 레이아웃을
   읽지 않도록 크기 값은 리사이즈 때만 다시 잰다.
   ══════════════════════════════════════════════════════════════════════ */

(function () {
  'use strict';

  var reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  var head    = document.getElementById('head');
  var prog    = document.getElementById('prog');
  var say     = document.querySelector('[data-say]');
  var sayNote = document.querySelector('.say-note');
  var vals    = Array.prototype.slice.call(document.querySelectorAll('.vals div'));

  /* ── 1. 첫 화면의 유체 글자 ────────────────────────────────── */

  var canvas   = document.getElementById('fluid');
  var fallback = document.getElementById('fluidFallback');

  /* 선언 문장의 칠하기 상태 — 스크롤 핸들러가 적고, 유체 프레임이 읽는다 */
  var paintU  = 0;      /* 지금까지 칠한 지점 (0~1) */
  var sayGoal = 0;      /* 스크롤이 가리키는 목표 지점 */

  function showFallback() {
    if (canvas) canvas.hidden = true;
    if (fallback) fallback.hidden = false;
  }

  if (canvas && typeof window.FluidText === 'function' && !reduce) {
    var fluid = window.FluidText(canvas, {
      text: 'StUDiO\nCaNVaS',
      color: '#FFFFFF',
      font: {
        fontFamily: 'Pretendard',
        fontWeight: 700,
        lineHeight: '1em',
        letterSpacing: '0px',
        textAlign: 'center'
      },
      /* 글자 크기는 캔버스 크기를 보고 정한다 — 두 줄이 항상 화면 안에 들어오도록 */
      fontSizeFor: function (w, h) {
        return Math.max(44, Math.min(w * 0.2, h * 0.42, 210));
      },
      splatRadius: 9,
      splatForce: 5,
      curl: 12,
      densityDissipation: 3
    });
    if (!fluid || !fluid.ok) showFallback();
  } else {
    showFallback();
  }

  /* ── 2. 선언 문장도 유체로 ─────────────────────────────────── */

  var sayCanvas = document.getElementById('sayFluid');
  var sayFx = null;

  /* 마스크를 그릴 때와 같은 계산 — 물감을 뿌릴 줄 위치를 알아내는 데도 쓴다 */
  function sayFontSize(w, h) {
    return Math.max(20, Math.min(w / 15.6, h / 2.6, 92));
  }

  if (sayCanvas && typeof window.FluidText === 'function' && !reduce) {
    sayFx = window.FluidText(sayCanvas, {
      text: '매일 사용하는 도구를 만듭니다.\n값은 매기지 않습니다.',
      /* 칠하기 전에는 어둡다. 물감이 닿은 자리만 밝아진다. */
      color: '#2e2e33',
      /* 첫 화면과 달리 여기는 무채색 — 문장이 색으로 덮이는 게 아니라 켜져야 한다 */
      paletteColors: ['#ffffff', '#dcdce4', '#ffffff'],
      font: {
        fontFamily: 'Pretendard',
        fontWeight: 700,
        lineHeight: '1.16em',
        letterSpacing: '-0.04em',
        textAlign: 'left'
      },
      fontSizeFor: sayFontSize,
      splatRadius: 16,
      splatForce: 5,
      curl: 10,
      densityDissipation: 0,      /* 한 번 칠한 자리는 그대로 남는다 */

      /* 칠하기는 유체의 프레임 안에서 한다. 스크롤 핸들러는 목표치만 적어 두고
         실제로 뿌리는 일은 여기서 — 같은 프레임·같은 컨텍스트라야 물감이 남는다. */
      onFrame: function (api) {
        if (sayGoal <= paintU) return;

        var ch = sayCanvas.clientHeight || 1;
        var off = (1.16 * sayFontSize(sayCanvas.clientWidth, ch)) / (2 * ch);
        var steps = 0;
        while (paintU < sayGoal && steps < 14) {
          paintU = Math.min(sayGoal, paintU + 0.028);
          var px = -0.015 + paintU * 1.03;
          api.paint(px, 0.5 + off, 90, (Math.random() - 0.5) * 50, 8);
          api.paint(px, 0.5 - off, 90, (Math.random() - 0.5) * 50, 8);
          steps++;
        }
      }
    });
    if (sayFx && sayFx.ok && say) say.classList.add('paint');
    else sayFx = null;
  }

  /* ── 3. 문장을 단어로 쪼갠다 (유체를 못 쓸 때의 연출) ──────── */

  var words = [];
  document.querySelectorAll('[data-split]').forEach(function (holder) {
    var parts = holder.textContent.trim().split(/\s+/);
    holder.textContent = '';
    parts.forEach(function (p, i) {
      var el = document.createElement('span');
      el.className = 'w';
      el.textContent = p;
      holder.appendChild(el);
      if (i < parts.length - 1) holder.appendChild(document.createTextNode(' '));
      words.push(el);
    });
  });

  /* ── 치수는 리사이즈 때만 잰다 ─────────────────────────────── */

  var vh = 0, sayTop = 0, sayH = 0, sayRun = 1, docRun = 1;

  function measure() {
    vh = window.innerHeight;
    if (say) {
      sayTop = say.getBoundingClientRect().top + window.scrollY;
      sayH = say.offsetHeight;
      sayRun = Math.max(1, sayH - vh);
    }
    docRun = Math.max(1, document.documentElement.scrollHeight - vh);
  }

  /* ── 4. 스크롤 한 번에 전부 갱신 ───────────────────────────── */

  var litCount = -1;
  var noteLit = false;
  var ticking = false;

  function frame() {
    ticking = false;
    var y = window.scrollY;

    var stuck = y > vh * 0.6;
    head.classList.toggle('stuck', stuck);
    prog.classList.toggle('on', stuck);
    prog.style.transform = 'scaleX(' + (y / docRun).toFixed(4) + ')';

    if (say && !reduce) {
      var sp = (y - sayTop) / sayRun;
      sp = sp < 0 ? 0 : (sp > 1 ? 1 : sp);

      if (sayFx) {
        /* 여기서는 목표치만 적어 둔다. 실제로 뿌리는 일은 유체의 onFrame 이 한다.
           칠한 물감은 읽는 동안 흐려지지 않게 그대로 두고(densityDissipation 0),
           이 화면을 완전히 벗어나면 지운다 — 다시 오면 처음부터 번진다. */
        if (y > sayTop + sayH - 60 || y + vh < sayTop + 60) {
          /* 화면에서 벗어났다 → 지금 바로 지운다. 유체 루프는 멈춰 있을 수 있어서
             onFrame 에 맡기면 다시 보일 때까지 지우기가 밀린다. */
          if (paintU > 0) {
            sayFx.clear();
            paintU = 0;
          }
          sayGoal = 0;
        } else {
          var u = (sp - 0.05) / 0.55;
          sayGoal = u < 0 ? 0 : (u > 1 ? 1 : u);
        }
      } else if (words.length) {
        /* 0.06 ~ 0.58 구간에서 단어가 전부 켜진다 */
        var t = (sp - 0.06) / 0.52;
        var n = Math.round((t < 0 ? 0 : (t > 1 ? 1 : t)) * words.length);
        if (n !== litCount) {
          for (var i = 0; i < words.length; i++) words[i].classList.toggle('lit', i < n);
          litCount = n;
        }
      }

      var showNote = sp > 0.62;
      if (showNote !== noteLit) {
        noteLit = showNote;
        if (sayNote) sayNote.classList.toggle('lit', showNote);
        vals.forEach(function (v) { v.classList.toggle('lit', showNote); });
      }
    }
  }

  function onScroll() {
    if (!ticking) { ticking = true; requestAnimationFrame(frame); }
  }

  measure();
  window.addEventListener('scroll', onScroll, { passive: true });
  window.addEventListener('resize', function () { measure(); onScroll(); });
  onScroll();

  if (reduce) {
    words.forEach(function (w) { w.classList.add('lit'); });
    if (sayNote) sayNote.classList.add('lit');
    vals.forEach(function (v) { v.classList.add('lit'); });
  }

  /* ── 5. 첫 등장 ────────────────────────────────────────────── */

  requestAnimationFrame(function () {
    requestAnimationFrame(function () { document.body.classList.add('ready'); });
  });

  /* ── 6. 카드 등장 ──────────────────────────────────────────── */

  var cards = Array.prototype.slice.call(document.querySelectorAll('.card'));

  if (reduce || !('IntersectionObserver' in window)) {
    cards.forEach(function (c) { c.classList.add('in'); });
  } else {
    var io = new IntersectionObserver(function (entries) {
      /* 같은 줄에 함께 들어온 카드끼리만 시차를 준다 */
      entries.filter(function (e) { return e.isIntersecting; })
        .forEach(function (e, i) {
          e.target.style.setProperty('--d', (i * 70) + 'ms');
          e.target.classList.add('in');
          io.unobserve(e.target);
        });
    }, { rootMargin: '0px 0px -8% 0px', threshold: 0.05 });

    cards.forEach(function (c) { io.observe(c); });
  }

  /* ── 7. 거르기 ─────────────────────────────────────────────── */

  var filters = document.getElementById('filters');
  if (filters) {
    filters.addEventListener('click', function (e) {
      var btn = e.target.closest('button[data-filter]');
      if (!btn) return;
      var want = btn.getAttribute('data-filter');

      filters.querySelectorAll('button').forEach(function (b) {
        b.setAttribute('aria-pressed', String(b === btn));
      });

      cards.forEach(function (c) {
        var show = want === 'all' || c.getAttribute('data-state') === want;
        c.classList.toggle('hide', !show);
      });

      measure();
    });
  }

  /* ── 8. 연도 ───────────────────────────────────────────────── */

  var year = document.getElementById('year');
  if (year) year.textContent = String(new Date().getFullYear());
})();
