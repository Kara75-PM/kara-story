/* 정적 점검 — 없는 함수를 부르는 곳이 있는지 찾는다.
   브라우저 없이 돌릴 수 있는 최소한의 안전망. */
const fs = require('fs');

function read(f) { return fs.readFileSync(f, 'utf8'); }

/* 각 모듈이 실제로 내보내는 이름 */
function exportsOf(src, globalName) {
  const m = src.match(new RegExp('global\\.' + globalName + '\\s*=\\s*\\{([\\s\\S]*?)\\n  \\};'));
  if (!m) return null;
  const names = new Set();
  m[1].replace(/(\w+)\s*:/g, (_, k) => { names.add(k); return _; });
  m[1].replace(/get\s+(\w+)\s*\(/g, (_, k) => { names.add(k); return _; });
  return names;
}

const files = {
  model: read('js/model.js'),
  store: read('js/store.js'),
  image: read('js/image.js'),
  ui:    read('js/ui.js'),
  app:   read('js/app.js')
};

/* Store 는 목록을 글자로 적어두지 않고 METHODS 배열을 돌며 만든다.
   (기기 안 / 서버 두 저장소를 갈아끼우기 위해서다)
   그래서 배열과 직접 붙인 이름을 합쳐서 읽는다. */
function storeExports(src) {
  const arr = src.match(/var METHODS\s*=\s*\[([\s\S]*?)\];/);
  if (!arr) return null;
  const names = new Set();
  arr[1].replace(/'(\w+)'/g, (_, k) => { names.add(k); return _; });
  src.replace(/var Store\s*=\s*\{([\s\S]*?)\};/, (_, body) => {
    body.replace(/(\w+)\s*:/g, (__, k) => { names.add(k); return __; });
    return _;
  });
  return names.size ? names : null;
}

/* Supa 는 get 접근자를 섞어 쓴다 */
function supaExports(src) {
  const m = src.match(/global\.Supa\s*=\s*\{([\s\S]*?)\n  \};/);
  if (!m) return null;
  const names = new Set();
  m[1].replace(/(?:^|[,{\n])\s*(\w+)\s*:/g, (_, k) => { names.add(k); return _; });
  m[1].replace(/get\s+(\w+)\s*\(/g, (_, k) => { names.add(k); return _; });
  return names;
}

const api = {
  Model: exportsOf(files.model, 'Model'),
  Store: storeExports(files.store),
  Img:   exportsOf(files.image, 'Img'),
  UI:    exportsOf(files.ui, 'UI'),
  /* 🔑 저장소 구현과 서버 층도 본다.
     v13 에서 center() 를 만들어놓고 내보내지 않아 칩이 조용히 비었다.
     그때 이 세 줄이 없어서 못 잡았다. */
  StoreIdb:  exportsOf(read('js/store-idb.js'),  'StoreIdb'),
  StoreSupa: exportsOf(read('js/store-supa.js'), 'StoreSupa'),
  Supa:      supaExports(read('js/supa.js'))
};

/* 두 저장소가 계약을 똑같이 지키는지 — 이게 어긋나면 갈아끼울 때 터진다 */
function implExports(file, globalName) {
  try { return exportsOf(read(file), globalName); } catch (e) { return null; }
}
const impls = { StoreIdb: api.StoreIdb, StoreSupa: api.StoreSupa };

let bad = 0;
for (const [ns, names] of Object.entries(api)) {
  if (!names) { console.log('✗ ' + ns + ' 내보내기 목록을 찾지 못함'); bad++; continue; }
  console.log('· ' + ns + ' 제공: ' + [...names].sort().join(', '));
}
/* 저장소 구현이 계약을 다 지키는지.
   use·backend 는 고르는 층(store.js) 자체의 것이고,
   center 는 supa 전용 선택 메서드(idb 엔 없어도 Store.center 가 위임으로 처리) — 계약 필수 아님. */
const STORE_OPTIONAL = new Set(['use', 'backend', 'center', 'issueShare', 'revokeShare']);
for (const [name, names] of Object.entries(impls)) {
  if (!names) { console.log('· ' + name + ' 아직 없음 (건너뜀)'); continue; }
  const missing = [...api.Store].filter(m => !STORE_OPTIONAL.has(m) && !names.has(m));
  if (missing.length) {
    console.log('✗ ' + name + ' 에 빠진 계약: ' + missing.join(', '));
    bad++;
  } else {
    console.log('· ' + name + ' 계약 이행 ✓');
  }
}
console.log('');

/* 호출부 점검 */
const callers = { app: files.app, ui: files.ui, store: files.store };
for (const [who, src] of Object.entries(callers)) {
  const re = /\b(Model|Store|Img|UI|StoreIdb|StoreSupa|Supa)\.(\w+)/g;
  let m, seen = new Set();
  while ((m = re.exec(src))) {
    const key = m[1] + '.' + m[2];
    if (seen.has(key)) continue;
    seen.add(key);

    /* 🔑 경계 검사: 화면 코드(app.js)는 저장소 구현(StoreIdb/StoreSupa)을
       직접 부르면 안 된다. Store 층만 거쳐야 갈아끼울 수 있다.
       (v13 칩 사고 뒤에도 center/forget 이 이 경계를 넘어 있었다) */
    if (who === 'app' && (m[1] === 'StoreIdb' || m[1] === 'StoreSupa')) {
      console.log('✗ app.js 가 ' + key + ' 를 직접 부른다 — Store 층을 거쳐야 한다 (경계 위반)');
      bad++;
      continue;
    }

    const names = api[m[1]];
    if (names && !names.has(m[2])) {
      console.log('✗ ' + who + '.js 에서 ' + key + ' 를 부르는데 ' + m[1] + ' 에 없음');
      bad++;
    }
  }
}

/* app.js 안에서 정의 없이 부르는 함수 */
const appSrc = files.app;
const defined = new Set();
appSrc.replace(/function\s+(\w+)\s*\(/g, (_, k) => { defined.add(k); return _; });
appSrc.replace(/var\s+(\w+)\s*=/g, (_, k) => { defined.add(k); return _; });

const builtins = new Set(['if','for','while','switch','catch','function','return','typeof',
  'Promise','Array','Object','Number','String','Math','Date','URL','FileReader','Image',
  'setTimeout','clearTimeout','requestAnimationFrame','confirm','prompt','alert','parseInt',
  'parseFloat','isNaN','document','window','indexedDB','IDBKeyRange','console','JSON','Boolean']);

const callRe = /(?:^|[^.\w])(\w+)\s*\(/gm;
let mm, missing = new Set();
while ((mm = callRe.exec(appSrc))) {
  const n = mm[1];
  if (defined.has(n) || builtins.has(n)) continue;
  if (/^[A-Z]/.test(n)) continue;
  missing.add(n);
}
if (missing.size) {
  console.log('· app.js 에서 정의를 못 찾은 호출(오탐 가능): ' + [...missing].join(', '));
}

/* 가족 화면이 창고에 직접 손을 뻗지 않는가
 *
 * 여기가 R-58 의 뿌리였다. 가족 화면이 /storage/v1/object/... 를 직접
 * 부르려면 창고를 anon 에게 열어야 하고, 그러면 공유 하나만 켜져 있어도
 * 그 센터 사진이 전부 열거된다. (2026-07-28 · 07-30 두 번 실측 재현)
 *
 * 2026-07-30 에 서버 프로그램(functions/photo)을 거치게 바꿨다.
 * 이 규칙은 그게 되돌아오는 것을 막는다 —
 * 급할 때 「잠깐만 직접 부르자」 가 사고가 되는 길이다. */
try {
  const viewSrc = require('fs').readFileSync(
    require('path').join(__dirname, 'view.html'), 'utf8');
  const hits = (viewSrc.match(/[/]storage[/]v1[/]object[/]/g) || []).length;
  if (hits) {
    console.log('X view.html 이 사진 창고를 직접 부른다 (' + hits + '곳) — R-58 이 되살아난다.');
    console.log('  서버 프로그램(/functions/v1/photo) 을 거쳐야 한다.');
    bad += hits;
  } else {
    console.log('· view.html 이 창고를 직접 부르지 않음 ✓');
  }
} catch (e) {
  console.log('X view.html 을 읽지 못했다 — ' + e.message);
  bad++;
}

/* 가족 화면이 연대기를 **실제로 쓰는가**
 *
 * ⚠️ 2026-07-30 테스트 마스터가 돌연변이 실험으로 잡았다.
 *    `render()` 안에서 `groupByPeriod(...)` 호출만 지우면
 *    **연대기가 화면에서 완전히 사라지는데 `_test2.js` 24건이 전부 통과**했다.
 *    `_test2.js` 는 함수 4개를 떼어내 「계산이 맞는가」만 보고,
 *    「화면이 그 함수를 쓰는가」는 보지 않기 때문이다.
 *
 * 배운 것: 역대조를 **한 겹만** 했다. 함수를 망가뜨려 실패를 봤지만,
 *          호출을 끊었을 때는 안 봤다. 그 한 겹을 여기서 메운다. */
try {
  const viewSrc = require('fs').readFileSync(
    require('path').join(__dirname, 'view.html'), 'utf8');
  const i = viewSrc.indexOf('function render(');
  if (i < 0) {
    console.log('X view.html 에 render() 가 없다');
    bad++;
  } else if (viewSrc.slice(i).indexOf('groupByPeriod(') < 0) {
    console.log('X view.html 의 render() 가 groupByPeriod() 를 부르지 않는다');
    console.log('  — 연대기가 화면에서 사라진다. _test2.js 는 이걸 못 잡는다.');
    bad++;
  } else {
    console.log('· view.html 의 render() 가 연대기를 실제로 부름 ✓');
  }
} catch (e) {
  console.log('X view.html 연대기 호출 검사 실패 — ' + e.message);
  bad++;
}

/* 홈 화면의 두 목록이 **같은 기준**을 쓰는가
 *
 * 🔴 2026-07-30 개발 마스터가 잡은 것.
 *    「오늘 남긴 것」을 `uploadedToday`(올린 날)로 바꾸면서
 *    「지금까지 쌓인 것」(renderPast)은 `occurredAt !== today`(만든 날) 그대로 뒀다.
 *    그러면 **오늘 올린 옛 사진이 양쪽에 다 뜬다.**
 *    두 목록은 서로 **여집합**이어야 하므로 판정 함수가 하나여야 한다.
 *
 * 견본이 3장 중 2장을 옛 사진으로 만들고 실사용자 5명이 전부 체험 모드라,
 * 이건 이론이 아니라 **그분들이 보던 화면**이었다. */
{
  const m = files.app.match(/function renderPast\s*\([\s\S]*?\n  \}/);
  if (!m) {
    console.log('X app.js 에서 renderPast 를 찾지 못함');
    bad++;
  } else if (m[0].indexOf('uploadedToday') < 0) {
    console.log('X renderPast 가 uploadedToday 를 안 쓴다 —');
    console.log('  「오늘 남긴 것」과 기준이 갈라져 옛 사진이 두 목록에 다 뜬다.');
    bad++;
  } else {
    console.log('· 홈의 두 목록이 같은 기준(uploadedToday)을 씀 ✓');
  }
}

console.log('');
console.log(bad === 0 ? '✅ 참조 문제 없음' : '❌ 문제 ' + bad + '건');
process.exit(bad === 0 ? 0 : 1);
