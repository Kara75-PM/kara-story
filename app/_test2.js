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
const src = fs.readFileSync(require('path').join(__dirname, 'js', 'image.js'), 'utf8');
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
  const vsrc = fs.readFileSync(require('path').join(__dirname, 'view.html'), 'utf8');

  /* 2026-07-30 — 중괄호를 그냥 세면 **문자열 안의 중괄호까지 센다.**
   *    parseHint 에 `s.charAt(0) === '{'` 를 넣자마자 추출이 통째로 깨졌다.
   *    (개발 마스터가 미리 경고한 함정이다)
   *    그래서 세기 전에 **문자열과 주석을 같은 길이의 공백으로 덮는다.**
   *    자리 수가 그대로라 원문에서 잘라내는 위치는 안 바뀐다. */
  function maskLiterals(src) {
    const out = src.split('');
    const NLC = String.fromCharCode(10);
    const BT  = String.fromCharCode(96);
    const BS  = String.fromCharCode(92);
    const blank = j => { if (src[j] !== NLC) out[j] = ' '; };
    /* 앞의 뜻있는 글자를 보고 「나눗셈이냐 정규식이냐」를 가른다.
       (, = : [ ! & | ? { ; } 뒤의 / 는 정규식이다 — 흔히 쓰는 판별법이다. */
    const REGEX_AFTER = '(,=:[!&|?{;}+-*%~^';
    let prev = '';
    let i = 0;
    while (i < src.length) {
      const c = src[i];
      if (c === '/' && src[i + 1] === '/') {
        while (i < src.length && src[i] !== NLC) { blank(i); i++; }
        continue;
      }
      if (c === '/' && src[i + 1] === '*') {
        blank(i); blank(i + 1); i += 2;
        while (i < src.length && !(src[i] === '*' && src[i + 1] === '/')) { blank(i); i++; }
        if (i < src.length) { blank(i); blank(i + 1); i += 2; }
        continue;
      }
      /* 정규식 리터럴 — 안에 따옴표나 중괄호가 있어도 코드가 아니다.
         2026-07-30: esc() 의 /[&<>"]/g 가 여기서 안 걸려 덮개가 통째로 어긋났었다. */
      if (c === '/' && REGEX_AFTER.indexOf(prev) >= 0) {
        blank(i); i++;
        let inClass = false;
        while (i < src.length) {
          const d = src[i];
          if (d === BS) { blank(i); i++; if (i < src.length) { blank(i); i++; } continue; }
          if (d === '[') inClass = true;
          else if (d === ']') inClass = false;
          else if (d === '/' && !inClass) { blank(i); i++; break; }
          else if (d === NLC) break;                 /* 한 줄을 넘으면 정규식이 아니었다 */
          blank(i); i++;
        }
        while (i < src.length && /[a-z]/.test(src[i])) { blank(i); i++; }   /* g, i, m … */
        prev = '/';
        continue;
      }
      if (c === '"' || c === "'" || c === BT) {
        const q = c; blank(i); i++;
        while (i < src.length && src[i] !== q) {
          if (src[i] === BS) { blank(i); i++; if (i < src.length) { blank(i); i++; } continue; }
          blank(i); i++;
        }
        if (i < src.length) { blank(i); i++; }
        prev = q;
        continue;
      }
      if (c.trim()) prev = c;
      i++;
    }
    return out.join('');
  }
  const mask = maskLiterals(vsrc);

  /* RANK_UNKNOWN 은 함수 밖의 상수다 — 값을 여기 베껴 적으면 원본이 바뀔 때 어긋난다.
     원문에서 그 줄을 그대로 가져온다. */
  const rankConst = (vsrc.match(/var[ ]+RANK_UNKNOWN[ ]*=[^;]+;/) || [])[0];
  if (!rankConst) { fail++; console.log('X view.html 에서 RANK_UNKNOWN 을 찾지 못함'); return; }

  const names = ['parseHint', 'decadeOf', 'monthOf',
                 'bucketKey', 'bucketLabel', 'bucketRank', 'groupByPeriod',
                 'cardWhen', 'needEras'];
  let body = rankConst + String.fromCharCode(10);
  for (const n of names) {
    const s0 = vsrc.indexOf('function ' + n + '(');
    if (s0 < 0) { fail++; console.log('X view.html 에서 ' + n + ' 를 찾지 못함'); return; }
    let d = 0, i = mask.indexOf('{', s0);              /* 덮은 사본에서 센다 */
    for (; i < mask.length; i++) {
      if (mask[i] === '{') d++;
      else if (mask[i] === '}') { d--; if (d === 0) { i++; break; } }
    }
    const piece = vsrc.slice(s0, i);                   /* 자르는 건 원문에서 */
    try { new Function(piece); }                       /* 어느 함수가 깨졌는지 이름을 남긴다 */
    catch (e) { fail++; console.log('X ' + n + ' 를 떼어내지 못함 — ' + e.message); return; }
    body += piece + ';' + String.fromCharCode(10);
  }
  let F;
  try { F = new Function(body + 'return {' + names.join(',') + '};')(); }
  catch (e) { fail++; console.log('X 떼어낸 함수들을 못 돌림 — ' + e.message); return; }

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

  /* ── 망가진 값이 화면과 정렬을 오염시키지 않는다 (2026-07-30 추가) ──
   * 테스트 마스터가 실제 값으로 재현했던 것들이다:
   *   {type:'decade'} (value 없음) 한 건이 섞이면
   *     · 칸 제목이 「undefined년대」로 뜨고
   *     · 정렬값이 NaN 이 되어 연대기 전체 순서가 무너졌다
   *
   * 지금은 bucketKey 가 뿌리에서 「모름」으로 보낸다.
   * 잡는 것: 「모르는 것을 아는 척하지 않는가」 */
  const BROKEN = [
    ['value 없는 연대',     { occurred_hint: { type: 'decade' } }],
    ['value 가 null',       { occurred_hint: { type: 'decade', value: null } }],
    ['숫자가 아닌 연대',    { occurred_hint: { type: 'decade', value: '19x0' } }],
    ['공백만 든 연대',      { occurred_hint: { type: 'decade', value: '  ' } }],
    ['말이 안 되는 연대',   { occurred_hint: { type: 'decade', value: '3500' } }],
    ['날짜가 잘림',         { occurred_at: '2026' }],
    ['없는 달',             { occurred_at: '2026-13-01' }],
    ['날짜가 글자',         { occurred_at: 'garbage' }],
    ['깨진 JSON 부스러기',  { occurred_hint: '{"type":"decade","value":"1970"' }],
    ['빈 문자열 힌트',      { occurred_hint: '' }]
  ];
  BROKEN.forEach(function (pair) {
    const label = pair[0], rec = pair[1];
    const k = F.bucketKey(rec);
    const text = F.bucketLabel(k);
    const rank = F.bucketRank(k);
    ok(isFinite(rank), '망가진 값 · ' + label + ' → 정렬값이 숫자다 (받음: ' + rank + ')');
    ok(!/undefined|null|NaN/.test(text),
       '망가진 값 · ' + label + ' → 화면에 부스러기가 안 뜬다 (받음: "' + text + '")');
  });

  /* 🔑 핵심 한 줄 — 망가진 1건이 나머지 순서를 건드리면 안 된다.
     이게 없으면 위 시험들이 전부 통과해도 정렬은 여전히 무너질 수 있다. */
  {
    const good = [
      { id: 'a', occurred_at: '2026-07-30' },
      { id: 'b', occurred_at: '2020-01-15' },
      { id: 'c', occurred_hint: { type: 'decade', value: '1970' } }
    ];
    const withBroken = good.concat([{ id: 'x', occurred_hint: { type: 'decade' } }]);
    const seq = g => F.groupByPeriod(g).map(x => x.label)
                      .filter(l => l !== '시기를 알 수 없는 것').join(' > ');
    ok(seq(withBroken) === seq(good),
       '망가진 값 · 1건이 섞여도 나머지 순서가 그대로다');
  }

  /* 「옛 맨 글자」는 살려야 한다 — 부스러기와 구분되는가 */
  ok(F.bucketLabel(F.bucketKey({ occurred_hint: '환갑 무렵' })) === '환갑 무렵',
     '망가진 값 · 옛 맨 글자 힌트는 사건 이름으로 살아남는다');

  /* 🔑 뿌리 검사가 실제로 무엇을 막는가 — 이 한 줄이 그 답이다.
   *
   * bucketKey 가 망가진 값을 「모름」으로 안 보내면
   *   {type:'decade'}          → 'Dundefined'
   *   {type:'decade', value:''} → 'D'
   *   {type:'unknown'}          → 'U'
   * 셋이 **다른 칸**이 되는데 이름은 셋 다 「시기를 알 수 없는 것」이다.
   * → 화면에 같은 제목이 세 번 나온다. (실제로 재현해서 확인함)
   *
   * 바깥 겹(bucketLabel·bucketRank)의 방어만으로는 이걸 못 막는다.
   * 그래서 이 시험이 필요하다. */
  {
    const messy = [
      { id: 'a', occurred_at: '2026-07-30' },
      { id: 'x', occurred_hint: { type: 'decade' } },
      { id: 'y', occurred_hint: { type: 'decade', value: '' } },
      { id: 'z', occurred_hint: { type: 'unknown' } }
    ];
    const labels = F.groupByPeriod(messy).map(g => g.label);
    const dup = labels.filter((l, i) => labels.indexOf(l) !== i);
    ok(dup.length === 0,
       '망가진 값 · 같은 이름의 시기 칸이 여러 개 생기지 않는다 (받음: ' + labels.join(' | ') + ')');
  }

  /* ── 시기 제목을 붙일까 (2026-07-30 추가) ──────────────────
   * 🔴 이 시험이 없어서 결함이 하루 동안 살아 있었다.
   *
   * 원래 규칙은 「시기가 하나뿐이면 제목을 안 붙인다」였다.
   * 이유는 「모두 3점」 밑에 「2026년 7월 · 3점」이면 같은 말이 두 번이라서.
   * **그런데 그 이유는 카드에 날짜가 뜰 때만 성립한다.**
   * 옛 사진만 있으면 카드 날짜도 빈칸이라 **골라둔 시기가 화면에서 사라졌다.**
   *
   * 잡는 것: 「직원이 고른 시기를 가족이 볼 수 있는가」 */
  const anyEra = recs => {
    const g = F.groupByPeriod(recs);
    /* 제목이 뜨거나, 카드에 날짜가 뜨거나 — 둘 중 하나는 있어야 한다 */
    return F.needEras(g) || recs.some(r => F.cardWhen(r));
  };

  ok(anyEra([1, 2, 3].map(i => ({ id: 'a' + i, occurred_hint: { type: 'decade', value: '1970' } }))),
     '시기 제목 · 1970년대만 있어도 시기가 보인다');
  ok(anyEra([1, 2].map(i => ({ id: 'u' + i, occurred_hint: { type: 'unknown' } }))),
     '시기 제목 · 「모름」만 있어도 시기가 보인다');
  ok(anyEra([1, 2].map(i => ({ id: 'e' + i, occurred_hint: { type: 'event', value: '환갑 무렵' } }))),
     '시기 제목 · 「환갑 무렵」만 있어도 시기가 보인다');
  ok(anyEra([{ id: 'c1', occurred_at: '2026-07-30' }]),
     '시기 제목 · 오늘 것만 있어도 카드 날짜로 보인다');

  /* 🔑 반대쪽도 지킨다 — 날짜가 카드에 뜨면 제목은 붙이지 않는다.
     이게 없으면 「전부 붙이자」로 되돌려도 위 4건이 통과해버린다. */
  ok(F.needEras(F.groupByPeriod(
       [1, 2, 3].map(i => ({ id: 'c' + i, occurred_at: '2026-07-30' })))) === false,
     '시기 제목 · 오늘 것만일 때는 제목을 안 붙인다 (같은 말 두 번 방지)');
})();

console.log('');
console.log(fail === 0 ? `✅ 통과 ${pass}건` : `❌ 실패 ${fail}건 / 통과 ${pass}건`);
process.exit(fail === 0 ? 0 : 1);
