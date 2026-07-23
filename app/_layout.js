/* ============================================================
 * _layout.js — 화면이 잘리는지 검사한다
 *
 * 왜 따로 있나
 *   _test.js / _test2.js 는 Node 에서 도는 계산 검사다.
 *   화면이 잘리는 문제는 CSS 배치의 문제라서 진짜 브라우저가 있어야 잡힌다.
 *   v8 에서 실제로 놓쳤다 — 계산 시험 34건이 전부 통과한 상태에서 화면은 잘려 있었다.
 *
 * 쓰는 법
 *   앱을 연 뒤 브라우저 개발자도구(F12) 콘솔에 이 파일 내용을 붙여넣는다.
 *   또는 주소창에서:  Layout.check()
 *
 * 무엇을 보나
 *   ① 맨 아래 내용이 하단 고정 버튼에 덮이지 않는가   ← v8 의 버그
 *   ② 자르기 손잡이가 사진 틀 밖으로 잘리지 않는가     ← v8 의 버그
 *   ③ 가로로 밀리지 않는가
 * ============================================================ */

(function (global) {
  "use strict";

  /* 맨 아래 내용이 하단 버튼에 덮이는가 */
  function bottomClear() {
    var wrap = document.querySelector('.wrap');
    var foot = document.querySelector('.foot');
    if (!wrap) return { skip: '.wrap 없음' };
    if (!foot) return { skip: '하단 버튼 없는 화면' };

    if (global.UI && UI.syncFootPad) UI.syncFootPad();
    global.scrollTo(0, document.documentElement.scrollHeight);

    var f = foot.getBoundingClientRect();
    var deepest = -1e9, last = null;
    wrap.querySelectorAll('*').forEach(function (el) {
      if (!el.offsetParent) return;                 /* 안 보이는 것 제외 */
      var r = el.getBoundingClientRect();
      if (r.height === 0) return;
      if (r.bottom > deepest) { deepest = r.bottom; last = el; }
    });
    if (!last) return { skip: '내용 없음' };

    return {
      이름: '맨 아래 내용이 버튼에 안 덮인다',
      마지막내용: (last.textContent || '').trim().slice(0, 20),
      여유: Math.round(f.top - deepest) + 'px',
      ok: deepest <= f.top
    };
  }

  /* 여백이 실제로 문서 높이를 늘렸는가.
     .wrap 이 아니라 body 에 여백을 주면 이 검사가 걸린다 (v8 의 원인). */
  function padEffective() {
    var wrap = document.querySelector('.wrap');
    var foot = document.querySelector('.foot');
    if (!wrap || !foot) return { skip: '해당 없음' };

    var before = document.documentElement.scrollHeight;
    var keep = wrap.style.paddingBottom;
    wrap.style.paddingBottom = '0px';
    var bare = document.documentElement.scrollHeight;
    wrap.style.paddingBottom = keep;
    var after = document.documentElement.scrollHeight;

    return {
      이름: '아래 여백이 문서 높이를 실제로 늘린다',
      여백없을때: bare, 여백줬을때: after,
      늘어난값: (after - bare) + 'px',
      필요한값: foot.offsetHeight + 'px',
      ok: (after - bare) >= foot.offsetHeight
    };
  }

  /* 자르기 손잡이가 사진 틀에 잘리는가 */
  function handlesVisible() {
    var st = document.querySelector('.stage2');
    if (!st) return { skip: '자르기 화면 아님' };
    var s = st.getBoundingClientRect(), worst = 0, who = '';
    ['.fit .hnd.t', '.fit .hnd.b'].forEach(function (sel) {
      var el = document.querySelector(sel);
      if (!el) return;
      var r = el.getBoundingClientRect();
      var cut = Math.max(0, s.top - r.top, r.bottom - s.bottom);
      if (cut > worst) { worst = cut; who = sel; }
    });
    return { 이름: '자르기 손잡이가 안 잘린다',
             잘린값: Math.round(worst) + 'px', 어디: who || '없음', ok: worst < 1 };
  }

  /* 가로로 밀리는가 */
  function noSideScroll() {
    var d = document.documentElement;
    return { 이름: '가로로 안 밀린다',
             문서폭: d.scrollWidth, 화면폭: d.clientWidth,
             ok: d.scrollWidth <= d.clientWidth + 1 };
  }

  function check() {
    var rs = [bottomClear(), padEffective(), handlesVisible(), noSideScroll()];
    var bad = 0;
    rs.forEach(function (r) {
      if (r.skip) { console.log('· 건너뜀 — ' + r.skip); return; }
      if (!r.ok) bad++;
      console.log((r.ok ? '✅ ' : '❌ ') + r.이름, r);
    });
    console.log(bad === 0 ? '✅ 화면 검사 통과' : '❌ 화면 문제 ' + bad + '건');
    return { ok: bad === 0, results: rs };
  }

  global.Layout = { check: check };
})(window);
