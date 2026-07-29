/* 자르기 계산 검증 — 브라우저 없이 돌린다.
   화면을 열지 않고도 "값이 맞는지"를 확인하는 안전망. */
global.window = global;
global.crypto = { randomUUID: () => 'test-' + Math.random().toString(16).slice(2) };
require('./js/model.js');

let pass = 0, fail = 0;
function eq(got, want, label) {
  const ok = Math.abs(got - want) < 1e-9;
  if (ok) { pass++; }
  else { fail++; console.log(`✗ ${label}: ${got} (기대 ${want})`); }
}
function t(label, fn) { try { fn(); } catch (e) { fail++; console.log('✗ ' + label + ' — ' + e.message); } }

const C = Model.clampCrop;

t('기본값 통과', () => {
  const r = C(0, 0.15);
  eq(r.top, 0, '기본 위'); eq(r.bottom, 0.15, '기본 아래');
});

t('음수는 0으로', () => {
  const r = C(-0.5, -1);
  eq(r.top, 0, '음수 위'); eq(r.bottom, 0, '음수 아래');
});

t('한쪽 최대 60% 제한', () => {
  const r = C(0.9, 0);
  eq(r.top, 0.6, '위 상한');
});

t('40% 제한이 풀렸는지 (50% 허용)', () => {
  const r = C(0, 0.5);
  eq(r.bottom, 0.5, '아래 50%');
});

t('합계가 80%를 넘으면 반대쪽을 줄인다 (위를 끄는 중)', () => {
  const r = C(0.6, 0.6, 'top');
  eq(r.top, 0.6, '움직이는 쪽 유지');
  eq(r.bottom, 0.2, '반대쪽 축소');
  eq(1 - r.top - r.bottom, 0.2, '남는 부분 20%');
});

t('합계가 80%를 넘으면 반대쪽을 줄인다 (아래를 끄는 중)', () => {
  const r = C(0.5, 0.6, 'bottom');
  eq(r.bottom, 0.6, '움직이는 쪽 유지');
  eq(r.top, 0.2, '반대쪽 축소');
});

t('어느 쪽도 안 움직일 때는 반씩 줄인다', () => {
  const r = C(0.5, 0.5, null);
  eq(r.top, 0.4, '위 절반 축소');
  eq(r.bottom, 0.4, '아래 절반 축소');
});

t('남는 부분은 항상 20% 이상', () => {
  for (let a = 0; a <= 0.6; a += 0.05) {
    for (let b = 0; b <= 0.6; b += 0.05) {
      const r = C(a, b, 'top');
      const keep = 1 - r.top - r.bottom;
      if (keep < 0.2 - 1e-9) { fail++; console.log(`✗ 남는 부분 ${keep} (${a},${b})`); return; }
    }
  }
  pass++;
});

t('옛 데이터(redactRatio)는 아래로 읽힌다', () => {
  const rec = Model.makeRecord({ elderId: 'x', redactRatio: 0.15 });
  eq(rec.redactTop, 0, '옛 위');
  eq(rec.redactBottom, 0.15, '옛 아래');
});

t('새 데이터는 위·아래 따로', () => {
  const rec = Model.makeRecord({ elderId: 'x', redactTop: 0.1, redactBottom: 0.2 });
  eq(rec.redactTop, 0.1, '새 위');
  eq(rec.redactBottom, 0.2, '새 아래');
});

t('occurredAt 과 createdAt 은 다른 값이다', () => {
  const rec = Model.makeRecord({ elderId: 'x', occurredAt: '1975-03-01' });
  if (rec.occurredAt === rec.createdAt) { fail++; console.log('✗ 두 날짜가 같음'); }
  else if (rec.occurredAt !== '1975-03-01') { fail++; console.log('✗ occurredAt 안 지켜짐'); }
  else pass++;
});

