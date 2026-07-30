/* 검사기 셋을 한 번에 돌린다.
 *
 * 왜 필요한가
 *   하나만 돌리고 「통과」라고 믿는 것이 이번 주에 실제로 사고가 됐다.
 *   `_test2.js` 는 통과하는데 `_check.js` 는 실패하는 상태가 있었고,
 *   그 사이에 연대기가 화면에서 사라지는 결함이 하루를 살았다.
 *
 * 규칙
 *   하나라도 실패하면 **종료코드 1**. 그래야 훅·CI 가 막아 준다.
 *   어디서 돌려도 된다 — `node app/_all.js` 도 `cd app && node _all.js` 도 같다.
 *
 * 쓰기:  node _all.js
 */
'use strict';

const { spawnSync } = require('child_process');
const path = require('path');

const HERE = __dirname;
const RUNNERS = [
  { file: '_check.js', what: '참조·경계·감시 규칙' },
  { file: '_test.js',  what: '모델·날짜·시기' },
  { file: '_test2.js', what: '이미지 계산·연대기' }
];

const line = (n) => '─'.repeat(n);
let failed = [];

console.log('');
console.log('  ' + line(56));
console.log('   그리움 — 검사기 ' + RUNNERS.length + '종');
console.log('  ' + line(56));

for (const r of RUNNERS) {
  const res = spawnSync(process.execPath, [path.join(HERE, r.file)], {
    encoding: 'utf8',
    cwd: HERE                       /* 어디서 부르든 같은 자리에서 돌린다 */
  });
  const out = ((res.stdout || '') + (res.stderr || '')).trimEnd();
  const lastLine = out.split('\n').filter(Boolean).pop() || '(출력 없음)';
  const ok = res.status === 0;
  if (!ok) failed.push(r.file);

  console.log('');
  console.log('  ' + (ok ? '✅' : '❌') + '  ' + r.file.padEnd(11) + r.what);
  console.log('      ' + lastLine.trim());

  /* 실패했을 때만 전문을 보여준다 — 통과할 땐 짧게 */
  if (!ok) {
    console.log('');
    out.split('\n').forEach(l => console.log('      │ ' + l));
  }
}

console.log('');
console.log('  ' + line(56));
if (failed.length) {
  console.log('   ❌ 실패: ' + failed.join(', '));
  console.log('  ' + line(56));
  console.log('');
  process.exit(1);
}
console.log('   ✅ 셋 다 통과');
console.log('  ' + line(56));
console.log('');
process.exit(0);
