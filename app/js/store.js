/* ============================================================
 * store.js — 저장소
 *
 * ⚠️ 이 파일만 갈아끼우면 저장 위치가 바뀐다.
 *    오늘: IndexedDB (브라우저 안)
 *    내일: Supabase  (서울 리전)
 *
 * 화면 코드(ui.js / app.js)는 아래 인터페이스만 알면 된다.
 * 그러니 이 목록을 바꿀 때는 신중해야 한다.
 *
 *   Store.ready()                       저장소 준비
 *   Store.listElders()                  어르신 목록
 *   Store.getElder(id)
 *   Store.saveElder(elder)
 *   Store.removeElder(id)
 *   Store.listRecords({elderId, limit}) 기록 목록 (이미지는 안 딸려온다)
 *   Store.getRecord(id)
 *   Store.saveRecord(record, blob)      기록 + 이미지
 *   Store.removeRecord(id)              지우지 않고 표시만
 *   Store.getImage(recordId)            Blob
 *   Store.getThumb(recordId)            Blob (작은 것)
 *   Store.stats()                       개수·용량
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

  function listRecords(opts) {
    opts = opts || {};
    var p = opts.elderId
      ? getAll(S_RECORDS, 'by_elder', IDBKeyRange.only(opts.elderId))
      : getAll(S_RECORDS);

    return p.then(function (rows) {
      rows = rows.filter(function (r) { return !r.deletedAt; });
      if (opts.kind)       rows = rows.filter(function (r) { return r.kind === opts.kind; });
      if (opts.occurredAt) rows = rows.filter(function (r) { return r.occurredAt === opts.occurredAt; });
      /* 최근 것이 위로 */
      rows.sort(function (a, b) {
        var d = String(b.occurredAt || '').localeCompare(String(a.occurredAt || ''));
        return d !== 0 ? d : String(b.createdAt).localeCompare(String(a.createdAt));
      });
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

  /* 지우지 않고 표시만 — 실수로 지웠을 때 복구할 수 있게 */
  function removeRecord(id, hard) {
    if (hard) {
      return tx([S_RECORDS, S_BLOBS], 'readwrite').then(function (t) {
        return Promise.all([
          reqToPromise(t.objectStore(S_RECORDS).delete(id)),
          reqToPromise(t.objectStore(S_BLOBS).delete(id))
        ]);
      });
    }
    return getRecord(id).then(function (r) {
      if (!r) return null;
      r.deletedAt = Model.nowIso();
      r.updatedAt = Model.nowIso();
      return saveRecord(r);
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
    return Promise.all([listElders(), listRecords(), getAll(S_BLOBS)])
      .then(function (r) {
        var bytes = 0;
        r[2].forEach(function (b) {
          if (b.image && b.image.size) bytes += b.image.size;
          if (b.thumb && b.thumb.size) bytes += b.thumb.size;
        });
        return { elders: r[0].length, records: r[1].length, bytes: bytes };
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

  global.Store = {
    backend: 'indexeddb',      // 내일 'supabase' 로 바뀐다
    ready: open,
    listElders: listElders,
    getElder: getElder,
    saveElder: saveElder,
    removeElder: removeElder,
    listRecords: listRecords,
    getRecord: getRecord,
    saveRecord: saveRecord,
    removeRecord: removeRecord,
    getImage: getImage,
    getThumb: getThumb,
    stats: stats,
    wipe: wipe
  };
})(window);
