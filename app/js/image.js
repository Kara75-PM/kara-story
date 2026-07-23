/* ============================================================
 * image.js — 사진 처리
 *
 * 파이프라인
 *   원본 파일 (4~8MB)
 *     → 방향 보정 (EXIF)     ← 폰 세로 사진이 눕는 문제. 빠뜨리면 안 된다
 *     → 리사이즈 (긴 변 1600)
 *     → 이름칸 크롭
 *     → JPEG 압축
 *     → 저장 (200~400KB)
 *   + 썸네일 (긴 변 400)      ← 목록 화면이 빨라진다
 * ============================================================ */

(function (global) {
  "use strict";

  var MAX_LONG_EDGE = 1600;   // 저장본. A4 그림 글씨가 읽히는 선
  var THUMB_EDGE    = 400;    // 목록용
  var JPEG_QUALITY  = 0.85;

  /* ── 파일 → 이미지 요소 (방향 보정 포함) ──────────── */

  function loadImage(file) {
    return new Promise(function (resolve, reject) {
      /* createImageBitmap 이 있으면 EXIF 방향을 브라우저가 처리해준다 */
      if (global.createImageBitmap) {
        global.createImageBitmap(file, { imageOrientation: 'from-image' })
          .then(function (bmp) { resolve({ src: bmp, w: bmp.width, h: bmp.height }); })
          .catch(function () { fallback(); });
      } else {
        fallback();
      }

      function fallback() {
        var url = URL.createObjectURL(file);
        var img = new Image();
        img.onload = function () {
          URL.revokeObjectURL(url);
          resolve({ src: img, w: img.naturalWidth, h: img.naturalHeight });
        };
        img.onerror = function () {
          URL.revokeObjectURL(url);
          reject(new Error('사진을 읽지 못했습니다.'));
        };
        img.src = url;
      }
    });
  }

  /* ── 캔버스에 그려서: 돌리고 → 위·아래를 자르고 → 크기 줄이기 ──
   *
   * 순서가 중요하다. 먼저 돌린 다음에 잘라야
   * "보이는 화면의 위·아래"가 잘린다.
   *
   * crop = {top: 0~0.6, bottom: 0~0.6}  (돌린 뒤 기준)
   */
  function normCrop(crop) {
    if (crop == null) return { top: 0, bottom: 0 };
    if (typeof crop === 'number') return { top: 0, bottom: crop };   /* 옛 호출 방식 */
    return { top: crop.top || 0, bottom: crop.bottom || 0 };
  }

  function drawScaled(loaded, longEdge, crop, rot) {
    rot = ((rot || 0) % 360 + 360) % 360;
    var c = normCrop(crop);
    var sw = loaded.w, sh = loaded.h;

    /* 돌린 뒤의 크기 */
    var quarter = (rot === 90 || rot === 270);
    var rw = quarter ? sh : sw;
    var rh = quarter ? sw : sh;

    var top    = Math.min(0.6, Math.max(0, c.top));
    var bottom = Math.min(0.6, Math.max(0, c.bottom));
    if (top + bottom > 0.8) {                 /* 남는 것이 20% 미만이 되지 않게 */
      var over = (top + bottom) - 0.8;
      top    = Math.max(0, top - over / 2);
      bottom = Math.max(0, bottom - over / 2);
    }

    var offY  = Math.round(rh * top);                            /* 위에서 버리는 만큼 */
    var keepH = Math.max(1, Math.round(rh * (1 - top - bottom))); /* 남기는 높이 */

    var scale = Math.min(1, longEdge / Math.max(rw, keepH));
    var dw = Math.max(1, Math.round(rw * scale));
    var dh = Math.max(1, Math.round(keepH * scale));

    var cv = document.createElement('canvas');
    cv.width = dw; cv.height = dh;
    var ctx = cv.getContext('2d');
    ctx.imageSmoothingQuality = 'high';

    ctx.save();
    ctx.scale(scale, scale);
    ctx.translate(0, -offY);            /* 위로 끌어올려 윗부분을 캔버스 밖으로 보낸다 */
    if (rot === 90)       { ctx.translate(rw, 0);  ctx.rotate(Math.PI / 2); }
    else if (rot === 180) { ctx.translate(rw, rh); ctx.rotate(Math.PI); }
    else if (rot === 270) { ctx.translate(0, rh);  ctx.rotate(-Math.PI / 2); }
    ctx.drawImage(loaded.src, 0, 0);
    ctx.restore();
    return cv;
  }

  function canvasToBlob(cv, quality) {
    return new Promise(function (resolve, reject) {
      cv.toBlob(function (b) {
        b ? resolve(b) : reject(new Error('사진을 변환하지 못했습니다.'));
      }, 'image/jpeg', quality != null ? quality : JPEG_QUALITY);
    });
  }

  /* ============================================================
   * 공개 함수
   * ============================================================ */

  /* 파일을 받아 미리보기용으로 한 번만 읽어둔다.
     크롭 비율을 바꿀 때마다 원본을 다시 읽지 않기 위해서다. */
  function prepare(file) {
    return loadImage(file).then(function (loaded) {
      return {
        file: file,
        loaded: loaded,
        width: loaded.w,
        height: loaded.h,
        /* 미리보기 (빠르게, 크롭 없이) */
        previewUrl: null
      };
    });
  }

  /* 미리보기 URL — 자를 자리는 화면에서 겹쳐 보여주므로 여기선 자르지 않는다 */
  function previewUrl(prepared, crop, rot) {
    var cv = drawScaled(prepared.loaded, 900, crop, rot);
    return cv.toDataURL('image/jpeg', 0.8);
  }

  /* 목록 줄에 쓸 아주 작은 그림.
     원본을 붙들고 있지 않고 바로 놓아준다 — 30장을 동시에 들고 있으면 폰이 버티지 못한다. */
  function quickThumb(file, edge) {
    return loadImage(file).then(function (loaded) {
      var cv = drawScaled(loaded, edge || 140, 0);
      var url = cv.toDataURL('image/jpeg', 0.7);
      try { if (loaded.src && loaded.src.close) loaded.src.close(); } catch (e) {}
      return url;
    });
  }

  /* 최종 저장본 + 썸네일 */
  function finalize(prepared, crop, rot) {
    var main  = drawScaled(prepared.loaded, MAX_LONG_EDGE, crop, rot);
    var thumb = drawScaled(prepared.loaded, THUMB_EDGE,    crop, rot);
    return Promise.all([canvasToBlob(main), canvasToBlob(thumb, 0.8)])
      .then(function (bs) {
        return {
          image: bs[0],
          thumb: bs[1],
          width: main.width,
          height: main.height,
          byteSize: bs[0].size
        };
      });
  }

  /* 다 쓴 이미지 자원 정리 */
  function dispose(prepared) {
    try {
      if (prepared && prepared.loaded && prepared.loaded.src && prepared.loaded.src.close) {
        prepared.loaded.src.close();   // ImageBitmap
      }
    } catch (e) { /* 무시 */ }
  }

  function humanSize(bytes) {
    if (bytes == null) return '';
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return Math.round(bytes / 1024) + ' KB';
    return (bytes / 1024 / 1024).toFixed(1) + ' MB';
  }

  global.Img = {
    MAX_LONG_EDGE: MAX_LONG_EDGE,
    THUMB_EDGE: THUMB_EDGE,
    prepare: prepare,
    previewUrl: previewUrl,
    quickThumb: quickThumb,
    finalize: finalize,
    dispose: dispose,
    humanSize: humanSize
  };
})(window);
