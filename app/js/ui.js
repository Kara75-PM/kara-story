/* ============================================================
 * ui.js — 화면 그리기 도우미
 *
 * 여기에는 "무엇을 보여줄지"가 아니라 "어떻게 그릴지"만 둔다.
 * 흐름 판단은 전부 app.js 가 한다.
 * ============================================================ */

(function (global) {
  "use strict";

  var view   = null;
  var foot   = null;
  var chip   = null;
  var notice = null;
  var mask   = null;
  var dlg    = null;

  function init() {
    view   = document.getElementById('view');
    foot   = document.getElementById('foot');
    chip   = document.getElementById('chip');
    notice = document.getElementById('notice');
    mask   = document.getElementById('mask');
    dlg    = document.getElementById('dlg');
  }

  function el(tag, cls, html) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (html != null) n.innerHTML = html;
    return n;
  }

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"]/g, function (m) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[m];
    });
  }

  function clear() { view.innerHTML = ''; foot.innerHTML = ''; }

  /* onClick 을 주면 칩이 버튼이 된다.
     지금 어디에 저장되는지(상태)와 들어가고 나가는 길(행동)을 한자리에 둔다. */
  function setChip(text, tone, onClick) {
    chip.textContent = text;
    chip.style.background = tone === 'ok'   ? 'var(--ok-soft)'
                          : tone === 'warn' ? 'var(--alert-soft)'
                          : 'var(--surface-2)';
    chip.onclick = onClick || null;
    if (onClick) {
      chip.setAttribute('role', 'button');
      chip.tabIndex = 0;
      chip.classList.add('tap');
      chip.onkeydown = function (e) {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClick(); }
      };
    } else {
      chip.removeAttribute('role');
      chip.removeAttribute('tabindex');
      chip.classList.remove('tap');
      chip.onkeydown = null;
    }
  }

  function card(host) {
    var c = el('section', 'card');
    (host || view).appendChild(c);
    return c;
  }

  /* 하단 고정 버튼 — [{label, fn, ghost, warn, off}] */
  function buttons(list) {
    foot.innerHTML = '';
    list.forEach(function (b) {
      var n = document.createElement('button');
      n.type = 'button';
      n.className = 'btn' + (b.ghost ? ' ghost' : '') + (b.warn ? ' warn' : '');
      n.textContent = b.label;
      if (b.off) n.disabled = true;
      else n.addEventListener('click', b.fn);
      foot.appendChild(n);
    });
    /* 버튼이 바뀌면 높이도 바뀐다 — 본문 여백을 다시 잰다 */
    requestAnimationFrame(syncFootPad);
  }

  /* 파일을 고르는 작은 버튼 (상단 바에 놓는 용도) */
  function pickButton(label, opts, onFiles) {
    opts = opts || {};
    var lab = document.createElement('label');
    lab.className = 'tbtn' + (opts.accent ? ' add' : '');
    lab.innerHTML = esc(label);
    var inp = document.createElement('input');
    inp.type = 'file';
    inp.accept = 'image/*';
    if (opts.multiple) inp.multiple = true;
    if (opts.capture) inp.setAttribute('capture', 'environment');
    inp.addEventListener('change', function (e) {
      onFiles(e.target.files);
      e.target.value = '';
    });
    lab.appendChild(inp);
    return lab;
  }

  /* 알림
   *
   * 원칙: 화면이 이미 말해주는 것은 알리지 않는다.
   *       (저장하면 ✓가 뜨고, 지우면 목록에서 사라진다 — 그게 답이다)
   *       화면 밖에서 일어난 일만 알린다.
   *
   * say(글, {tone:'ok'|'warn'|'info', ms, action:{label, fn}})
   */
  function say(text, opts) {
    opts = opts || {};
    var tone = opts.tone || 'info';
    var icon = tone === 'ok' ? '✅' : tone === 'warn' ? '⚠️' : 'ℹ️';

    notice.className = 'notice ' + tone;
    notice.innerHTML = '';
    notice.appendChild(el('span', 'ic', icon));
    notice.appendChild(el('span', 'tx', esc(text)));

    if (opts.action) {
      var b = document.createElement('button');
      b.type = 'button';
      b.textContent = opts.action.label;
      b.addEventListener('click', function () {
        hide();
        opts.action.fn();
      });
      notice.appendChild(b);
    }

    requestAnimationFrame(function () { notice.classList.add('on'); });
    clearTimeout(say._t);
    say._t = setTimeout(hide, opts.ms || (opts.action ? 6000 : 2400));
  }

  function hide() {
    notice.classList.remove('on');
    clearTimeout(say._t);
  }

  /* ── 확인창 ──
   *
   * 브라우저 기본 confirm 을 쓰지 않는 이유:
   *   1) 버튼 위치를 바꿀 수 없다 — 같은 자리를 두 번 연타하면 위험한 일이 그냥 일어난다
   *   2) 위험한 것과 아닌 것을 구분해 보여줄 수 없다
   *
   * ask({title, body, warn, okLabel, cancelLabel, danger, swap}) → Promise<boolean>
   *   danger : 확인 버튼을 빨갛게
   *   swap   : 확인/취소 위치를 바꾼다 (연타 방지용, 마지막 확인에 쓴다)
   */
  function ask(opts) {
    opts = opts || {};
    return new Promise(function (resolve) {
      dlg.innerHTML = '';
      if (opts.warn) dlg.appendChild(el('div', 'warnline', esc(opts.warn)));
      dlg.appendChild(el('h3', null, esc(opts.title || '확인')));
      if (opts.body) dlg.appendChild(el('div', 'bd', opts.body));

      var acts = el('div', 'acts');

      var cancel = document.createElement('button');
      cancel.type = 'button';
      cancel.textContent = opts.cancelLabel || '취소';

      var ok = document.createElement('button');
      ok.type = 'button';
      ok.className = opts.danger ? 'danger' : 'go';
      ok.textContent = opts.okLabel || '확인';

      /* swap 이면 확인이 왼쪽, 취소가 오른쪽 */
      if (opts.swap) { acts.appendChild(ok); acts.appendChild(cancel); }
      else           { acts.appendChild(cancel); acts.appendChild(ok); }
      dlg.appendChild(acts);

      function close(v) {
        mask.classList.remove('on');
        document.removeEventListener('keydown', onKey);
        mask.removeEventListener('click', onBackdrop);
        setTimeout(function () { resolve(v); }, 60);
      }
      function onKey(e) { if (e.key === 'Escape') close(false); }
      function onBackdrop(e) { if (e.target === mask) close(false); }

      cancel.addEventListener('click', function () { close(false); });
      ok.addEventListener('click', function () { close(true); });
      document.addEventListener('keydown', onKey);
      mask.addEventListener('click', onBackdrop);

      mask.classList.add('on');
      /* 연타로 확인이 눌리지 않게, 열리자마자 취소에 초점을 둔다 */
      requestAnimationFrame(function () { cancel.focus(); });
    });
  }

  /* 진행 막대 — "3장 중 1번째" */
  function progress(host, done, total) {
    var p = el('div', 'prog');
    var t = el('div', 'track');
    var f = el('div', 'fill');
    f.style.width = total ? Math.round(done / total * 100) + '%' : '0%';
    t.appendChild(f);
    p.appendChild(t);
    p.appendChild(el('div', 'n', done + ' / ' + total));
    host.appendChild(p);
    return p;
  }

  /* 대기 중인 사진 줄 — 누르면 그 사진으로 이동한다 */
  function queueStrip(host, items, curIdx, onPick) {
    if (!items || items.length < 2) return null;
    var q = el('div', 'queue');
    items.forEach(function (it, i) {
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'q' + (i === curIdx ? ' now' : '') + (it.saved ? ' done' : '');
      b.setAttribute('aria-label', (i + 1) + '번째 사진으로 이동');
      if (i === curIdx) b.setAttribute('aria-current', 'true');
      if (it.stripUrl) {
        var im = document.createElement('img');
        im.src = it.stripUrl;
        im.alt = '';
        b.appendChild(im);
      }
      b.appendChild(el('span', 'no', String(i + 1)));
      if (it.saved) b.appendChild(el('span', 'mk', '✓'));
      if (onPick) b.addEventListener('click', function () { onPick(i); });
      q.appendChild(b);
    });
    host.appendChild(q);
    host.appendChild(el('div', 'queuehint', '사진을 누르면 그 장으로 바로 이동합니다.'));
    return q;
  }

  /* 하단 고정 버튼의 실제 높이만큼 본문 아래를 비운다.
     기기마다 버튼 높이가 달라 CSS 고정값으로는 잘린다.

     ⚠️ 여백은 body 가 아니라 .wrap(내용 상자)에 준다.
     body 는 높이가 화면에 묶여 있어, 화면보다 긴 내용의 "아래"에는
     여백이 생기지 않는다. 그러면 마지막 내용이 버튼에 덮인다. */
  function syncFootPad() {
    var bar  = document.querySelector('.foot');
    var wrap = document.querySelector('.wrap');
    if (!wrap) return;
    document.body.style.paddingBottom = '';      /* 옛 버전이 남긴 값 지우기 */
    var h = bar ? (bar.offsetHeight || 0) : 0;
    wrap.style.paddingBottom =
      'calc(' + (h + 28) + 'px + env(safe-area-inset-bottom))';
  }

  function msg(host, tone, html) {
    host.appendChild(el('div', 'msg ' + tone, html));
  }

  function empty(host, html) {
    host.appendChild(el('div', 'empty', html));
  }

  global.UI = {
    init: init,
    el: el,
    esc: esc,
    clear: clear,
    setChip: setChip,
    card: card,
    buttons: buttons,
    pickButton: pickButton,
    say: say,
    hideNotice: hide,
    ask: ask,
    progress: progress,
    queueStrip: queueStrip,
    syncFootPad: syncFootPad,
    msg: msg,
    empty: empty,
    get view() { return view; }
  };

  /* 화면 크기·방향이 바뀌면 여백을 다시 잰다 */
  global.addEventListener('resize', function () { syncFootPad(); });
  global.addEventListener('orientationchange', function () {
    setTimeout(syncFootPad, 250);
  });
})(window);
