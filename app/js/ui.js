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

  /* 대기 중인 사진 줄 */
  function queueStrip(host, items, curIdx) {
    if (!items || items.length < 2) return null;
    var q = el('div', 'queue');
    items.forEach(function (it, i) {
      var d = el('div', 'q' + (i === curIdx ? ' now' : '') + (it.saved ? ' done' : ''));
      if (it.thumbUrl) {
        var im = document.createElement('img');
        im.src = it.thumbUrl;
        im.alt = (i + 1) + '번째 사진';
        d.appendChild(im);
      }
      if (it.saved) d.appendChild(el('span', 'mk', '✓'));
      q.appendChild(d);
    });
    host.appendChild(q);
    return q;
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
    say: say,
    progress: progress,
    queueStrip: queueStrip,
    msg: msg,
    empty: empty,
    get view() { return view; }
  };
})(window);
