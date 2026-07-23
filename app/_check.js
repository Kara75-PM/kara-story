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

const api = {
  Model: exportsOf(files.model, 'Model'),
  Store: exportsOf(files.store, 'Store'),
  Img:   exportsOf(files.image, 'Img'),
  UI:    exportsOf(files.ui, 'UI')
};

let bad = 0;
for (const [ns, names] of Object.entries(api)) {
  if (!names) { console.log('✗ ' + ns + ' 내보내기 목록을 찾지 못함'); bad++; continue; }
  console.log('· ' + ns + ' 제공: ' + [...names].sort().join(', '));
}
console.log('');

/* 호출부 점검 */
const callers = { app: files.app, ui: files.ui, store: files.store };
for (const [who, src] of Object.entries(callers)) {
  const re = /\b(Model|Store|Img|UI)\.(\w+)/g;
  let m, seen = new Set();
  while ((m = re.exec(src))) {
    const key = m[1] + '.' + m[2];
    if (seen.has(key)) continue;
    seen.add(key);
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
