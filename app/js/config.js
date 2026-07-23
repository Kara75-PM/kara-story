/* ============================================================
 * config.js — 서버 연결 정보
 *
 * ⚠️ 이 저장소(geurium-story)는 Public 이다.
 *    여기 들어가는 값은 「공개돼도 되는 것」만이다.
 *
 * 왜 공개돼도 되나
 *   이 앱은 GitHub Pages 로 서비스되는 정적 페이지다. 서버가 없으므로
 *   브라우저가 쓰는 값은 어차피 사람이 볼 수 있다. 숨길 방법이 없다.
 *   그래서 Supabase 는 「공개용 키」와 「비밀 키」를 나눠 준다.
 *
 *   publishable key 는 문을 여는 열쇠가 아니라 「어느 집인지 말하는 이름표」다.
 *   실제 보호는 서버 쪽 권한 규칙(RLS)이 한다. 규칙이 없으면 이 키로도
 *   다 읽힌다 — 그래서 A1-3 을 건너뛰면 안 된다.
 *
 * 🔴 여기에 절대 넣지 않는 것
 *   - sb_secret_...        (모든 권한을 뚫는다)
 *   - service_role 키      (옛 방식의 같은 것)
 *   - 데이터베이스 비밀번호
 *   - 어르신 이름·사진 등 실제 개인 데이터
 * ============================================================ */

(function (global) {
  "use strict";

  global.CONFIG = {
    /* 프로젝트 주소 — 서울 리전(ap-northeast-2) */
    supabaseUrl: 'https://ilddzynjvsdldexkhglt.supabase.co',

    /* 공개용 키. 옛 anon 키는 2026년 말 폐기되므로 처음부터 새 방식을 쓴다. */
    supabaseKey: 'sb_publishable_wAHq8P4sWySQR4p-5yJcrQ_ot5Edv-8',

    /* 저장소를 어디에 둘지 — 갈아끼울 때 여기만 바꾼다.
       'idb'  : 브라우저 안에만 (지금까지)
       'supa' : 서버 (A1 이 끝나면) */
    backend: 'idb'
  };
})(window);
