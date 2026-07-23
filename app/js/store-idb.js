/* ============================================================
 * store-idb.js — 저장소 · 기기 안 (IndexedDB)
 *
 * 「체험 모드」가 쓰는 저장소다. 로그인하지 않으면 여기에 담긴다.
 * 서버로 나가지 않으므로 링크를 받은 사람이 마음 놓고 만져볼 수 있다.
 *
 * 고르는 일은 store.js 가 한다. 이 파일은 구현만 한다.
 * 계약(함수 이름과 반환 모양)은 store-supa.js 와 정확히 같아야 한다.
 *
 * 계약은 store.js 머리에 적어 두었다.
 *
 * ── 지우기가 두 종류인 이유 ────────────────────────
 *   실수 교정  : 잘못 찍음·잘못 고름 → 되돌릴 수 있어야 한다
 *   의사 존중  : 어르신·가족이 원치 않음 → 진짜로 지워져야 한다
 *   섞으면 둘 중 하나는 반드시 어긴다. 그래서 나눠 둔다.
 * ============================================================ */

(function (global) {
  "use strict";

  var DB_NAME = 'geurium';
  var DB_VER  = 1;

  var S_ELDERS  = 'elders';
  var S_RECORDS = 'records';
  var S_BLOBS   = 'blobs';    // 🔑 이미지는 따로 둔다 — 목록 조회가 가벼워진다

  var _db = null;

  function open() {
    if (_db) return Promise.resolve(_db);
    return new Promise(function (resolve, reject) {
      var req = indexedDB.open(DB_NAME, DB_VER);

      req.onupgradeneeded = function (ev) {
        var db = ev.target.result;
        var old = ev.oldVersion;

        /* v1 — 최초 생성 */
        if (old < 1) {
          var elders = db.createObjectStore(S_ELDERS, { keyPath: 'id' });
          elders.createIndex('by_name', 'name', { unique: false });

          var recs = db.createObjectStore(S_RECORDS, { keyPath: 'id' });
          recs.createIndex('by_elder',    'elderId',    { unique: false });
          recs.createIndex('by_occurred', 'occurredAt', { unique: false });
          recs.createIndex('by_kind',     'kind',       { unique: false });

          db.createObjectStore(S_BLOBS, { keyPath: 'id' });
        }

        /* 앞으로 필드가 늘면 여기에 if (old < 2) { ... } 를 더한다.
           절대 기존 스토어를 지우지 않는다. */
      };

      req.onsuccess = function () { _db = req.result; resolve(_db); };
      req.onerror   = function () { reject(req.error); };
    });
  }

  function tx(names, mode) {
    return open().then(function (db) {
      return db.transaction(names, mode || 'readonly');
    });
  }

  function reqToPromise(r) {
    return new Promise(function (res, rej) {
      r.onsuccess = function () { res(r.result); };
      r.onerror   = function () { rej(r.error); };
    });
  }

  function getAll(storeName, indexName, query) {
    return tx([storeName]).then(function (t) {
      var s = t.objectStore(storeName);
      var src = indexName ? s.index(indexName) : s;
      return reqToPromise(src.getAll(query));
    });
  }

  /* ── 어르신 ─────────────────────────────────────── */

  function listElders(opts) {
    opts = opts || {};
    return getAll(S_ELDERS).then(function (rows) {
      return rows
        .filter(function (e) { return opts.includeInactive ? true : e.active !== false; })
        .sort(function (a, b) { return a.name.localeCompare(b.name, 'ko'); });
    });
  }

  function getElder(id) {
    return tx([S_ELDERS]).then(function (t) {
      return reqToPromise(t.objectStore(S_ELDERS).get(id));
    });
  }

  function saveElder(elder) {
    return tx([S_ELDERS], 'readwrite').then(function (t) {
      return reqToPromise(t.objectStore(S_ELDERS).put(elder)).then(function () { return elder; });
    });
  }

  /* 퇴소해도 기록은 남아야 하므로 실제로 지우지 않는다 */
  function removeElder(id) {
    return getElder(id).then(function (e) {
      if (!e) return null;
      e.active = false;
      e.updatedAt = Model.nowIso();
      return saveElder(e);
    });
  }

  /* ── 기록 ───────────────────────────────────────── */

  /* opts.deleted
   *   생략 · false → 살아 있는 것만 (기본)
   *   true          → 지운 것만
   *   'all'         → 전부
   */
  function listRecords(opts) {
    opts = opts || {};
    var p = opts.elderId
      ? getAll(S_RECORDS, 'by_elder', IDBKeyRange.only(opts.elderId))
      : getAll(S_RECORDS);

    return p.then(function (rows) {
      if (opts.deleted === true) {
        rows = rows.filter(function (r) { return !!r.deletedAt; });
      } else if (opts.deleted !== 'all') {
        rows = rows.filter(function (r) { return !r.deletedAt; });
      }
      if (opts.kind)       rows = rows.filter(function (r) { return r.kind === opts.kind; });
      if (opts.occurredAt) rows = rows.filter(function (r) { return r.occurredAt === opts.occurredAt; });

      if (opts.deleted === true) {
        /* 지운 것은 "최근에 지운 것"이 위로 */
        rows.sort(function (a, b) {
          return String(b.deletedAt || '').localeCompare(String(a.deletedAt || ''));
        });
      } else {
        /* 최근 것이 위로 */
        rows.sort(function (a, b) {
          var d = String(b.occurredAt || '').localeCompare(String(a.occurredAt || ''));
          return d !== 0 ? d : String(b.createdAt).localeCompare(String(a.createdAt));
        });
      }
      return opts.limit ? rows.slice(0, opts.limit) : rows;
    });
  }

  function getRecord(id) {
    return tx([S_RECORDS]).then(function (t) {
      return reqToPromise(t.objectStore(S_RECORDS).get(id));
    });
  }

  /* 기록과 이미지를 한 트랜잭션으로 — 하나만 남는 일이 없게 */
  function saveRecord(record, blobs) {
    blobs = blobs || {};
    return tx([S_RECORDS, S_BLOBS], 'readwrite').then(function (t) {
      var ps = [reqToPromise(t.objectStore(S_RECORDS).put(record))];
      if (blobs.image || blobs.thumb) {
        ps.push(reqToPromise(t.objectStore(S_BLOBS).put({
          id: record.id,
          image: blobs.image || null,
          thumb: blobs.thumb || null
        })));
      }
      return Promise.all(ps).then(function () { return record; });
    });
  }

  /* 🗑 지운 것으로 옮긴다 — 아직 실제로 지우지 않는다 */
  function removeRecord(id) {
    return getRecord(id).then(function (r) {
      if (!r) return null;
      r.deletedAt = Model.nowIso();
      r.updatedAt = Model.nowIso();
      return saveRecord(r);
    });
  }

  /* 되돌리기 */
  function restoreRecord(id) {
    return getRecord(id).then(function (r) {
      if (!r) return null;
      r.deletedAt = null;
      r.updatedAt = Model.nowIso();
      return saveRecord(r);
    });
  }

  /* 완전히 지운다 — 사진 파일까지 없앤다. 되돌릴 수 없다.
     어르신·가족이 "빼달라"고 하신 경우가 여기다. */
  function purgeRecord(id) {
    return tx([S_RECORDS, S_BLOBS], 'readwrite').then(function (t) {
      return Promise.all([
        reqToPromise(t.objectStore(S_RECORDS).delete(id)),
        reqToPromise(t.objectStore(S_BLOBS).delete(id))
      ]).then(function () { return true; });
    });
  }

  /* 지운 지 오래된 것을 자동으로 완전 삭제한다.
     개인정보를 무한정 들고 있지 않기 위해서다. 앱을 열 때 조용히 돈다. */
  function purgeExpired(days) {
    days = days || 30;
    var cutoff = new Date(Date.now() - days * 86400000).toISOString();
    return listRecords({ deleted: true }).then(function (rows) {
      var old = rows.filter(function (r) { return r.deletedAt && r.deletedAt < cutoff; });
      if (!old.length) return 0;
      return old.reduce(function (chain, r) {
        return chain.then(function () { return purgeRecord(r.id); });
      }, Promise.resolve()).then(function () { return old.length; });
    });
  }

  /* ── 이미지 ─────────────────────────────────────── */

  function _blobRow(id) {
    return tx([S_BLOBS]).then(function (t) {
      return reqToPromise(t.objectStore(S_BLOBS).get(id));
    });
  }
  function getImage(recordId) {
    return _blobRow(recordId).then(function (row) { return row ? row.image : null; });
  }
  function getThumb(recordId) {
    return _blobRow(recordId).then(function (row) {
      return row ? (row.thumb || row.image) : null;
    });
  }

  /* ── 통계 ───────────────────────────────────────── */

  function stats() {
    return Promise.all([
      listElders(),
      listRecords(),
      listRecords({ deleted: true }),
      getAll(S_BLOBS)
    ]).then(function (r) {
      var bytes = 0;
      r[3].forEach(function (b) {
        if (b.image && b.image.size) bytes += b.image.size;
        if (b.thumb && b.thumb.size) bytes += b.thumb.size;
      });
      return {
        elders: r[0].length,
        records: r[1].length,
        deleted: r[2].length,
        bytes: bytes
      };
    });
  }

  /* 개발용 — 전부 지우기 */
  function wipe() {
    return tx([S_ELDERS, S_RECORDS, S_BLOBS], 'readwrite').then(function (t) {
      return Promise.all([
        reqToPromise(t.objectStore(S_ELDERS).clear()),
        reqToPromise(t.objectStore(S_RECORDS).clear()),
        reqToPromise(t.objectStore(S_BLOBS).clear())
      ]);
    });
  }

  global.StoreIdb = {
    backend: 'idb',
    ready: open,
    listElders: listElders,
    getElder: getElder,
    saveElder: saveElder,
    removeElder: removeElder,
    listRecords: listRecords,
    getRecord: getRecord,
    saveRecord: saveRecord,
    removeRecord: removeRecord,
    restoreRecord: restoreRecord,
    purgeRecord: purgeRecord,
    purgeExpired: purgeExpired,
    getImage: getImage,
    getThumb: getThumb,
    stats: stats,
    wipe: wipe
  };
})(window);
