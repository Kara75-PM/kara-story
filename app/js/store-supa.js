/* ============================================================
 * store-supa.js — 저장소 · 서울 서버 (Supabase)
 *
 * 로그인한 센터 직원이 쓰는 저장소. 계약은 store.js 머리에 적혀 있고,
 * store-idb.js 와 글자 하나까지 같아야 한다.
 *
 * ── 이름 번역이 여기서만 일어난다 ──────────────────
 *   DB   snake_case   occurred_at, redact_top, byte_size
 *   앱   camelCase    occurredAt,  redactTop,  byteSize
 *   화면 코드는 DB 이름을 모른다. 알 필요도 없다.
 *
 * ── 사진 ────────────────────────────────────────────
 *   artworks/{center_id}/{record_id}.jpg     원본
 *   artworks/{center_id}/{record_id}_t.jpg   목록용
 *   경로를 기록 번호에서 그대로 만든다. 그래서 다시 올려도 덮어쓰기가 되고,
 *   중간에 실패해도 쓰레기가 쌓이지 않는다.
 * ============================================================ */

(function (global) {
  "use strict";

  var BUCKET = 'artworks';
  var me = null;          // {id, center_id, name, role, active}

  /* ── 이름 번역 ──────────────────────────────────── */

  function elderToApp(r) {
    if (!r) return null;
    return {
      id: r.id, name: r.name, birthYear: r.birth_year,
      centerId: r.center_id, note: r.note, active: r.active !== false,
      createdAt: r.created_at, updatedAt: r.updated_at
    };
  }

  function elderToDb(e) {
    return {
      id: e.id, name: e.name,
      birth_year: e.birthYear != null ? e.birthYear : null,
      note: e.note || null,
      active: e.active !== false
    };
  }

  function recToApp(r) {
    if (!r) return null;
    return {
      id: r.id, elderId: r.elder_id, kind: r.kind,
      occurredAt: r.occurred_at, occurredHint: r.occurred_hint,
      activity: r.activity, note: r.note,
      redacted: !!r.redacted,
      redactTop: Number(r.redact_top) || 0,
      redactBottom: Number(r.redact_bottom) || 0,
      width: r.width, height: r.height, byteSize: r.byte_size,
      createdAt: r.created_at, createdBy: r.created_by,
      updatedAt: r.updated_at, deletedAt: r.deleted_at,
      _imagePath: r.image_path, _thumbPath: r.thumb_path
    };
  }

  /* 고칠 때 보내는 것. center_id·created_by·created_at 은 여기 없다 —
     한 번 정해진 뒤엔 바뀌면 안 되는 값이라 아예 보내지 않는다. */
  function recToDb(r) {
    return {
      id: r.id, elder_id: r.elderId, kind: r.kind || 'artwork',
      occurred_at: r.occurredAt, occurred_hint: r.occurredHint || null,
      activity: r.activity || null, note: r.note || null,
      redacted: !!r.redacted,
      redact_top: Number(r.redactTop) || 0,
      redact_bottom: Number(r.redactBottom) || 0,
      width: r.width || null, height: r.height || null,
      byte_size: r.byteSize || null,
      deleted_at: r.deletedAt || null
    };
  }

  function imagePath(id) { return me.center_id + '/' + id + '.jpg'; }
  function thumbPath(id) { return me.center_id + '/' + id + '_t.jpg'; }

  /* ── 준비 ───────────────────────────────────────── */

  function ready() {
    if (!Supa.signedIn()) return Promise.reject(new Error('로그인이 필요합니다.'));
    if (me) return Promise.resolve(me);
    return Supa.rest('profiles?select=id,center_id,name,role,active,centers(name)')
      .then(function (rows) {
        var mine = (rows || []).filter(function (p) { return p.id === Supa.user.id; })[0];
        if (!mine)  throw new Error('직원 정보를 찾지 못했습니다. 센터에 문의해 주세요.');
        if (!mine.active)    throw new Error('사용이 중지된 계정입니다.');
        if (!mine.center_id) throw new Error('아직 센터가 지정되지 않았습니다. 센터에 문의해 주세요.');
        mine.center_name = mine.centers && mine.centers.name;
        me = mine;
        return me;
      });
  }

  function forget() { me = null; }

  /* 지금 어느 센터로 들어와 있는지 — 화면 상단에 보여주기 위한 것 */
  function center() { return me && me.center_name ? me.center_name : null; }

  /* ── 어르신 ─────────────────────────────────────── */

  function listElders(opts) {
    opts = opts || {};
    var q = 'elders?select=*&order=name.asc';
    if (!opts.includeInactive) q += '&active=is.true';
    return Supa.rest(q).then(function (rows) {
      return (rows || []).map(elderToApp)
        .sort(function (a, b) { return a.name.localeCompare(b.name, 'ko'); });
    });
  }

  function getElder(id) {
    return Supa.rest('elders?select=*&id=eq.' + id).then(function (r) {
      return elderToApp((r || [])[0]);
    });
  }

  function saveElder(elder) {
    var body = elderToDb(elder);
    return Supa.rest('elders?id=eq.' + elder.id, {
      method: 'PATCH', body: JSON.stringify(body),
      headers: { Prefer: 'return=representation' }
    }).then(function (rows) {
      if (rows && rows.length) return elderToApp(rows[0]);
      body.center_id = me.center_id;          /* 새로 넣을 때만 센터를 적는다 */
      return Supa.rest('elders', {
        method: 'POST', body: JSON.stringify(body),
        headers: { Prefer: 'return=representation' }
      }).then(function (ins) { return elderToApp((ins || [])[0]); });
    });
  }

  function removeElder(id) {
    return Supa.rest('elders?id=eq.' + id, {
      method: 'PATCH', body: JSON.stringify({ active: false }),
      headers: { Prefer: 'return=representation' }
    }).then(function (rows) { return elderToApp((rows || [])[0]); });
  }

  /* ── 기록 ───────────────────────────────────────── */

  function listRecords(opts) {
    opts = opts || {};
    var q = 'records?select=*';
    if (opts.deleted === true)       q += '&deleted_at=not.is.null';
    else if (opts.deleted !== 'all') q += '&deleted_at=is.null';
    if (opts.elderId)    q += '&elder_id=eq.' + opts.elderId;
    if (opts.kind)       q += '&kind=eq.' + encodeURIComponent(opts.kind);
    if (opts.occurredAt) q += '&occurred_at=eq.' + opts.occurredAt;

    q += (opts.deleted === true)
      ? '&order=deleted_at.desc'
      : '&order=occurred_at.desc,created_at.desc';
    if (opts.limit) q += '&limit=' + opts.limit;

    return Supa.rest(q).then(function (rows) { return (rows || []).map(recToApp); });
  }

  function getRecord(id) {
    return Supa.rest('records?select=*&id=eq.' + id).then(function (r) {
      return recToApp((r || [])[0]);
    });
  }

  /* 사진을 먼저 올리고 그다음에 줄을 넣는다.
     반대로 하면 「그림 없는 기록」이 화면에 남는다 — 그게 더 나쁘다.
     경로가 기록 번호에서 나오므로 다시 시도해도 같은 자리에 덮어쓴다. */
  function saveRecord(record, blobs) {
    blobs = blobs || {};
    var ups = [];
    if (blobs.image) ups.push(Supa.upload(BUCKET, imagePath(record.id), blobs.image));
    if (blobs.thumb) ups.push(Supa.upload(BUCKET, thumbPath(record.id), blobs.thumb));

    return Promise.all(ups).then(function () {
      var body = recToDb(record);
      if (blobs.image) body.image_path = imagePath(record.id);
      if (blobs.thumb) body.thumb_path = thumbPath(record.id);

      return Supa.rest('records?id=eq.' + record.id, {
        method: 'PATCH', body: JSON.stringify(body),
        headers: { Prefer: 'return=representation' }
      }).then(function (rows) {
        if (rows && rows.length) return recToApp(rows[0]);
        /* 없으면 새로 넣는다. 이때만 센터와 올린 사람을 적는다. */
        body.center_id  = me.center_id;
        body.created_by = Supa.user.id;
        return Supa.rest('records', {
          method: 'POST', body: JSON.stringify(body),
          headers: { Prefer: 'return=representation' }
        }).then(function (ins) { return recToApp((ins || [])[0]); });
      });
    });
  }

  function setDeleted(id, when) {
    return Supa.rest('records?id=eq.' + id, {
      method: 'PATCH', body: JSON.stringify({ deleted_at: when }),
      headers: { Prefer: 'return=representation' }
    }).then(function (rows) { return recToApp((rows || [])[0]); });
  }

  function removeRecord(id)  { return setDeleted(id, Model.nowIso()); }
  function restoreRecord(id) { return setDeleted(id, null); }

  /* 완전히 지운다 — 사진 파일까지. 되돌릴 수 없다. */
  function purgeRecord(id) {
    return Supa.removeObjects(BUCKET, [imagePath(id), thumbPath(id)])
      .catch(function () { /* 파일이 없어도 줄은 지운다 */ })
      .then(function () {
        return Supa.rest('records?id=eq.' + id, { method: 'DELETE' });
      })
      .then(function () { return true; });
  }

  function purgeExpired(days) {
    days = days || 30;
    var cutoff = new Date(Date.now() - days * 86400000).toISOString();
    return Supa.rest('records?select=id&deleted_at=not.is.null&deleted_at=lt.' +
                     encodeURIComponent(cutoff))
      .then(function (rows) {
        rows = rows || [];
        if (!rows.length) return 0;
        return rows.reduce(function (chain, r) {
          return chain.then(function () { return purgeRecord(r.id); });
        }, Promise.resolve()).then(function () { return rows.length; });
      });
  }

  /* ── 사진 ───────────────────────────────────────── */

  function fetchBlob(path) {
    return Supa.download(BUCKET, path).then(function (b) {
      return (b && b.size) ? b : null;
    }).catch(function () { return null; });
  }

  function getImage(recordId) { return fetchBlob(imagePath(recordId)); }
  function getThumb(recordId) {
    return fetchBlob(thumbPath(recordId)).then(function (b) {
      return b || fetchBlob(imagePath(recordId));   /* 썸네일이 없으면 원본으로 */
    });
  }

  /* ── 통계 ───────────────────────────────────────── */

  function stats() {
    return Promise.all([
      Supa.rest('elders?select=id&active=is.true'),
      Supa.rest('records?select=byte_size&deleted_at=is.null'),
      Supa.rest('records?select=id&deleted_at=not.is.null')
    ]).then(function (r) {
      var bytes = (r[1] || []).reduce(function (s, x) { return s + (x.byte_size || 0); }, 0);
      return {
        elders: (r[0] || []).length,
        records: (r[1] || []).length,
        deleted: (r[2] || []).length,
        bytes: bytes
      };
    });
  }

  /* 개발용 — 내 센터 것만 지운다. 남의 센터는 애초에 손이 닿지 않는다. */
  function wipe() {
    return listRecords({ deleted: 'all' }).then(function (rows) {
      return rows.reduce(function (chain, r) {
        return chain.then(function () { return purgeRecord(r.id); });
      }, Promise.resolve());
    }).then(function () {
      return Supa.rest('elders?center_id=eq.' + me.center_id, { method: 'DELETE' });
    }).then(function () { return true; });
  }

  global.StoreSupa = {
    backend: 'supa',
    ready: ready,
    forget: forget,
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
