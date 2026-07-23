/* ============================================================
 * supa.js — 서울 서버와 이야기하는 얇은 층
 *
 * 왜 라이브러리를 안 쓰나
 *   이 앱은 지금까지 의존성이 0이다. 우리가 필요한 것은
 *   ① 로그인 ② 표 읽고 쓰기 ③ 사진 올리고 받기 — 셋뿐이고,
 *   전부 fetch 몇 줄이다. 120KB 짜리 남의 뭉치를 통째로 들이는 것보다
 *   우리가 다 읽을 수 있는 150줄이 낫다.
 *
 * 담당하는 일
 *   - 로그인 / 로그아웃 / 세션 기억
 *   - 토큰이 만료되기 전에 조용히 갱신          ← 여기가 손으로 짤 때 제일 잘 틀린다
 *   - REST · Storage 호출에 열쇠와 토큰을 붙여준다
 *
 * ⚠️ 토큰은 localStorage 에 담는다. 폰을 여러 직원이 돌려쓰면
 *    「로그아웃」을 눌러야 다음 사람이 안 들어간다. 로그아웃을 눈에 띄게 둘 것.
 * ============================================================ */

(function (global) {
  "use strict";

  var URL_  = (global.CONFIG && global.CONFIG.supabaseUrl) || '';
  var KEY   = (global.CONFIG && global.CONFIG.supabaseKey) || '';
  var SKEY  = 'geurium.session';

  var session = null;      // {access_token, refresh_token, expires_at, user}
  var refreshing = null;   // 갱신이 겹치지 않게 붙들어 둔다

  /* ── 세션 보관 ──────────────────────────────────── */

  function load() {
    try {
      var raw = localStorage.getItem(SKEY);
      session = raw ? JSON.parse(raw) : null;
    } catch (e) { session = null; }
    return session;
  }

  function save(s) {
    session = s;
    try {
      if (s) localStorage.setItem(SKEY, JSON.stringify(s));
      else   localStorage.removeItem(SKEY);
    } catch (e) { /* 시크릿 모드 — 이번 세션만 유지된다 */ }
    return s;
  }

  function shape(json) {
    if (!json || !json.access_token) return null;
    return {
      access_token:  json.access_token,
      refresh_token: json.refresh_token,
      /* expires_in 은 초 단위. 넉넉히 60초 일찍 만료된 것으로 친다. */
      expires_at:    Date.now() + ((json.expires_in || 3600) - 60) * 1000,
      user:          json.user || (session && session.user) || null
    };
  }

  /* ── 로그인 ─────────────────────────────────────── */

  function signIn(email, password) {
    return fetch(URL_ + '/auth/v1/token?grant_type=password', {
      method: 'POST',
      headers: { apikey: KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: String(email || '').trim(), password: password })
    }).then(readJson).then(function (j) {
      var s = shape(j);
      if (!s) throw new Error(friendly(j));
      return save(s);
    });
  }

  function signOut() {
    var s = session;
    save(null);
    if (!s) return Promise.resolve();
    /* 서버 쪽 토큰도 버린다. 실패해도 우리 쪽은 이미 지웠으니 넘어간다. */
    return fetch(URL_ + '/auth/v1/logout', {
      method: 'POST',
      headers: { apikey: KEY, Authorization: 'Bearer ' + s.access_token }
    }).catch(function () {}).then(function () {});
  }

  function refresh() {
    if (refreshing) return refreshing;
    if (!session || !session.refresh_token) return Promise.reject(new Error('로그인이 필요합니다.'));

    refreshing = fetch(URL_ + '/auth/v1/token?grant_type=refresh_token', {
      method: 'POST',
      headers: { apikey: KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ refresh_token: session.refresh_token })
    }).then(readJson).then(function (j) {
      var s = shape(j);
      if (!s) { save(null); throw new Error('다시 로그인해 주세요.'); }
      return save(s);
    }).catch(function (e) {
      save(null);
      throw e;
    }).then(function (r) { refreshing = null; return r; },
            function (e) { refreshing = null; throw e; });

    return refreshing;
  }

  /* 만료가 가까우면 미리 갈아둔다 — 요청 도중에 끊기지 않게 */
  function token() {
    if (!session) return Promise.reject(new Error('로그인이 필요합니다.'));
    if (Date.now() < session.expires_at) return Promise.resolve(session.access_token);
    return refresh().then(function (s) { return s.access_token; });
  }

  /* ── 호출 ───────────────────────────────────────── */

  function readJson(res) {
    return res.text().then(function (t) {
      var j = null;
      try { j = t ? JSON.parse(t) : null; } catch (e) { j = { message: t }; }
      if (!res.ok) {
        var err = new Error(friendly(j) || ('서버 오류 ' + res.status));
        err.status = res.status;
        err.body = j;
        throw err;
      }
      return j;
    });
  }

  /* 서버가 주는 영어 메시지를 사람 말로 바꾼다 */
  function friendly(j) {
    var m = (j && (j.error_description || j.msg || j.message || j.error)) || '';
    if (/invalid login credentials/i.test(m)) return '이메일이나 비밀번호가 맞지 않습니다.';
    if (/email not confirmed/i.test(m))       return '이메일 확인이 끝나지 않은 계정입니다.';
    if (/signups not allowed|signup is disabled/i.test(m)) return '이 앱은 가입을 받지 않습니다. 센터에 문의해 주세요.';
    if (/rate limit/i.test(m))                return '잠시 뒤에 다시 시도해 주세요.';
    if (/row-level security/i.test(m))        return '권한이 없습니다.';
    if (/JWT expired|invalid claim/i.test(m)) return '로그인이 만료되었습니다. 다시 로그인해 주세요.';
    return m;
  }

  /* 토큰이 만료된 걸 뒤늦게 알면 한 번만 다시 시도한다 */
  function authed(path, opts, retried) {
    opts = opts || {};
    return token().then(function (t) {
      var h = Object.assign({ apikey: KEY, Authorization: 'Bearer ' + t }, opts.headers || {});
      return fetch(URL_ + path, Object.assign({}, opts, { headers: h }));
    }).then(function (res) {
      if (res.status === 401 && !retried) {
        return refresh().then(function () { return authed(path, opts, true); });
      }
      return res;
    });
  }

  /* 표 — PostgREST */
  function rest(path, opts) {
    opts = opts || {};
    var h = Object.assign({ Accept: 'application/json' }, opts.headers || {});
    if (opts.body) h['Content-Type'] = 'application/json';
    return authed('/rest/v1/' + path, Object.assign({}, opts, { headers: h })).then(readJson);
  }

  /* 사진 — Storage */
  function upload(bucket, objectPath, blob) {
    return authed('/storage/v1/object/' + bucket + '/' + objectPath, {
      method: 'POST',
      headers: { 'Content-Type': blob.type || 'image/jpeg', 'x-upsert': 'true' },
      body: blob
    }).then(function (res) {
      if (!res.ok) return readJson(res);
      return true;
    });
  }

  function download(bucket, objectPath) {
    return authed('/storage/v1/object/' + bucket + '/' + objectPath).then(function (res) {
      if (res.status === 404) return null;
      if (!res.ok) return readJson(res);
      return res.blob();
    });
  }

  function removeObjects(bucket, paths) {
    if (!paths || !paths.length) return Promise.resolve(true);
    return authed('/storage/v1/object/' + bucket, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prefixes: paths })
    }).then(function () { return true; });
  }

  load();

  global.Supa = {
    get session() { return session; },
    get user()    { return session && session.user; },
    signedIn: function () { return !!session; },
    signIn: signIn,
    signOut: signOut,
    refresh: refresh,
    token: token,
    rest: rest,
    upload: upload,
    download: download,
    removeObjects: removeObjects,
    friendly: friendly
  };
})(window);
