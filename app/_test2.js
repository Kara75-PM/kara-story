/* 이미지 자르기 계산 검증 — 가짜 캔버스로 drawScaled 의 좌표를 확인한다.
   "위를 자르라고 했는데 아래가 잘리는" 종류의 실수를 잡는다. */

/* ── 가짜 DOM ── */
const calls = [];
function fakeCtx() {
  const st = { scale: 1, tx: 0, ty: 0, rot: 0 };
  const stack = [];
  return {
    imageSmoothingQuality: '',
    save() { stack.push(Object.assign({}, st)); },
    restore() { Object.assign(st, stack.pop()); },
    scale(s) { st.scale *= s; },
    translate(x, y) {
      /* 회전 상태를 반영해 누적한다 (테스트에선 회전 0 만 검사) */
      st.tx += x; st.ty += y;
    },
    rotate(r) { st.rot += r; },
    drawImage() { calls.push(Object.assign({}, st)); }
  };
}
let lastCanvas = null;
global.document = {
  createElement(tag) {
    if (tag !== 'canvas') throw new Error('예상 못한 요소: ' + tag);
    const ctx = fakeCtx();
    lastCanvas = { width: 0, height: 0, getContext: () => ctx };
    return lastCanvas;
  }
};
global.window = global;
global.URL = { createObjectURL: () => '', revokeObjectURL: () => {} };
require('./js/image.js');

/* drawScaled 는 내부 함수라 밖에서 못 부른다.
   image.js 원문에서 계산 부분만 떼어내 평가한다. */
const fs = require('fs');
const src = fs.readFileSync('./js/image.js', 'utf8');
function grab(name) {
  const m = src.match(new RegExp('function ' + name + '\\([\\s\\S]*?\\n  \\}'));
  if (!m) { console.log('✗ ' + name + ' 를 찾지 못함'); process.exit(1); }
  return m[0];
}
const drawScaled = eval('(function(){ ' + grab('normCrop') + '\n' + grab('drawScaled') +
                        '\n return drawScaled; })()');

let pass = 0, fail = 0;
function eq(got, want, label) {
  if (Math.abs(got - want) < 1e-6) pass++;
  else { fail++; console.log(`✗ ${label}: ${got} (기대 ${want})`); }
}

const loaded = { src: {}, w: 1000, h: 2000 };   /* 세로로 긴 사진 */

/* ① 자르지 않으면 원본 비율 그대로 */
calls.length = 0;
drawScaled(loaded, 2000, null, 0);
eq(lastCanvas.width, 1000, '자르기 없음 · 너비');
eq(lastCanvas.height, 2000, '자르기 없음 · 높이');
eq(calls[0].ty, 0, '자르기 없음 · 세로 이동 0');

/* ② 아래 15% 를 자르면 높이가 85% */
calls.length = 0;
drawScaled(loaded, 2000, { top: 0, bottom: 0.15 }, 0);
eq(lastCanvas.height, 1700, '아래 15% · 높이');
eq(calls[0].ty, 0, '아래만 자를 때는 위로 안 민다');

/* ③ 위 20% 를 자르면 높이가 80% 이고, 위로 400 만큼 민다 */
calls.length = 0;
drawScaled(loaded, 2000, { top: 0.2, bottom: 0 }, 0);
eq(lastCanvas.height, 1600, '위 20% · 높이');
eq(calls[0].ty, -400, '위 20% · 위로 400 이동');

/* ④ 위 10% + 아래 15% */
calls.length = 0;
drawScaled(loaded, 2000, { top: 0.1, bottom: 0.15 }, 0);
eq(lastCanvas.height, 1500, '위아래 · 높이 75%');
eq(calls[0].ty, -200, '위아래 · 위로 200 이동');

/* ⑤ 합계가 80% 를 넘으면 안쪽에서 막는다 */
calls.length = 0;
drawScaled(loaded, 2000, { top: 0.6, bottom: 0.6 }, 0);
eq(lastCanvas.height, 400, '과다 자르기 · 남는 20%');

/* ⑥ 90도 돌리면 가로세로가 바뀐다 */
calls.length = 0;
drawScaled(loaded, 2000, null, 90);
eq(lastCanvas.width, 2000, '90도 · 너비');
eq(lastCanvas.height, 1000, '90도 · 높이');

/* ⑦ 90도 + 아래 20% — 돌린 뒤의 높이(1000) 기준으로 잘려야 한다 */
calls.length = 0;
drawScaled(loaded, 2000, { top: 0, bottom: 0.2 }, 90);
eq(lastCanvas.height, 800, '90도 + 아래 20%');

