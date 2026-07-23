/* ============================================================
 * sample.js — 견본 작품 만들기
 *
 * 왜 있나
 *   링크를 받은 사람 폰에는 어르신 작품 사진이 없다.
 *   올릴 게 없어서 아무것도 못 해보고 닫는다.
 *   그래서 그림을 코드로 그려 넣는다. 파일을 담지 않으므로 무겁지 않다.
 *
 * 무엇을 담나
 *   ① 아래에 이름칸이 있는 그림   ← 「이름칸 자르기」를 보여주는 것이 핵심
 *   ② 위쪽에 이름이 있는 그림     ← 위·아래 둘 다 자를 수 있음을 보여준다
 *   ③ 옆으로 누운 그림            ← 「돌리기」를 보여준다
 *
 * ⚠️ 이름은 전부 지어낸 것이다. 실제 어르신 정보를 넣지 않는다 (CLAUDE.md 7항).
 * ============================================================ */

(function (global) {
  "use strict";

  var W = 1000, H = 1350;          /* 도화지 비율 (4절지에 가깝게) */
  var BAND = 170;                  /* 이름칸 높이 */

  /* ── 그리는 데 쓰는 붓 ───────────────────────────── */

  /* 크레파스처럼 — 같은 선을 조금씩 어긋나게 여러 번 긋는다 */
  function crayon(ctx, color, width, fn) {
    ctx.save();
    ctx.strokeStyle = color;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    for (var i = 0; i < 3; i++) {
      ctx.globalAlpha = 0.34;
      ctx.lineWidth = width * (1 - i * 0.12);
      ctx.save();
      ctx.translate((i - 1) * 1.6, (i - 1) * 1.3);
      ctx.beginPath();
      fn(ctx);
      ctx.stroke();
      ctx.restore();
    }
    ctx.restore();
  }

  /* 색칠 — 가장자리를 삐져나가게 해서 손으로 칠한 느낌을 낸다 */
  function fillSoft(ctx, color, alpha, fn) {
    ctx.save();
    ctx.fillStyle = color;
    ctx.globalAlpha = alpha == null ? 0.75 : alpha;
    ctx.beginPath();
    fn(ctx);
    ctx.fill();
    ctx.restore();
  }

  /* 종이 — 아이보리 바탕에 아주 옅은 얼룩 */
  function paper(ctx, w, h, seed) {
    ctx.fillStyle = '#fbf7ee';
    ctx.fillRect(0, 0, w, h);
    var r = rnd(seed);
    ctx.save();
    for (var i = 0; i < 140; i++) {
      ctx.globalAlpha = 0.03 + r() * 0.04;
      ctx.fillStyle = r() > 0.5 ? '#d8cfbb' : '#efe6d4';
      var x = r() * w, y = r() * h, s = 12 + r() * 60;
      ctx.beginPath();
      ctx.ellipse(x, y, s, s * (0.4 + r() * 0.6), r() * 3.14, 0, 6.284);
      ctx.fill();
    }
    ctx.restore();
  }

  /* 씨앗 있는 난수 — 열 때마다 같은 그림이 나와야 한다 */
  function rnd(seed) {
    var s = seed || 1;
    return function () {
      s = (s * 1103515245 + 12345) % 2147483648;
      return s / 2147483648;
    };
  }

  /* 손글씨 느낌 이름 — 글자마다 살짝 기울이고 크기를 흔든다 */
  function handwrite(ctx, text, cx, cy, size, color) {
    ctx.save();
    ctx.fillStyle = color || '#2f3a44';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    var r = rnd(text.length * 977 + 7);
    var chars = text.split('');
    var adv = size * 1.06;
    var startX = cx - (chars.length - 1) * adv / 2;
    chars.forEach(function (ch, i) {
      ctx.save();
      ctx.translate(startX + i * adv, cy + (r() - 0.5) * size * 0.12);
      ctx.rotate((r() - 0.5) * 0.11);
      ctx.font = '600 ' + (size * (0.94 + r() * 0.12)) + 'px "Nanum Pen Script","Gaegu","HY견고딕",serif';
      ctx.fillText(ch, 0, 0);
      ctx.restore();
    });
    ctx.restore();
  }

  /* 이름칸 — 실제 도화지처럼 아래(또는 위)에 줄을 긋고 이름을 적는다 */
  function nameBand(ctx, w, h, where, name) {
    var top = (where === 'top') ? 0 : h - BAND;
    ctx.save();
    ctx.fillStyle = 'rgba(255,255,255,.55)';
    ctx.fillRect(0, top, w, BAND);
    ctx.strokeStyle = '#c9bfa8';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(0, where === 'top' ? BAND : top);
    ctx.lineTo(w, where === 'top' ? BAND : top);
    ctx.stroke();
    ctx.restore();

    var cy = top + BAND / 2;
    ctx.save();
    ctx.fillStyle = '#8a8172';
    ctx.font = '500 40px "Noto Sans KR",sans-serif';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText('이름', 60, cy);
    ctx.restore();
    handwrite(ctx, name, w * 0.55, cy, 78);
  }

  /* ── 그림 3장 ────────────────────────────────────── */

  /* ① 꽃 — 이름칸이 아래에 있다 (가장 흔한 형태) */
  function drawFlower(ctx) {
    paper(ctx, W, H, 3);
    var cx = W / 2, cy = H * 0.44;

    /* 해 */
    fillSoft(ctx, '#f6c445', 0.8, function (c) { c.arc(W * 0.8, H * 0.13, 78, 0, 6.284); });
    crayon(ctx, '#e0a520', 9, function (c) {
      for (var i = 0; i < 10; i++) {
        var a = i * 0.6284;
        c.moveTo(W * 0.8 + Math.cos(a) * 96, H * 0.13 + Math.sin(a) * 96);
        c.lineTo(W * 0.8 + Math.cos(a) * 134, H * 0.13 + Math.sin(a) * 134);
      }
    });

    /* 줄기 */
    crayon(ctx, '#4e8a45', 20, function (c) {
      c.moveTo(cx, cy + 120); c.quadraticCurveTo(cx + 26, H * 0.72, cx - 8, H * 0.88);
    });
    /* 잎 */
    [[-1, 0.68], [1, 0.78]].forEach(function (p) {
      fillSoft(ctx, '#68a85a', 0.8, function (c) {
        c.ellipse(cx + p[0] * 118, H * p[1], 108, 46, p[0] * 0.5, 0, 6.284);
      });
    });

    /* 꽃잎 */
    for (var i = 0; i < 9; i++) {
      var a = i * (6.284 / 9);
      fillSoft(ctx, i % 2 ? '#f08a7a' : '#f2a24f', 0.85, function (c) {
        c.ellipse(cx + Math.cos(a) * 132, cy + Math.sin(a) * 132, 78, 46, a, 0, 6.284);
      });
    }
    fillSoft(ctx, '#c9612f', 0.9, function (c) { c.arc(cx, cy, 82, 0, 6.284); });
    crayon(ctx, '#8c3a2e', 8, function (c) { c.arc(cx, cy, 82, 0, 6.284); });

    /* 땅 */
    crayon(ctx, '#9c8f6d', 14, function (c) {
      c.moveTo(0, H * 0.885); c.quadraticCurveTo(W / 2, H * 0.865, W, H * 0.89);
    });

    nameBand(ctx, W, H, 'bottom', '김순자');
  }

  /* ② 산과 강 — 이름칸이 위에 있다 (위쪽 자르기를 보여주기 위해) */
  function drawMountain(ctx) {
    paper(ctx, W, H, 11);

    fillSoft(ctx, '#bfe0ef', 0.55, function (c) { c.rect(0, BAND, W, H * 0.5 - BAND); });

    /* 산 두 개 */
    fillSoft(ctx, '#7fa87e', 0.85, function (c) {
      c.moveTo(-40, H * 0.56); c.lineTo(W * 0.34, H * 0.24); c.lineTo(W * 0.68, H * 0.56); c.closePath();
    });
    fillSoft(ctx, '#5e8a63', 0.85, function (c) {
      c.moveTo(W * 0.42, H * 0.56); c.lineTo(W * 0.74, H * 0.31); c.lineTo(W + 40, H * 0.56); c.closePath();
    });
    crayon(ctx, '#3f6247', 9, function (c) {
      c.moveTo(-40, H * 0.56); c.lineTo(W * 0.34, H * 0.24); c.lineTo(W * 0.68, H * 0.56);
      c.moveTo(W * 0.42, H * 0.56); c.lineTo(W * 0.74, H * 0.31); c.lineTo(W + 40, H * 0.56);
    });

    /* 강 */
    fillSoft(ctx, '#8ec3dd', 0.8, function (c) {
      c.moveTo(W * 0.28, H * 0.56); c.lineTo(W * 0.62, H * 0.56);
      c.lineTo(W * 0.88, H * 0.93); c.lineTo(W * 0.06, H * 0.93); c.closePath();
    });
    crayon(ctx, '#5f9ec0', 7, function (c) {
      for (var i = 0; i < 4; i++) {
        var y = H * (0.64 + i * 0.07);
        c.moveTo(W * 0.2, y); c.quadraticCurveTo(W * 0.5, y - 22, W * 0.8, y);
      }
    });

    /* 나무 */
    [[0.14, 0.62, 1], [0.9, 0.66, 0.85]].forEach(function (t) {
      crayon(ctx, '#7a5230', 15 * t[2], function (c) {
        c.moveTo(W * t[0], H * t[1]); c.lineTo(W * t[0], H * (t[1] - 0.09));
      });
      fillSoft(ctx, '#6da35c', 0.85, function (c) {
        c.arc(W * t[0], H * (t[1] - 0.13), 72 * t[2], 0, 6.284);
      });
    });

    nameBand(ctx, W, H, 'top', '박영수');
  }

  /* ③ 옆으로 누운 그림 — 「돌리기」를 보여주기 위해 일부러 90도 눕혔다 */
  function drawSidewaysHouse(ctx) {
    /* 가로로 그린 뒤 전체를 90도 돌려 세로 캔버스에 넣는다 */
    ctx.save();
    ctx.translate(W, 0);
    ctx.rotate(Math.PI / 2);
    /* 이 안에서는 가로 H x 세로 W 로 생각한다 */
    var w = H, h = W;

    paper(ctx, w, h, 29);

    /* 잔디 */
    fillSoft(ctx, '#a8c98a', 0.7, function (c) { c.rect(0, h * 0.72, w, h * 0.28 - BAND * 0.0); });

    /* 집 */
    var hx = w * 0.44, hy = h * 0.44, hw = w * 0.3, hh = h * 0.3;
    fillSoft(ctx, '#f0d9a8', 0.9, function (c) { c.rect(hx - hw / 2, hy, hw, hh); });
    crayon(ctx, '#a8814a', 10, function (c) { c.rect(hx - hw / 2, hy, hw, hh); });
    fillSoft(ctx, '#c96b52', 0.9, function (c) {
      c.moveTo(hx - hw * 0.62, hy); c.lineTo(hx, hy - hh * 0.5); c.lineTo(hx + hw * 0.62, hy); c.closePath();
    });
    /* 문·창 */
    fillSoft(ctx, '#8a5a3c', 0.9, function (c) { c.rect(hx - hw * 0.1, hy + hh * 0.45, hw * 0.2, hh * 0.55); });
    fillSoft(ctx, '#9fd0e6', 0.9, function (c) { c.rect(hx - hw * 0.38, hy + hh * 0.16, hw * 0.2, hw * 0.2); });
    crayon(ctx, '#6a8ea3', 6, function (c) { c.rect(hx - hw * 0.38, hy + hh * 0.16, hw * 0.2, hw * 0.2); });

    /* 해와 구름 */
    fillSoft(ctx, '#f6c445', 0.85, function (c) { c.arc(w * 0.82, h * 0.2, 62, 0, 6.284); });
    fillSoft(ctx, '#ffffff', 0.85, function (c) {
      c.arc(w * 0.2, h * 0.2, 46, 0, 6.284); c.arc(w * 0.26, h * 0.2, 58, 0, 6.284);
      c.arc(w * 0.33, h * 0.21, 42, 0, 6.284);
    });

    nameBand(ctx, w, h, 'bottom', '이말순');
    ctx.restore();
  }

  /* ── 파일로 만들기 ───────────────────────────────── */

  var SHEETS = [
    { name: '견본-꽃.jpg',   draw: drawFlower },
    { name: '견본-산.jpg',   draw: drawMountain },
    { name: '견본-집.jpg',   draw: drawSidewaysHouse }
  ];

  function toFile(sheet) {
    return new Promise(function (resolve, reject) {
      var cv = document.createElement('canvas');
      cv.width = W; cv.height = H;
      var ctx = cv.getContext('2d');
      sheet.draw(ctx);
      cv.toBlob(function (b) {
        if (!b) { reject(new Error('견본을 만들지 못했습니다.')); return; }
        resolve(new File([b], sheet.name, { type: 'image/jpeg', lastModified: 0 }));
      }, 'image/jpeg', 0.88);
    });
  }

  /* 견본 3장을 파일로 돌려준다. 실제 사진 파일과 똑같이 취급된다. */
  function files() {
    return Promise.all(SHEETS.map(toFile));
  }

  global.Sample = { files: files, count: SHEETS.length };
})(window);
