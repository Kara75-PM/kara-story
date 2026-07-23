/* ============================================================
 * model.js — 데이터 정의
 *
 * 이 파일이 이 프로젝트의 기반이다. 여기가 흔들리면 전부 뜯는다.
 *
 * 설계 원칙
 *  1) 지금 안 쓰는 필드라도 앞으로 들어올 것은 미리 자리를 잡아둔다.
 *  2) "있었던 날"(occurredAt)과 "올린 날"(createdAt)을 절대 합치지 않는다.
 *     — 옛 사진은 이 둘이 50년 차이 난다.
 *  3) 종류(kind)를 두어 작품·사진·옛사진·음성이 한 구조에 들어오게 한다.
 *  4) id는 UUID. 나중에 서버로 옮겨도 충돌이 없다.
 * ============================================================ */

(function (global) {
  "use strict";

  /* 스키마 버전 — 필드가 바뀌면 올리고 store.js 에서 이관 처리 */
  var SCHEMA_VERSION = 1;

  /* ── 기록의 종류 ──
   * 지금은 artwork 하나만 쓴다. 나머지는 자리만 잡아둔 것.
   */
  var Kind = {
    ARTWORK:   'artwork',    // 센터에서 만든 작품 (지금 범위)
    PHOTO:     'photo',      // 활동 사진        (v2 — 초상권 검토 후)
    OLD_PHOTO: 'old_photo',  // 옛날 사진        (v2 — 여쭤보기)
    VOICE:     'voice'       // 음성             (v3)
  };

  /* ── 시기를 정확히 모를 때 쓰는 값 ──
   * 옛 사진은 "1970년대쯤"밖에 모른다. occurredAt 을 비우고 이걸 쓴다.
   */
  var PeriodHint = {
    DECADE:   'decade',    // "1970년대"
    EVENT:    'event',     // "결혼 무렵"
    UNKNOWN:  'unknown'
  };

  function newId() {
    if (global.crypto && global.crypto.randomUUID) return global.crypto.randomUUID();
    // 구형 브라우저 대비
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
      var r = (Math.random() * 16) | 0;
      return (c === 'x' ? r : ((r & 0x3) | 0x8)).toString(16);
    });
  }

  function nowIso() { return new Date().toISOString(); }

  /* YYYY-MM-DD (로컬 기준) */
  function todayLocal() {
    var d = new Date();
    var p = function (n) { return String(n).padStart(2, '0'); };
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
  }

  /* ============================================================
   * Elder — 어르신
   * ============================================================ */
  function makeElder(input) {
    input = input || {};
    return {
      id:        input.id || newId(),
      name:      (input.name || '').trim(),
      birthYear: input.birthYear || null,   // 🔑 연대기(v2)의 축. 지금은 비어 있어도 된다
      centerId:  input.centerId || null,    // 🔑 센터 여러 곳 (v2)
      note:      input.note || '',
      active:    input.active !== false,    // 퇴소하면 false. 지우지 않는다
      createdAt: input.createdAt || nowIso(),
      updatedAt: nowIso()
    };
  }

  function validateElder(e) {
    var errs = [];
    if (!e.name) errs.push('이름을 적어주세요.');
    if (e.name && e.name.length > 20) errs.push('이름이 너무 깁니다.');
    if (e.birthYear != null) {
      var y = Number(e.birthYear);
      if (!Number.isInteger(y) || y < 1900 || y > new Date().getFullYear()) {
        errs.push('생년이 올바르지 않습니다.');
      }
    }
    return errs;
  }

  /* ============================================================
   * Record — 기록 (작품 한 장 = 기록 하나)
   *
   * ⚠️ 이름을 "Artwork"가 아니라 "Record"로 둔 이유:
   *    나중에 옛 사진·음성이 같은 구조로 들어온다.
   * ============================================================ */
  function makeRecord(input) {
    input = input || {};
    return {
      id:       input.id || newId(),
      elderId:  input.elderId || null,
      kind:     input.kind || Kind.ARTWORK,

      /* 🔑 있었던 날 — 옛 사진이면 50년 전일 수 있다 */
      occurredAt:   input.occurredAt || todayLocal(),
      /* 🔑 날짜를 모를 때: {type:'decade', value:'1970'} 같은 형태 */
      occurredHint: input.occurredHint || null,

      /* 활동명 — v2에서 센터 일정표로 자동 채움 ("미술치료") */
      activity: input.activity || null,

      note: (input.note || '').trim(),

      /* 잘라낸 기록 — 위·아래를 따로 둔다.
         v1 에서는 아래 하나뿐이었다(redactRatio). 옛 값은 아래로 읽는다. */
      redacted:     input.redacted === true,
      redactTop:    input.redactTop != null ? input.redactTop : 0,
      redactBottom: input.redactBottom != null ? input.redactBottom
                  : (input.redactRatio != null ? input.redactRatio : 0),

      /* 이미지 메타 (실제 데이터는 blobs 스토어에 따로 둔다) */
      width:     input.width || null,
      height:    input.height || null,
      byteSize:  input.byteSize || null,

      createdAt: input.createdAt || nowIso(),
      createdBy: input.createdBy || null,   // v2 — 어느 직원이 올렸는지
      updatedAt: nowIso(),
      deletedAt: input.deletedAt || null    // 지우지 않고 표시만 (복구 가능)
    };
  }

  function validateRecord(r) {
    var errs = [];
    if (!r.elderId) errs.push('어느 어르신 것인지 골라주세요.');
    if (!Object.keys(Kind).some(function (k) { return Kind[k] === r.kind; })) {
      errs.push('기록 종류가 올바르지 않습니다.');
    }
    if (!r.occurredAt && !r.occurredHint) errs.push('날짜나 시기가 필요합니다.');
    if (r.note && r.note.length > 200) errs.push('메모가 너무 깁니다.');
    return errs;
  }

  /* ============================================================
   * 표시용 도우미
   * ============================================================ */

  /* 어르신 나이 (birthYear 가 있을 때만) */
  function ageOf(elder, atYear) {
    if (!elder || !elder.birthYear) return null;
    return (atYear || new Date().getFullYear()) - elder.birthYear;
  }

  /* ── 자르기 값 ──
   * 위·아래를 따로 자른다. 남는 부분이 너무 작아지지 않게 막는다.
   */
  var CROP_MAX_EACH = 0.60;   // 한쪽 최대
  var CROP_KEEP_MIN = 0.20;   // 남겨야 하는 최소

  function clampCrop(top, bottom, movingWhich) {
    top    = Math.min(CROP_MAX_EACH, Math.max(0, Number(top)    || 0));
    bottom = Math.min(CROP_MAX_EACH, Math.max(0, Number(bottom) || 0));

    var over = (top + bottom) - (1 - CROP_KEEP_MIN);
    if (over > 0) {
      /* 지금 움직이는 쪽을 살리고 반대쪽을 줄인다 */
      if (movingWhich === 'top')         bottom = Math.max(0, bottom - over);
      else if (movingWhich === 'bottom') top    = Math.max(0, top - over);
      else { top = Math.max(0, top - over / 2); bottom = Math.max(0, bottom - over / 2); }
    }
    return { top: top, bottom: bottom };
  }

  /* 시기를 사람이 읽는 말로 */
  function periodLabel(record) {
    if (record.occurredHint) {
      var h = record.occurredHint;
      if (h.type === PeriodHint.DECADE) return h.value + '년대';
      if (h.type === PeriodHint.EVENT)  return h.value;
      return '시기 모름';
    }
    if (!record.occurredAt) return '';
    var d = record.occurredAt.split('-');
    return d[0] + '년 ' + Number(d[1]) + '월 ' + Number(d[2]) + '일';
  }

  global.Model = {
    SCHEMA_VERSION: SCHEMA_VERSION,
    Kind: Kind,
    PeriodHint: PeriodHint,
    newId: newId,
    nowIso: nowIso,
    todayLocal: todayLocal,
    makeElder: makeElder,
    validateElder: validateElder,
    makeRecord: makeRecord,
    validateRecord: validateRecord,
    ageOf: ageOf,
    periodLabel: periodLabel,
    CROP_MAX_EACH: CROP_MAX_EACH,
    CROP_KEEP_MIN: CROP_KEEP_MIN,
    clampCrop: clampCrop
  };
})(window);
