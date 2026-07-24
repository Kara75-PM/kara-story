/* ============================================================
 * store.js — 저장소를 고르는 층
 *
 * 두 저장소가 같은 계약을 지키고, 이 파일이 둘 중 하나를 고른다.
 *
 *   store-idb.js   기기 안 (IndexedDB)   ← 로그인 안 한 「체험 모드」
 *   store-supa.js  서울 서버 (Supabase)  ← 로그인한 센터 직원
 *
 * ⚠️ 화면 코드(app.js)는 이 목록만 안다. 어디에 저장되는지는 모른다.
 *    그래서 저장 위치를 바꿔도 화면 코드는 한 줄도 안 고친다.
 *
 * ── 계약 ────────────────────────────────────────────
 *   ready()                          저장소 준비
 *   listElders({includeInactive})    어르신 목록 (이름순)
 *   getElder(id)
 *   saveElder(elder)                 → elder
 *   removeElder(id)                  퇴소 처리 (기록은 남는다)
 *
 *   listRecords({elderId, deleted, kind, occurredAt, limit})
 *                                    기록 목록. 이미지는 안 딸려온다
 *   getRecord(id)
 *   saveRecord(record, {image, thumb})  → record
 *   removeRecord(id)                 🗑 지운 것으로 (되돌릴 수 있음)
 *   restoreRecord(id)                되돌리기
 *   purgeRecord(id)                  완전히 지우기 (복구 불가)
 *   purgeExpired(days)               오래된 지운 것 자동 정리 → 개수
 *
 *   getImage(recordId)               → Blob | null
 *   getThumb(recordId)               → Blob | null
 *   stats()                          → {elders, records, deleted, bytes}
 *   wipe()                           개발용 — 전부 지우기
 *
 * ── 지우기가 두 종류인 이유 ────────────────────────
 *   실수 교정  : 잘못 찍음·잘못 고름 → 되돌릴 수 있어야 한다
 *   의사 존중  : 어르신·가족이 원치 않음 → 진짜로 지워져야 한다
 *   섞으면 둘 중 하나는 반드시 어긴다. 그래서 나눠 둔다.
 * ============================================================ */

(function (global) {
  "use strict";

  var METHODS = [
    'listElders', 'getElder', 'saveElder', 'removeElder',
    'listRecords', 'getRecord', 'saveRecord',
    'removeRecord', 'restoreRecord', 'purgeRecord', 'purgeExpired',
    'getImage', 'getThumb', 'stats', 'wipe'
  ];

  function impl(name) {
    if (name === 'supa') return global.StoreSupa || null;
    return global.StoreIdb || null;
  }

  var cur = null;

  /* 저장소를 고른다. 로그인하면 'supa', 나가면 'idb' 로 돌아온다.
     화면이 이미 그려진 뒤에도 바꿀 수 있어야 하므로 함수로 둔다.
     저장소를 바꿀 때 이전 저장소가 잡고 있던 것(로그인 캐시 등)을 놓게 한다 —
     화면 코드가 forget() 을 직접 부르지 않도록 여기서 흡수한다. */
  function use(name) {
    var next = impl(name);
    if (!next) return Promise.reject(new Error('저장소를 찾지 못했습니다: ' + name));
    if (cur && cur !== next && typeof cur.forget === 'function') cur.forget();
    cur = next;
    Store.backend = next.backend;
    return next.ready();
  }

  function ready() {
    /* 아직 안 골랐으면 설정에 적힌 것으로 시작한다 */
    if (!cur) return use((global.CONFIG && global.CONFIG.backend) || 'idb');
    return cur.ready();
  }

  /* 지금 어느 센터로 들어와 있는지 (칩 표시용). 저장소마다 다르므로 위임한다.
     체험(idb)에는 센터가 없으니 null. */
  function center() {
    return (cur && typeof cur.center === 'function') ? cur.center() : null;
  }

  /* 가족 링크 — 서버(supa)에만 있다. 체험(idb)에서 부르면 막는다.
     화면 코드가 StoreSupa 를 직접 부르지 않도록 여기서 위임한다. */
  function issueShare(elderId) {
    if (!cur || typeof cur.issueShare !== 'function') {
      return Promise.reject(new Error('로그인한 뒤에 가족 링크를 만들 수 있습니다.'));
    }
    return cur.issueShare(elderId);
  }
  function revokeShare(elderId) {
    if (!cur || typeof cur.revokeShare !== 'function') {
      return Promise.reject(new Error('로그인한 뒤에 폐기할 수 있습니다.'));
    }
    return cur.revokeShare(elderId);
  }

  var Store = { backend: null, use: use, ready: ready, center: center,
                issueShare: issueShare, revokeShare: revokeShare };

  METHODS.forEach(function (m) {
    Store[m] = function () {
      if (!cur) return Promise.reject(new Error('저장소가 아직 준비되지 않았습니다.'));
      var fn = cur[m];
      if (typeof fn !== 'function') {
        return Promise.reject(new Error(cur.backend + ' 저장소에 ' + m + ' 이(가) 없습니다.'));
      }
      return fn.apply(cur, arguments);
    };
  });

  global.Store = Store;
})(window);
