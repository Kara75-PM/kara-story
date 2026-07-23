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

  var TRASH_DAYS = 30;                      // 지운 것을 이 기간 뒤 완전 삭제

  /* 앱 전체 상태 */
  var S = {
    screen: 'home',                         // home | queue | edit
    queue: [],
    idx: 0,
    elders: [],
    todayRecords: [],
    deletedRecords: [],
    /* 지운 것이 있으면 처음부터 펼쳐 둔다.
       접혀 있으면 되돌리는 길이 있는 줄도 모른다. */
    showTrash: true,
    edit: null                              // {rec, elderId, note, imgUrl}
  };

  /* ── 시작 ─────────────────────────────────────── */

  function boot() {
    UI.init();
    UI.setChip('여는 중…');
    Store.ready()
      /* 지운 지 오래된 것을 조용히 정리한다. 실패해도 앱은 계속 돈다. */
      .then(function () {
        return Store.purgeExpired(TRASH_DAYS).catch(function () { return 0; });
      })
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
      Store.listRecords({ occurredAt: Model.todayLocal() }),
      Store.listRecords({ deleted: true })
    ]).then(function (r) {
      S.elders = r[0];
      S.todayRecords = r[1];
      S.deletedRecords = r[2];
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

  function addElderPrompt(onAdded) {
    var name = (prompt('어르신 성함을 적어주세요') || '').trim();
    if (!name) return;
    var e = Model.makeElder({ name: name });
    var errs = Model.validateElder(e);
    if (errs.length) { UI.say(errs[0], { tone: 'warn' }); return; }

    var dup = S.elders.filter(function (x) { return x.name === name; })[0];
    if (dup) {
      UI.say('이미 있는 이름입니다', { tone: 'warn' });
      if (onAdded) onAdded(dup.id);        /* 있는 분을 골라준다 */
      return;
    }

    Store.saveElder(e).then(function () {
      S.elders.push(e);
      S.elders.sort(function (a, b) { return a.name.localeCompare(b.name, 'ko'); });
      /* 방금 넣은 분으로 바로 골라준다 — 명단에 뜨고 선택된 것이 보이므로 따로 알리지 않는다 */
      if (onAdded) onAdded(e.id);
      else render();
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
    if (S.screen === 'edit')  return renderEdit();
    renderHome();
  }

  /* 어르신 고르는 줄 — 새로 올릴 때도, 고칠 때도 같은 모양이어야 한다 */
  function elderPicker(host, selectedId, onPick, onAdded) {
    var names = UI.el('div', 'names');
    S.elders.forEach(function (e) {
      var b = document.createElement('button');
      b.type = 'button';
      b.textContent = e.name;
      if (selectedId === e.id) b.className = 'sel';
      b.addEventListener('click', function () { onPick(e.id); });
      names.appendChild(b);
    });
    var addb = document.createElement('button');
    addb.type = 'button'; addb.className = 'add';
    addb.textContent = '＋ 어르신 추가';
    addb.addEventListener('click', function () { addElderPrompt(onAdded); });
    names.appendChild(addb);
    host.appendChild(names);
    if (!S.elders.length) {
      host.appendChild(UI.el('div', 'note',
        '아직 명단이 없습니다. <b>＋ 어르신 추가</b>를 눌러 넣어주세요. 한 번만 넣으면 계속 씁니다.'));
    }
    return names;
  }

  /* 한 줄 메모 입력 + 빠른 문구 */
  function noteInput(host, value, onChange) {
    var memo = document.createElement('input');
    memo.type = 'text'; memo.className = 'memo';
    memo.placeholder = '한 줄이면 충분합니다';
    memo.value = value || '';
    memo.addEventListener('input', function (e) { onChange(e.target.value); });
    host.appendChild(memo);
    var quick = UI.el('div', 'quick');
    QUICK_NOTES.forEach(function (t) {
      var b = document.createElement('button');
      b.type = 'button'; b.textContent = t;
      b.addEventListener('click', function () { memo.value = t; onChange(t); });
      quick.appendChild(b);
    });
    host.appendChild(quick);
    return memo;
  }

  /* ── 고치기 화면 ── */
  function renderEdit() {
    var e = S.edit;
    if (!e) { S.screen = 'home'; renderHome(); return; }

    var c = UI.card();
    c.appendChild(UI.el('p', 'eyebrow', Model.periodLabel(e.rec)));
    c.appendChild(UI.el('h2', null, '기록 고치기'));

    /* 사진 바로 위에 「지우기」 — 하단 닫기와 겹치지 않게 여기 둔다 */
    var sbar = UI.el('div', 'shotbar');
    sbar.appendChild(UI.el('div', 'cnt', UI.esc(elderName(e.rec.elderId) || '')));
    sbar.appendChild(UI.el('div', 'sp'));
    var rm = document.createElement('button');
    rm.type = 'button'; rm.className = 'tbtn danger';
    rm.textContent = '🗑 이 기록 지우기';
    rm.addEventListener('click', function () { confirmDelete(e.rec, true); });
    sbar.appendChild(rm);
    c.appendChild(sbar);

    if (e.imgUrl) {
      var stage = UI.el('div', 'stage2');
      var fit = UI.el('div', 'fit');
      var im = document.createElement('img');
      im.src = e.imgUrl;
      im.alt = elderName(e.rec.elderId) + ' 어르신의 작품';
      fit.appendChild(im);
      stage.appendChild(fit);
      c.appendChild(stage);
    } else {
      UI.empty(c, '사진을 불러오는 중…');
    }

    c.appendChild(UI.el('div', 'note',
      '사진 자체는 고칠 수 없습니다. <b>이름칸은 이미 지워진 상태</b>로 저장돼 있습니다. ' +
      '사진을 바꾸려면 지우고 다시 올려주세요.'));

    var sec1 = UI.el('div', 'sect');
    sec1.appendChild(UI.el('div', 'lbl', '어느 어르신 것인가요? <span class="req">*</span>'));
    elderPicker(sec1, e.elderId,
      function (id) { e.elderId = id; render(); },
      function (id) { e.elderId = id; render(); });
    c.appendChild(sec1);

    var sec2 = UI.el('div', 'sect');
    sec2.appendChild(UI.el('div', 'lbl', '오늘 어떠셨나요? <span style="font-weight:400">(안 쓰셔도 됩니다)</span>'));
    noteInput(sec2, e.note, function (v) { e.note = v; });
    c.appendChild(sec2);

    UI.buttons([
      { label: '닫기', fn: closeEdit, ghost: true },
      { label: '고친 내용 저장', fn: saveEdit }
    ]);
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
        b.addEventListener('click', function () { openEdit(r); });
        g.appendChild(b);

        Store.getThumb(r.id).then(function (blob) {
          if (blob) im.src = URL.createObjectURL(blob);
        });
      });
      c2.appendChild(g);
      c2.appendChild(UI.el('div', 'note',
        '누르면 <b>어르신·메모를 고치거나</b> 지울 수 있습니다.'));
    }

    /* 🗑 지운 것 */
    if (S.deletedRecords.length) renderTrash();

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

  /* ── 🗑 지운 것 ── */
  function renderTrash() {
    var c = UI.card();

    var head = UI.el('div', 'trashhead');
    var tog = document.createElement('button');
    tog.type = 'button'; tog.className = 'trashtog';
    tog.textContent = (S.showTrash ? '▾' : '▸') + ' 🗑 지운 것 ' + S.deletedRecords.length + '개';
    tog.setAttribute('aria-expanded', S.showTrash ? 'true' : 'false');
    tog.addEventListener('click', function () { S.showTrash = !S.showTrash; render(); });
    head.appendChild(tog);
    c.appendChild(head);

    if (!S.showTrash) {
      c.appendChild(UI.el('div', 'note',
        '위를 눌러 펼치면 <b>되돌리기</b>와 <b>완전히 지우기</b>를 할 수 있습니다.'));
      return;
    }

    var list = UI.el('div', 'trash');
    S.deletedRecords.forEach(function (r) {
      var row = UI.el('div', 'trow');

      var im = document.createElement('img');
      im.alt = '';
      row.appendChild(im);
      Store.getThumb(r.id).then(function (blob) {
        if (blob) im.src = URL.createObjectURL(blob);
      });

      var info = UI.el('div', 'tinfo');
      info.appendChild(UI.el('div', 'nm', UI.esc(elderName(r.elderId) || '(이름 없음)')));
      var d = daysSince(r.deletedAt);
      var left = Math.max(0, TRASH_DAYS - d);
      info.appendChild(UI.el('div', 'mm',
        UI.esc(Model.periodLabel(r)) + ' · ' +
        (d === 0 ? '오늘 지움' : d + '일 전 지움')));
      info.appendChild(UI.el('div', 'mm',
        left <= 3
          ? '<b style="color:var(--alert)">' + left + '일 뒤 완전히 사라집니다</b>'
          : left + '일 뒤 완전히 사라집니다'));
      row.appendChild(info);

      var acts = UI.el('div', 'tacts');
      var back = document.createElement('button');
      back.type = 'button'; back.className = 'tbtn add';
      back.textContent = '되돌리기';
      back.addEventListener('click', function () { restoreRecord(r); });
      acts.appendChild(back);

      var gone = document.createElement('button');
      gone.type = 'button'; gone.className = 'tbtn danger';
      gone.textContent = '완전히 지우기';
      gone.addEventListener('click', function () { confirmPurge(r); });
      acts.appendChild(gone);
      row.appendChild(acts);

      list.appendChild(row);
    });
    c.appendChild(list);

    c.appendChild(UI.el('div', 'note',
      '지운 것은 <b>' + TRASH_DAYS + '일 뒤 자동으로 완전히 사라집니다.</b><br>' +
      '어르신이나 가족이 <b>빼달라고 하신 것</b>은 「완전히 지우기」로 바로 없애주세요.'));
  }

  /* ── 고치기 ─────────────────────────────────────
   *
   * 저장한 뒤에 어르신을 잘못 골랐으면, 지우고 다시 올리는 게 아니라
   * 고칠 수 있어야 한다. 그것이 지우기를 줄이는 근본 해법이다.
   */
  function openEdit(rec) {
    S.edit = { rec: rec, elderId: rec.elderId, note: rec.note || '', imgUrl: null };
    S.screen = 'edit';
    render();
    Store.getImage(rec.id).then(function (blob) {
      if (!blob || !S.edit || S.edit.rec.id !== rec.id) return;
      S.edit.imgUrl = URL.createObjectURL(blob);
      if (S.screen === 'edit') render();
    });
  }

  function closeEdit() {
    if (S.edit && S.edit.imgUrl) URL.revokeObjectURL(S.edit.imgUrl);
    S.edit = null;
    S.screen = 'home';
    render();
  }

  function saveEdit() {
    var e = S.edit;
    if (!e) return;
    if (!e.elderId) { UI.say('어느 어르신 것인지 골라주세요', { tone: 'warn' }); return; }

    var changed = (e.elderId !== e.rec.elderId) || (e.note !== (e.rec.note || ''));
    if (!changed) { closeEdit(); return; }

    var r = e.rec;
    r.elderId = e.elderId;
    r.note = e.note;
    r.updatedAt = Model.nowIso();

    Store.saveRecord(r)
      .then(refreshData)
      .then(function () {
        closeEdit();
        UI.say('고쳤습니다', { tone: 'ok' });
      })
      .catch(function () {
        UI.say('고치지 못했습니다', { tone: 'warn' });
      });
  }

  /* ── 지우기 ─────────────────────────────────────
   *
   * 1) 지우기       → 🗑 지운 것으로. 언제든 되돌릴 수 있다
   * 2) 완전히 지우기 → 사진까지 없앤다. 되돌릴 수 없다
   *
   * 알림에 되돌리기를 걸지 않는다. 알림은 사라지는 것이 본분이고,
   * 되돌리기는 사라지면 안 되기 때문이다. 🗑 목록이 그 자리다.
   */
  function confirmDelete(rec, fromEdit) {
    var who = UI.esc(elderName(rec.elderId));
    UI.ask({
      title: who + ' 어르신 기록을 지울까요?',
      body: '<b>🗑 지운 것</b>으로 옮겨집니다.<br>언제든 되돌릴 수 있습니다.',
      okLabel: '지우기',
      cancelLabel: '그대로 두기'
    }).then(function (ok) {
      if (!ok) return;
      return Store.removeRecord(rec.id)
        .then(refreshData)
        .then(function () {
          S.showTrash = true;
          if (fromEdit) closeEdit(); else render();
          UI.say('지웠습니다 · 아래 「지운 것」에서 되돌릴 수 있습니다', { tone: 'warn' });
        });
    });
  }

  function restoreRecord(rec) {
    Store.restoreRecord(rec.id)
      .then(refreshData)
      .then(function () {
        render();
        UI.say(elderName(rec.elderId) + ' 어르신 기록을 되돌렸습니다', { tone: 'ok' });
      });
  }

  /* 완전히 지우기 — 두 번 묻는다.
     두 번째는 버튼 위치를 바꾼다. 같은 자리를 연타해도 「취소」가 눌리도록. */
  function confirmPurge(rec) {
    var who = UI.esc(elderName(rec.elderId));
    UI.ask({
      warn: '되돌릴 수 없습니다',
      title: who + ' 어르신 기록을 완전히 지울까요?',
      body: '<b>사진까지 함께 사라집니다.</b><br>' +
            '어르신이나 가족이 빼달라고 하신 경우가 여기에 해당합니다.',
      okLabel: '완전히 지우기',
      cancelLabel: '취소',
      danger: true
    }).then(function (ok1) {
      if (!ok1) return;
      return UI.ask({
        warn: '마지막 확인입니다',
        title: '정말 지울까요?',
        body: '<b>' + who + '</b> 어르신의 이 사진은 <b>복구할 수 없습니다.</b><br>' +
              '<span style="font-size:.84rem;color:var(--muted)">' +
              '실수를 막기 위해 버튼 자리를 바꿔 두었습니다.</span>',
        okLabel: '네, 완전히 지웁니다',
        cancelLabel: '아니요',
        danger: true,
        swap: true                      /* 🔑 확인이 왼쪽 — 연타 방지 */
      });
    }).then(function (ok2) {
      if (!ok2) return;
      return Store.purgeRecord(rec.id)
        .then(refreshData)
        .then(function () {
          render();
          UI.say('완전히 지웠습니다', { tone: 'warn' });
        });
    });
  }

  /* 지운 지 며칠 됐는지 */
  function daysSince(iso) {
    if (!iso) return 0;
    return Math.floor((Date.now() - new Date(iso).getTime()) / 86400000);
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
      var left = S.queue.filter(function (q) { return !q.saved; }).length;
      if (!left) { finishQueue(); return; }
      UI.ask({
        title: '나갈까요?',
        body: '아직 저장하지 않은 사진 <b>' + left + '장</b>이 있습니다.<br>나가면 사라집니다.',
        okLabel: '나가기',
        cancelLabel: '계속하기',
        danger: true
      }).then(function (ok) { if (ok) finishQueue(); });
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
      /* 사진 바로 위에 「빼기」를 둔다 — 맨 아래에 있으면 못 찾는다 */
      var sbar = UI.el('div', 'shotbar');
      sbar.appendChild(UI.el('div', 'cnt', (S.idx + 1) + ' / ' + S.queue.length));
      sbar.appendChild(UI.el('div', 'sp'));
      var rmTop = document.createElement('button');
      rmTop.type = 'button'; rmTop.className = 'tbtn danger';
      rmTop.textContent = '🗑 이 사진 빼기';
      rmTop.addEventListener('click', skipCurrent);
      sbar.appendChild(rmTop);
      c.appendChild(sbar);

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
      elderPicker(sec1, item.elderId,
        function (id) { item.elderId = id; render(); },
        function (id) { item.elderId = id; render(); });
      c.appendChild(sec1);

      /* ── 한 줄 메모 ── */
      var sec2 = UI.el('div', 'sect');
      sec2.appendChild(UI.el('div', 'lbl', '오늘 어떠셨나요? <span style="font-weight:400">(안 쓰셔도 됩니다)</span>'));
      noteInput(sec2, item.note, function (v) { item.note = v; });
      c.appendChild(sec2);

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