/* ── UI.humanError — 영어 오류가 화면으로 새지 않는가 (2026-07-29 추가) ──
 * 폰 저장 공간이 차면 "The quota has been exceeded." 가 그대로 떴다.
 * 이 앱을 쓰는 사람은 센터 직원과 어르신이다. 영어를 띄우면 안 된다.
 * ui.js 는 브라우저 전용이라 통째로 require 하면 죽는다 → 함수만 떼어 시험한다. */
const _uiSrc = require('fs')
  .readFileSync(require('path').join(__dirname, 'js', 'ui.js'), 'utf8')
  .replace(/\r/g, '').split('\n');
const _hs = _uiSrc.findIndex(l => /^\s*function humanError/.test(l));
let _he = -1;
for (let i = _hs + 1; i < _uiSrc.length; i++) if (/^\s{2}\}\s*$/.test(_uiSrc[i])) { _he = i; break; }

t('humanError 를 ui.js 에서 찾을 수 있다', () => {
  if (_hs < 0 || _he < 0) throw new Error('humanError 추출 실패 — ui.js 구조가 바뀌었는지 확인');
  pass++;
});

if (_hs >= 0 && _he >= 0) {
  const human = new Function(_uiSrc.slice(_hs, _he + 1).join('\n') + '\nreturn humanError;')();
  const err = (name, msg) => Object.assign(new Error(msg), { name: name });

  [
    ['저장공간 부족',   err('QuotaExceededError', 'The quota has been exceeded.'), '저장 공간'],
    ['권한 없음',       err('NotAllowedError', 'The request is not allowed'),      '권한'],
    ['시크릿 창',       err('SecurityError', 'access denied'),                     '시크릿'],
    ['저장소 열기 실패', err('VersionError', 'db blocked'),                         '새로고침'],
    ['사진 못 읽음',    err('NotReadableError', 'could not read'),                 '사진 파일'],
    ['인터넷 끊김',     new TypeError('Failed to fetch'),                          '인터넷'],
  ].forEach(([label, e, must]) => {
    t(label + ' → 한글로 바뀐다', () => {
      const out = human(e, '저장하지 못했습니다');
      if (!out.includes(must)) throw new Error(`"${must}" 가 없음 — 실제: ${out}`);
      if (/[A-Za-z]{4,}/.test(out)) throw new Error('영어가 남아 있음: ' + out);
      pass++;
    });
  });

  t('모르는 영어 오류는 기본 문구로 떨어진다', () => {
    const out = human(new Error('Some brand new english error nobody predicted'), '저장하지 못했습니다');
    if (/[A-Za-z]{4,}/.test(out)) throw new Error('영어가 새어 나감: ' + out);
    if (out !== '저장하지 못했습니다') throw new Error('기본 문구가 아님: ' + out);
    pass++;
  });

  t('이미 한글인 메시지는 그대로 둔다', () => {
    const out = human(new Error('사진을 저장하지 못했습니다'), '기본값');
    if (out !== '사진을 저장하지 못했습니다') throw new Error('원문이 바뀜: ' + out);
    pass++;
  });

  t('오류가 null 이어도 안 죽는다', () => {
    const out = human(null, '저장하지 못했습니다');
    if (out !== '저장하지 못했습니다') throw new Error('null 처리 실패: ' + out);
    pass++;
  });
}

/* ── app.js 가 오류를 날것으로 화면에 내보내지 않는가 ────────── */
t('app.js 에 e.message 직접 노출이 남아 있지 않다', () => {
  const appSrc = require('fs').readFileSync(require('path').join(__dirname, 'js', 'app.js'), 'utf8');
  const bad = [
    /UI\.say\(\s*e\.message/, /UI\.say\(\s*err\.message/,
    /item\.error\s*=\s*\(e && e\.message\)/, /UI\.esc\(e && e\.message/,
  ].filter(re => re.test(appSrc));
  if (bad.length) throw new Error(bad.length + '곳이 날것으로 노출 — UI.humanError 로 감싸야 함');
  pass++;
});

console.log('');
console.log(fail === 0 ? `✅ 통과 ${pass}건` : `❌ 실패 ${fail}건 / 통과 ${pass}건`);
process.exit(fail === 0 ? 0 : 1);
