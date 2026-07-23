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
  var DEFAULT_CROP = 0.15;                  // 아래 15% 를 이름칸으로 본다

  /* 한 줄 메모를 빨리 넣도록 — 직원이 쓸 말을 미리 준비해 둔다.
     빈칸에 알아서 쓰라고 하면 아무도 안 쓴다. */
  var QUICK_NOTES = [
    '오늘 웃으시며 하셨어요',
    '색을 오래 고르셨어요',
    '끝까지 앉아서 다 하셨어요',
    '옆 어르신과 이야기하며 하셨어요',
    '처음 해보신다며 좋아하셨어요'
  ];

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

  /* 파일 목록을 걸러 큐 항목으로 만든다 */
  function toItems(fileList) {
    var files = Array.prototype.slice.call(fileList || []);
    if (!files.length) return [];

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

    if (rejected.length) UI.say(rejected.length + '개는 사진이 아니라 건너뜁니다', { tone: 'warn' });
    if (!ok.length) { UI.say('사진 파일이 아닙니다', { tone: 'warn' }); return []; }

    /* 파일명 순으로 — 폰 사진은 대개 시간순이 된다 */
    ok.sort(function (a, b) {
      return String(a.name).localeCompare(String(b.name), 'ko', { numeric: true });
    });

    return ok.map(function (f) {
      return {
        file: f,
        prepared: null,     // 큰 그림 (지금 보고 있는 장만)
        viewUrl: null,      // 큰 미리보기
        stripUrl: null,     // 목록 줄에 쓸 작은 그림 (전부 미리 만든다)
        elderId: null, note: '', cropRatio: DEFAULT_CROP, rot: 0,
        saved: false, saving: false, error: null
      };
    });
  }

  /* 목록 줄 그림을 뒤에서 하나씩 만든다.
     전부 한꺼번에 만들면 폰이 멈춘다 — 한 장씩 순서대로. */
  function buildStripThumbs() {
    var pending = S.queue.filter(function (it) { return !it.stripUrl && !it.error; });
    if (!pending.length) return;

    var i = 0;
    (function step() {
      if (i >= pending.length) return;
      var it = pending[i++];
      /* 큐가 바뀌었으면 멈춘다 */
      if (S.queue.indexOf(it) < 0) { step(); return; }
      Img.quickThumb(it.file, 140)
        .then(function (url) {
          it.stripUrl = url;
          if (S.screen === 'queue') render();
        })
        .catch(function () { it.stripUrl = null; })
        .then(function () { setTimeout(step, 0); });
    })();
  }

  /* 처음 고를 때 — 큐를 새로 만든다 */
  function acceptFiles(fileList) {
    var items = toItems(fileList);
    if (!items.length) return;
    if (items.length > MAX_FILES) {
      UI.say('한 번에 ' + MAX_FILES + '장까지만 받습니다', { tone: 'warn' });
      items = items.slice(0, MAX_FILES);
    }
    S.queue = items;
    S.idx = 0;
    S.screen = 'queue';
    render();
    prepareCurrent();
    buildStripThumbs();
  }

  /* 작업 중에 더 넣을 때 — 뒤에 이어 붙인다 */
  function appendFiles(fileList) {
    var items = toItems(fileList);
    if (!items.length) return;

    var room = MAX_FILES - S.queue.length;
    if (room <= 0) { UI.say('한 번에 ' + MAX_FILES + '장까지만 받습니다', { tone: 'warn' }); return; }
    if (items.length > room) {
      UI.say(room + '장만 더 넣었습니다 (최대 ' + MAX_FILES + '장)', { tone: 'warn' });
      items = items.slice(0, room);
    }

    /* 🔑 지금 보고 있는 장 "바로 뒤"에 끼워 넣는다.
       뒤에 붙이면 방금 찍은 사진을 확인하러 한참 넘어가야 한다. */
    var at = S.idx + 1;
    S.queue.splice.apply(S.queue, [at, 0].concat(items));

    UI.say(items.length + '장을 ' + (at + 1) + '번째에 넣었습니다', { tone: 'ok' });

    /* 방금 넣은 첫 장으로 바로 이동 */
    S.idx = at;
    prepareCurrent();
    buildStripThumbs();
  }

  /* 지금 장을 읽어 화면에 올린다 */
  function prepareCurrent() {
    var item = S.queue[S.idx];
    if (!item || item.prepared) { render(); return; }

    UI.setChip('사진 읽는 중…');
    Img.prepare(item.file)
      .then(function (prep) {
        item.prepared = prep;
        refreshView(item);
        if (!item.stripUrl) item.stripUrl = item.viewUrl;
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

  /* 썸네일을 눌러 그 장으로 바로 */
  function goTo(i) {
    if (i < 0 || i >= S.queue.length || i === S.idx) return;
    S.idx = i;
    prepareCurrent();
  }

  /* 돌린 각도를 반영해 큰 미리보기를 다시 만든다 (자르기는 화면에서 겹쳐 보여준다) */
  function refreshView(item) {
    if (!item || !item.prepared) return;
    item.viewUrl = Img.previewUrl(item.prepared, 0, item.rot);
  }

  /* dir: -1 왼쪽, +1 오른쪽 */
  function rotate(item, dir) {
    item.rot = (((item.rot || 0) + dir * 90) % 360 + 360) % 360;
    refreshView(item);
    render();
  }

  /* ── 어르신 ──────────────────────────────────── */

  function addElderPrompt() {
    var name = (prompt('어르신 성함을 적어주세요') || '').trim();
    if (!name) return;
    var e = Model.makeElder({ name: name });
    var errs = Model.validateElder(e);
    if (errs.length) { UI.say(errs[0], { tone: 'warn' }); return; }
    if (S.elders.some(function (x) { return x.name === name; })) {
      UI.say('이미 있는 이름입니다', { tone: 'warn' });
      return;
    }
    Store.saveElder(e).then(function () {
      S.elders.push(e);
      S.elders.sort(function (a, b) { return a.name.localeCompare(b.name, 'ko'); });
      var item = S.queue[S.idx];
      if (item) item.elderId = e.id;      /* 방금 넣은 분으로 바로 골라준다 */
      /* 명단에 이름이 생기고 곧바로 선택된 것이 보인다 — 따로 알리지 않는다 */
      render();
    });
  }

  function elderName(id) {
    var e = S.elders.filter(function (x) { return x.id === id; })[0];
    return e ? e.name : '';
  }

  /* ── 저장 ────────────────────────────────────── */

  function saveCurrent() {
    var item = S.queue[S.idx];
    if (!item || !item.prepared || item.saving) return;
    if (!item.elderId) { UI.say('어느 어르신 것인지 골라주세요', { tone: 'warn' }); return; }

    item.saving = true;
    render();
    UI.setChip('저장 중…');

    var rec = Model.makeRecord({
      elderId: item.elderId,
      kind: Model.Kind.ARTWORK,
      occurredAt: Model.todayLocal(),
      note: item.note,
      redacted: item.cropRatio > 0,
      redactRatio: item.cropRatio
    });

    Img.finalize(item.prepared, item.cropRatio, item.rot)
      .then(function (out) {
        rec.width = out.width;
        rec.height = out.height;
        rec.byteSize = out.byteSize;
        return Store.saveRecord(rec, { image: out.image, thumb: out.thumb });
      })
      .then(function () {
        item.saved = true;
        item.saving = false;
        Img.dispose(item.prepared);
        item.prepared = null;
        UI.setChip('브라우저에 저장 중', 'ok');
        /* 알리지 않는다 — 썸네일에 ✓ 가 뜨고 다음 장으로 넘어가는 것이 이미 답이다 */
        return refreshData();
      })
      .then(function () {
        /* 아직 저장 안 한 다음 장으로 */
        var next = -1;
        for (var i = S.idx + 1; i < S.queue.length; i++) {
          if (!S.queue[i].saved) { next = i; break; }
        }
        if (next < 0) {
          for (var j = 0; j < S.queue.length; j++) {
            if (!S.queue[j].saved) { next = j; break; }
          }
        }
        if (next < 0) { finishQueue(); return; }
        S.idx = next;
        prepareCurrent();
      })
      .catch(function (e) {
        item.saving = false;
        item.error = (e && e.message) || '저장하지 못했습니다';
        UI.setChip('저장 실패', 'warn');
        render();
      });
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

    /* 오늘 남긴 것 */
    var c2 = UI.card();
    c2.appendChild(UI.el('p', 'eyebrow', '오늘 남긴 것'));

    if (!S.todayRecords.length) {
      UI.empty(c2, '아직 없습니다.<br>위에서 사진을 고르시면 여기에 쌓입니다.');
    } else {
      var byElder = {};
      S.todayRecords.forEach(function (r) {
        byElder[r.elderId] = (byElder[r.elderId] || 0) + 1;
      });
      var st = UI.el('div', 'stat');
      st.appendChild(UI.el('span', null, S.todayRecords.length + '장'));
      st.appendChild(UI.el('span', null, '어르신 ' + Object.keys(byElder).length + '분'));
      c2.appendChild(st);

      var g = UI.el('div', 'grid');
      S.todayRecords.forEach(function (r) {
        var b = document.createElement('button');
        b.type = 'button';
        b.className = 'item';
        var im = document.createElement('img');
        im.alt = elderName(r.elderId) + ' 어르신의 작품';
        b.appendChild(im);
        var cap = UI.el('div', 'cap');
        cap.appendChild(UI.el('div', 'nm', UI.esc(elderName(r.elderId))));
        cap.appendChild(UI.el('div', 'mm', UI.esc(r.note || '—')));
        b.appendChild(cap);
        b.addEventListener('click', function () { confirmDelete(r); });
        g.appendChild(b);

        Store.getThumb(r.id).then(function (blob) {
          if (blob) im.src = URL.createObjectURL(blob);
        });
      });
      c2.appendChild(g);
      c2.appendChild(UI.el('div', 'note', '누르면 지울 수 있습니다.'));
    }

    /* 전체 현황 */
    Store.stats().then(function (s) {
      var c3 = UI.card();
      c3.appendChild(UI.el('p', 'eyebrow', '지금까지'));
      var st2 = UI.el('div', 'stat');
      st2.appendChild(UI.el('span', null, '어르신 ' + s.elders + '분'));
      st2.appendChild(UI.el('span', null, '기록 ' + s.records + '장'));
      st2.appendChild(UI.el('span', null, Img.humanSize(s.bytes)));
      c3.appendChild(st2);
      c3.appendChild(UI.el('div', 'note',
        '지금은 <b>이 브라우저 안에만</b> 저장됩니다. ' +
        '다른 기기나 가족에게는 아직 보이지 않습니다.'));
    });

    UI.buttons([]);
  }

  /* 지우기 — 실제로 지우지 않고 표시만 하므로 되돌릴 수 있다.
     "지웠습니다"라고 알리는 것보다 "되돌릴 수 있다"고 알리는 편이 쓸모 있다. */
  function confirmDelete(rec) {
    if (!confirm(elderName(rec.elderId) + ' 어르신 기록을 지울까요?')) return;
    Store.removeRecord(rec.id)
      .then(refreshData)
      .then(function () {
        render();
        UI.say(elderName(rec.elderId) + ' 어르신 기록을 지웠습니다', {
          tone: 'warn',
          action: {
            label: '되돌리기',
            fn: function () { undoDelete(rec.id); }
          }
        });
      });
  }

  function undoDelete(id) {
    Store.getRecord(id).then(function (r) {
      if (!r) return;
      r.deletedAt = null;
      r.updatedAt = Model.nowIso();
      return Store.saveRecord(r)
        .then(refreshData)
        .then(function () {
          render();
          UI.say('되돌렸습니다', { tone: 'ok' });
        });
    });
  }

  /* ── 큐 (1단계 범위: 사진을 받아 한 장씩 보여주는 데까지) ── */
  function renderQueue() {
    var item = S.queue[S.idx];
    if (!item) { finishQueue(); return; }

    /* 상단 바 — 나가기 · 더 넣기 */
    var bar = UI.el('div', 'qbar');
    var out = document.createElement('button');
    out.type = 'button';
    out.className = 'tbtn';
    out.textContent = '✕ 나가기';
    out.addEventListener('click', function () {
      if (S.queue.length > 1 && !confirm('고른 사진 ' + S.queue.length + '장을 모두 버리고 나갈까요?')) return;
      finishQueue();
    });
    bar.appendChild(out);
    bar.appendChild(UI.el('div', 'sp'));
    bar.appendChild(UI.pickButton('📷 더 찍기', { capture: true }, appendFiles));
    bar.appendChild(UI.pickButton('＋ 더 넣기', { multiple: true, accent: true }, appendFiles));
    UI.view.appendChild(bar);

    var c = UI.card();
    UI.progress(c, S.idx + 1, S.queue.length);
    c.appendChild(UI.el('p', 'eyebrow', '사진 확인'));
    c.appendChild(UI.el('h2', null,
      S.queue.length > 1 ? (S.queue.length + '장 중 ' + (S.idx + 1) + '번째') : '사진을 확인해 주세요'));

    if (item.error) {
      UI.msg(c, 'warn', '이 사진을 처리하지 못했습니다.<br>' +
        '<span style="font-size:.82rem">' + UI.esc(item.error) + '</span>');
      var rm0 = document.createElement('button');
      rm0.type = 'button'; rm0.className = 'tbtn'; rm0.style.marginTop = '.6rem';
      rm0.textContent = '🗑 이 사진 빼기';
      rm0.addEventListener('click', skipCurrent);
      c.appendChild(rm0);

    } else if (item.saved) {
      UI.msg(c, 'ok', '<b>' + UI.esc(elderName(item.elderId)) + ' 어르신</b>으로 저장했습니다.');

    } else if (!item.prepared) {
      UI.empty(c, '사진을 읽고 있습니다…');

    } else {
      /* ── 사진 + 자를 자리 ──
         틀 높이를 고정하고 그 안에서만 사진이 바뀌게 한다 */
      var stage = UI.el('div', 'stage2');
      var fit = UI.el('div', 'fit');
      var im = document.createElement('img');
      im.src = item.viewUrl;
      im.alt = '고른 사진';
      fit.appendChild(im);
      var cut = UI.el('div', 'cut');
      cut.style.height = Math.round(item.cropRatio * 100) + '%';
      cut.appendChild(UI.el('span', null, item.cropRatio > 0 ? '이 부분이 지워집니다' : ''));
      fit.appendChild(cut);
      stage.appendChild(fit);
      c.appendChild(stage);

      /* 돌리기(좌·우) + 자를 위치 */
      var ctl = UI.el('div', 'cropctl');
      var rots = UI.el('div', 'rots');
      var rotL = document.createElement('button');
      rotL.type = 'button'; rotL.className = 'rotbtn';
      rotL.textContent = '↺';
      rotL.title = '왼쪽으로 돌리기';
      rotL.setAttribute('aria-label', '왼쪽으로 돌리기');
      rotL.addEventListener('click', function () { rotate(item, -1); });
      var rotR = document.createElement('button');
      rotR.type = 'button'; rotR.className = 'rotbtn';
      rotR.textContent = '↻';
      rotR.title = '오른쪽으로 돌리기';
      rotR.setAttribute('aria-label', '오른쪽으로 돌리기');
      rotR.addEventListener('click', function () { rotate(item, 1); });
      rots.appendChild(rotL);
      rots.appendChild(rotR);
      ctl.appendChild(rots);

      var sl = document.createElement('input');
      sl.type = 'range'; sl.min = '0'; sl.max = '40'; sl.step = '1';
      sl.value = String(Math.round(item.cropRatio * 100));
      sl.setAttribute('aria-label', '지울 부분의 크기');
      sl.addEventListener('input', function (e) {
        item.cropRatio = Number(e.target.value) / 100;
        cut.style.height = e.target.value + '%';
        cut.firstChild.textContent = item.cropRatio > 0 ? '이 부분이 지워집니다' : '';
        vlab.textContent = e.target.value + '%';
      });
      ctl.appendChild(sl);
      var vlab = UI.el('div', 'v', Math.round(item.cropRatio * 100) + '%');
      ctl.appendChild(vlab);
      c.appendChild(ctl);

      c.appendChild(UI.el('div', 'note',
        '작품에 적힌 <b>이름이 빗금 안에 들어가는지</b> 확인해 주세요. ' +
        '이름칸이 옆이나 위에 있으면 <b>↺ ↻</b> 로 아래로 오게 돌리시면 됩니다.'));

      /* ── 어느 어르신 것인지 ── */
      var sec1 = UI.el('div', 'sect');
      sec1.appendChild(UI.el('div', 'lbl', '어느 어르신 것인가요? <span class="req">*</span>'));
      var names = UI.el('div', 'names');
      S.elders.forEach(function (e) {
        var b = document.createElement('button');
        b.type = 'button';
        b.textContent = e.name;
        if (item.elderId === e.id) b.className = 'sel';
        b.addEventListener('click', function () { item.elderId = e.id; render(); });
        names.appendChild(b);
      });
      var addb = document.createElement('button');
      addb.type = 'button'; addb.className = 'add';
      addb.textContent = '＋ 어르신 추가';
      addb.addEventListener('click', addElderPrompt);
      names.appendChild(addb);
      sec1.appendChild(names);
      if (!S.elders.length) {
        sec1.appendChild(UI.el('div', 'note',
          '아직 명단이 없습니다. <b>＋ 어르신 추가</b>를 눌러 넣어주세요. 한 번만 넣으면 계속 씁니다.'));
      }
      c.appendChild(sec1);

      /* ── 한 줄 메모 ── */
      var sec2 = UI.el('div', 'sect');
      sec2.appendChild(UI.el('div', 'lbl', '오늘 어떠셨나요? <span style="font-weight:400">(안 쓰셔도 됩니다)</span>'));
      var memo = document.createElement('input');
      memo.type = 'text'; memo.className = 'memo';
      memo.placeholder = '한 줄이면 충분합니다';
      memo.value = item.note;
      memo.addEventListener('input', function (e) { item.note = e.target.value; });
      sec2.appendChild(memo);
      var quick = UI.el('div', 'quick');
      QUICK_NOTES.forEach(function (t) {
        var b = document.createElement('button');
        b.type = 'button'; b.textContent = t;
        b.addEventListener('click', function () { item.note = t; memo.value = t; });
        quick.appendChild(b);
      });
      sec2.appendChild(quick);
      c.appendChild(sec2);

      /* 이 사진 빼기 */
      var rm = document.createElement('button');
      rm.type = 'button'; rm.className = 'tbtn'; rm.style.marginTop = 'var(--s3)';
      rm.textContent = '🗑 이 사진 빼기';
      rm.addEventListener('click', skipCurrent);
      c.appendChild(rm);
    }

    UI.queueStrip(c, S.queue, S.idx, goTo);

    var canSave = item.prepared && !item.saved && !item.saving;
    UI.buttons([
      { label: '← 이전', fn: goPrev, ghost: true, off: S.idx === 0 },
      item.saved
        ? { label: S.idx < S.queue.length - 1 ? '다음 →' : '마치기', fn: goNext }
        : { label: item.saving ? '저장 중…' : '저장하고 다음 →',
            fn: saveCurrent, off: !canSave }
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
