/* ============================================================
 * app.js — 흐름 제어
 *
 * 화면 상태
 *   home    오늘 올린 것 + [사진 고르기]
 *   queue   받은 사진을 한 장씩 처리   ← 1단계에서 만드는 부분
 *     ├ pick    어느 어르신 것인지     (2단계)
 *     ├ redact  이름칸 자르기          (3단계)
 *     └ save    저장 → 다음 장         (4단계)
 *   elders  명단 관리                  (2단계)
 * ============================================================ */

(function (global) {
  "use strict";

  var MAX_FILES = 30;                       // 한 번에 받을 수 있는 장수
  var OK_TYPES = /^image\/(jpeg|png|webp|heic|heif)$/i;

  /* 앱 전체 상태 */
  var S = {
    screen: 'home',
    queue: [],        // [{file, prepared, thumbUrl, elderId, note, cropRatio, saved, error}]
    idx: 0,
    elders: [],
    todayRecords: []
  };

  /* ── 시작 ─────────────────────────────────────── */

  function boot() {
    UI.init();
    UI.setChip('여는 중…');
    Store.ready()
      .then(refreshData)
      .then(function () {
        UI.setChip('브라우저에 저장 중', 'ok');
        render();
      })
      .catch(function (e) {
        UI.setChip('저장소 오류', 'warn');
        UI.clear();
        var c = UI.card();
        c.appendChild(UI.el('h2', null, '저장소를 열지 못했습니다'));
        UI.msg(c, 'warn', '브라우저의 저장 기능을 쓸 수 없는 상태입니다.<br>' +
          '시크릿 모드이거나 저장이 꺼져 있을 수 있습니다.<br><br>' +
          '<span style="font-size:.82rem;color:var(--muted)">' + UI.esc(e && e.message || e) + '</span>');
      });
  }

  function refreshData() {
    return Promise.all([
      Store.listElders(),
      Store.listRecords({ occurredAt: Model.todayLocal() })
    ]).then(function (r) {
      S.elders = r[0];
      S.todayRecords = r[1];
    });
  }

  /* ── 파일 받기 ────────────────────────────────── */

  function acceptFiles(fileList) {
    var files = Array.prototype.slice.call(fileList || []);
    if (!files.length) return;

    var rejected = [];
    var ok = files.filter(function (f) {
      if (!f.type || !OK_TYPES.test(f.type)) {
        /* HEIC 은 type 이 비어 오는 기기가 있어 확장자로도 한 번 본다 */
        if (!/\.(jpe?g|png|webp|heic|heif)$/i.test(f.name || '')) {
          rejected.push(f.name || '이름 없음');
          return false;
        }
      }
      return true;
    });

    if (ok.length > MAX_FILES) {
      UI.say('한 번에 ' + MAX_FILES + '장까지만 받습니다');
      ok = ok.slice(0, MAX_FILES);
    }
    if (!ok.length) {
      UI.say('사진 파일이 아닙니다');
      return;
    }
    if (rejected.length) {
      UI.say(rejected.length + '개는 사진이 아니라 건너뜁니다');
    }

    /* 파일명 순으로 — 폰 사진은 대개 시간순이 된다 */
    ok.sort(function (a, b) { return String(a.name).localeCompare(String(b.name), 'ko', { numeric: true }); });

    S.queue = ok.map(function (f) {
      return {
        file: f, prepared: null, thumbUrl: null,
        elderId: null, note: '', cropRatio: 0.15,
        saved: false, error: null
      };
    });
    S.idx = 0;
    S.screen = 'queue';
    render();
    prepareCurrent();
  }

  /* 지금 장을 읽어 화면에 올린다 */
  function prepareCurrent() {
    var item = S.queue[S.idx];
    if (!item || item.prepared) { render(); return; }

    UI.setChip('사진 읽는 중…');
    Img.prepare(item.file)
      .then(function (prep) {
        item.prepared = prep;
        item.thumbUrl = Img.previewUrl(prep, 0);   // 목록용은 자르지 않은 것
        UI.setChip('브라우저에 저장 중', 'ok');
        render();
      })
      .catch(function (e) {
        item.error = (e && e.message) || '사진을 읽지 못했습니다';
        UI.setChip('브라우저에 저장 중', 'ok');
        render();
      });
  }

  function goNext() {
    if (S.idx < S.queue.length - 1) {
      S.idx++;
      prepareCurrent();
    } else {
      finishQueue();
    }
  }

  function goPrev() {
    if (S.idx > 0) { S.idx--; prepareCurrent(); }
  }

  function skipCurrent() {
    var item = S.queue[S.idx];
    if (item && item.prepared) Img.dispose(item.prepared);
    S.queue.splice(S.idx, 1);
    if (!S.queue.length) { finishQueue(); return; }
    if (S.idx >= S.queue.length) S.idx = S.queue.length - 1;
    prepareCurrent();
  }

  function finishQueue() {
    S.queue.forEach(function (it) { if (it.prepared) Img.dispose(it.prepared); });
    S.queue = [];
    S.idx = 0;
    S.screen = 'home';
    refreshData().then(render);
  }

  /* ── 화면 ─────────────────────────────────────── */

  function render() {
    UI.clear();
    if (S.screen === 'home')  return renderHome();
    if (S.screen === 'queue') return renderQueue();
    renderHome();
  }

  /* ── 홈 ── */
  function renderHome() {
    var c = UI.card();
    c.appendChild(UI.el('p', 'eyebrow', Model.todayLocal().replace(/-/g, '. ')));
    c.appendChild(UI.el('h2', null, '오늘 걷은 작품을 남깁니다'));
    c.appendChild(UI.el('p', 'lede',
      '작품을 <b>여러 장 한꺼번에</b> 고르실 수 있습니다. 한 장씩 확인하며 넘어갑니다.'));

    /* 받는 곳 */
    var drop = UI.el('div', 'drop');
    drop.setAttribute('role', 'button');
    drop.tabIndex = 0;
    drop.innerHTML =
      '<div class="big">여기에 사진을 끌어다 놓으세요</div>' +
      '<div class="sm">또는 아래에서 고르시면 됩니다<br>' +
      '한 번에 ' + MAX_FILES + '장까지</div>';

    ['dragenter', 'dragover'].forEach(function (ev) {
      drop.addEventListener(ev, function (e) { e.preventDefault(); drop.classList.add('over'); });
    });
    ['dragleave', 'drop'].forEach(function (ev) {
      drop.addEventListener(ev, function (e) { e.preventDefault(); drop.classList.remove('over'); });
    });
    drop.addEventListener('drop', function (e) {
      e.preventDefault();
      acceptFiles(e.dataTransfer && e.dataTransfer.files);
    });
    c.appendChild(drop);

    /* 고르는 방법 두 가지 */
    var ways = UI.el('div', 'ways');

    var wPick = document.createElement('label');
    wPick.className = 'way';
    wPick.innerHTML = '<span class="ic">🖼</span><span>사진 고르기' +
      '<span class="d">폰 사진첩 · PC 파일 · 여러 장</span></span>';
    var inPick = document.createElement('input');
    inPick.type = 'file'; inPick.accept = 'image/*'; inPick.multiple = true;
    inPick.addEventListener('change', function (e) {
      acceptFiles(e.target.files);
      e.target.value = '';
    });
    wPick.appendChild(inPick);
    ways.appendChild(wPick);

    var wCam = document.createElement('label');
    wCam.className = 'way';
    wCam.innerHTML = '<span class="ic">📷</span><span>지금 찍기' +
      '<span class="d">폰에서 카메라가 바로 열립니다</span></span>';
    var inCam = document.createElement('input');
    inCam.type = 'file'; inCam.accept = 'image/*';
    inCam.setAttribute('capture', 'environment');
    inCam.addEventListener('change', function (e) {
      acceptFiles(e.target.files);
      e.target.value = '';
    });
    wCam.appendChild(inCam);
    ways.appendChild(wCam);

    c.appendChild(ways);
    drop.addEventListener('click', function () { inPick.click(); });
    drop.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); inPick.click(); }
    });

    /* 오늘 올린 것 (4단계에서 채운다) */
    var c2 = UI.card();
    c2.appendChild(UI.el('p', 'eyebrow', '오늘 남긴 것'));
    if (!S.todayRecords.length) {
      UI.empty(c2, '아직 없습니다.<br>위에서 사진을 고르시면 여기에 쌓입니다.');
    } else {
      c2.appendChild(UI.el('div', 'note', S.todayRecords.length + '장'));
    }

    UI.buttons([]);
  }

  /* ── 큐 (1단계 범위: 사진을 받아 한 장씩 보여주는 데까지) ── */
  function renderQueue() {
    var item = S.queue[S.idx];
    if (!item) { finishQueue(); return; }

    var c = UI.card();
    UI.progress(c, S.idx + 1, S.queue.length);
    c.appendChild(UI.el('p', 'eyebrow', '사진 확인'));
    c.appendChild(UI.el('h2', null,
      S.queue.length > 1 ? (S.queue.length + '장 중 ' + (S.idx + 1) + '번째') : '사진을 확인해 주세요'));

    if (item.error) {
      UI.msg(c, 'warn', '이 사진을 읽지 못했습니다.<br>' +
        '<span style="font-size:.82rem">' + UI.esc(item.error) + '</span>');
    } else if (!item.prepared) {
      UI.empty(c, '사진을 읽고 있습니다…');
    } else {
      var wrap = UI.el('div', 'shotwrap');
      var im = document.createElement('img');
      im.className = 'shot';
      im.src = item.thumbUrl;
      im.alt = '고른 사진';
      wrap.appendChild(im);
      c.appendChild(wrap);

      var meta = UI.el('div', 'meta');
      meta.appendChild(UI.el('span', null, item.prepared.width + ' × ' + item.prepared.height));
      meta.appendChild(UI.el('span', null, Img.humanSize(item.file.size)));
      meta.appendChild(UI.el('span', null, '↻ 방향 보정됨'));
      c.appendChild(meta);

      c.appendChild(UI.el('div', 'note',
        '사진이 <b>똑바로</b> 보이면 다음으로 넘어가세요. ' +
        '누워 보이면 알려주세요 — 고쳐야 합니다.'));
    }

    UI.queueStrip(c, S.queue, S.idx);

    UI.buttons([
      { label: '건너뛰기', fn: skipCurrent, ghost: true },
      { label: S.idx > 0 ? '← 이전' : '그만두기', fn: S.idx > 0 ? goPrev : finishQueue, ghost: true },
      { label: S.idx < S.queue.length - 1 ? '다음 →' : '마치기',
        fn: goNext, off: !item.prepared && !item.error }
    ]);
  }

  /* ── 시작 ── */
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }

  global.App = S;   /* 디버깅용 */
})(window);
