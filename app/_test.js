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

console.log('');
console.log(fail === 0 ? `✅ 통과 ${pass}건` : `❌ 실패 ${fail}건 / 통과 ${pass}건`);
process.exit(fail === 0 ? 0 : 1);
