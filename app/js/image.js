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

  /* ── 캔버스에 그려서 크기 줄이기 ──────────────────── */

  function drawScaled(loaded, longEdge, cropBottomRatio) {
    var sw = loaded.w, sh = loaded.h;

    /* 아래쪽 잘라내기 (이름칸 제거) */
    var ratio = cropBottomRatio || 0;
    var srcH = Math.max(1, Math.round(sh * (1 - ratio)));

    var scale = Math.min(1, longEdge / Math.max(sw, srcH));
    var dw = Math.max(1, Math.round(sw * scale));
    var dh = Math.max(1, Math.round(srcH * scale));

    var cv = document.createElement('canvas');
    cv.width = dw; cv.height = dh;
    var ctx = cv.getContext('2d');
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(loaded.src, 0, 0, sw, srcH, 0, 0, dw, dh);
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

  /* 미리보기 URL 만들기 — 크롭 비율을 반영해서 */
  function previewUrl(prepared, cropBottomRatio) {
    var cv = drawScaled(prepared.loaded, 900, cropBottomRatio);
    return cv.toDataURL('image/jpeg', 0.8);
  }

  /* 최종 저장본 + 썸네일 */
  function finalize(prepared, cropBottomRatio) {
    var main  = drawScaled(prepared.loaded, MAX_LONG_EDGE, cropBottomRatio);
    var thumb = drawScaled(prepared.loaded, THUMB_EDGE,    cropBottomRatio);
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
    finalize: finalize,
    dispose: dispose,
    humanSize: humanSize
  };
})(window);
