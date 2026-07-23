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

console.log('');
console.log(fail === 0 ? `✅ 통과 ${pass}건` : `❌ 실패 ${fail}건 / 통과 ${pass}건`);
process.exit(fail === 0 ? 0 : 1);
