/* ============================================================
 * ui.js — 화면 그리기 도우미
 *
 * 여기에는 "무엇을 보여줄지"가 아니라 "어떻게 그릴지"만 둔다.
 * 흐름 판단은 전부 app.js 가 한다.
 * ============================================================ */

(function (global) {
  "use strict";

  var view  = null;
  var foot  = null;
  var chip  = null;
  var toast = null;

  function init() {
    view  = document.getElementById('view');
    foot  = document.getElementById('foot');
    chip  = document.getElementById('chip');
    toast = document.getElementById('toast');
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

  function setChip(text, tone) {
    chip.textContent = text;
    chip.style.background = tone === 'ok'   ? 'var(--ok-soft)'
                          : tone === 'warn' ? 'var(--alert-soft)'
                          : 'var(--surface-2)';
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

  function say(msg, ms) {
    toast.textContent = msg;
    toast.classList.add('on');
    clearTimeout(say._t);
    say._t = setTimeout(function () { toast.classList.remove('on'); }, ms || 2000);
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
     기기마다 버튼 높이가 달라 CSS 고정값으로는 잘린다. */
  function syncFootPad() {
    var bar = document.querySelector('.foot');
    if (!bar) return;
    var h = bar.offsetHeight || 0;
    document.body.style.paddingBottom = (h + 24) + 'px';
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