/* ⑧ 긴 변 축소가 걸리면 비율 유지 */
calls.length = 0;
drawScaled(loaded, 1000, null, 0);
eq(lastCanvas.width, 500, '축소 · 너비');
eq(lastCanvas.height, 1000, '축소 · 높이');

/* ── 가족 화면의 연대기 묶기 (2026-07-30 추가) ──────────────
 * view.html 은 브라우저 전용이라 통째로 require 하면 죽는다.
 * 묶는 함수 4개만 원문에서 떼어내 시험한다 (위 drawScaled 와 같은 수법).
 *
 * 무엇을 지키는 시험인가:
 *   설계 원칙 3 「날짜를 몰라도 된다」 — 1970년대·환갑 무렵처럼
 *   날짜가 없는 기록이 「올해」로 뭉치지 않고 제 시기에 놓이는가.
 *   이게 어제 occurredAt 을 고친 것의 출구다. */
(function () {
  const vsrc = fs.readFileSync('./view.html', 'utf8');
  const names = ['bucketKey', 'bucketLabel', 'bucketRank', 'groupByPeriod'];
  let body = '';
  for (const n of names) {
    const s0 = vsrc.indexOf('function ' + n + '(');
    if (s0 < 0) { fail++; console.log('✗ view.html 에서 ' + n + ' 를 찾지 못함'); return; }
    /* 중괄호 균형으로 함수 끝을 찾는다 */
    let d = 0, i = vsrc.indexOf('{', s0);
    for (; i < vsrc.length; i++) {
      if (vsrc[i] === '{') d++;
      else if (vsrc[i] === '}') { d--; if (d === 0) { i++; break; } }
    }
    body += vsrc.slice(s0, i) + ';\n';
  }
  const F = new Function(
    body + 'return { bucketKey, bucketLabel, bucketRank, groupByPeriod };')();

  function ok(cond, label) {
    if (cond) pass++;
    else { fail++; console.log('✗ ' + label); }
  }

  const recs = [
    { id: 'a', occurred_at: '2026-07-29' },
    { id: 'b', occurred_at: '2026-07-15' },
    { id: 'c', occurred_at: '2026-06-02' },
    { id: 'd', occurred_hint: { type: 'decade', value: '1970' } },
    { id: 'e', occurred_hint: { type: 'decade', value: '1970' } },
    { id: 'f', occurred_hint: { type: 'decade', value: '1990' } },
    { id: 'g', occurred_hint: { type: 'event', value: '환갑 무렵' } },
    { id: 'h', occurred_hint: { type: 'unknown' } },
    { id: 'i', occurred_hint: '{"type":"decade","value":"1980"}' },  /* DB 가 글자로 준 경우 */
    { id: 'j', occurred_at: null, occurred_hint: null }              /* 둘 다 없음 */
  ];
  const g = F.groupByPeriod(recs);
  const L = g.map(x => x.label);
  const at = n => L.indexOf(n);
  const find = n => g.find(x => x.label === n);

  ok(L[0] === '2026년 7월',            '연대기 · 최근이 맨 위 (받음: ' + L[0] + ')');
  ok(g[0].items.length === 2,          '연대기 · 같은 달이 한 칸에');
  ok(find('1970년대') && find('1970년대').items.length === 2, '연대기 · 1970년대가 한 칸에');
  ok(!!find('1980년대'),               '연대기 · DB 가 글자로 줘도 묶인다');
  ok(at('1990년대') < at('1980년대'),  '연대기 · 연대가 최근에서 과거 순');
  ok(at('환갑 무렵') > at('1970년대'), '연대기 · 시기를 모르는 사건은 연대보다 아래');
  ok(L[L.length - 1] === '시기를 알 수 없는 것', '연대기 · 시기 모름이 맨 아래');
  ok(g[g.length - 1].items.some(r => r.id === 'j'), '연대기 · 날짜도 시기도 없으면 모름 칸');
  /* 🔑 이 한 줄이 핵심이다 — 옛 사진이 「올해」로 섞이면 실패한다 */
  ok(!g[0].items.some(r => r.occurred_hint), '연대기 · 옛 사진이 올해 칸에 섞이지 않는다');
})();

console.log('');
console.log(fail === 0 ? `✅ 통과 ${pass}건` : `❌ 실패 ${fail}건 / 통과 ${pass}건`);
process.exit(fail === 0 ? 0 : 1);
