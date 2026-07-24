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

console.log('');
console.log(bad === 0 ? '✅ 참조 문제 없음' : '❌ 문제 ' + bad + '건');
process.exit(bad === 0 ? 0 : 1);
