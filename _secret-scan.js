#!/usr/bin/env node
/* ============================================================
 * _secret-scan.js — 비밀·개인정보가 커밋에 섞이는 것을 막는 문지기
 *
 * 왜 있나
 *   이 저장소(geurium-story)는 Public 이다. 한 번 새면 전 세계가 보고,
 *   지워도 커밋 이력에 남는다. 사람이 매번 눈으로 볼 수 없으니 기계가 막는다.
 *
 * 무엇을 잡나 (넣으면 안 되는 것 — CLAUDE.md 7항)
 *   - sb_secret_… / service_role JWT   (모든 권한을 뚫는 비밀 키)
 *   - 데이터베이스 비밀번호로 보이는 것
 *   - 실제 개인 이메일 (@gmail 등) · 전화번호
 *
 * 무엇은 통과시키나 (공개돼도 되는 것)
 *   - sb_publishable_… / anon 키    (브라우저에 들어가는 공개값)
 *   - @example.com 더미
 *
 * 쓰는 법
 *   node _secret-scan.js            → git 이 스테이징한 것만 검사 (커밋 훅용)
 *   node _secret-scan.js --all      → 추적 중인 모든 파일 검사
 * ============================================================ */

'use strict';
const { execSync } = require('child_process');
const fs = require('fs');

/* ── 잡을 것 ─────────────────────────────────────── */
const RULES = [
  { name: 'Supabase secret 키', re: /sb_secret_[A-Za-z0-9_-]{10,}/ },
  /* service_role 「키」는 항상 eyJ… JWT 형태라 아래 JWT 규칙이 잡는다.
     'service_role' 단어 자체는 우리 주석·문서·규칙에도 정당히 쓰여 안 잡는다. */
  { name: 'JWT(eyJ… 3토막)',    re: /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/ },
  { name: 'DB 비밀번호로 보임',  re: /(?:password|passwd|pwd)\s*[:=]\s*['"][^'"\s]{6,}['"]/i },
  { name: '실제 개인 이메일',    re: /[A-Za-z0-9._%+-]+@(?:gmail|naver|daum|hanmail|kakao|nate|hotmail|outlook|yahoo)\.(?:com|net|co\.kr)/i },
  { name: '전화번호(010)',       re: /\b01[016-9][-. ]?\d{3,4}[-. ]?\d{4}\b/ },
];

/* ── 무시(공개 안전값·자기 자신) ─────────────────── */
const ALLOW = [
  /sb_publishable_/,          // 공개용 키 (안전)
  /@example\.com/,            // 더미
  /users\.noreply\.github/,   // git noreply 주소
];

/* 이 스캐너 파일 자체는 패턴을 예시로 담으므로 건너뛴다 */
const SKIP_FILES = [/_secret-scan\.js$/];

/* 바이너리·이미지 등은 안 본다 */
const SKIP_EXT = /\.(png|jpe?g|gif|webp|ico|pdf|zip|woff2?|ttf|otf|mp4|mov)$/i;

function stagedFiles() {
  try {
    return execSync('git diff --cached --name-only --diff-filter=ACM', { encoding: 'utf8' })
      .split('\n').map(s => s.trim()).filter(Boolean);
  } catch (e) { return []; }
}
function trackedFiles() {
  try {
    return execSync('git ls-files', { encoding: 'utf8' })
      .split('\n').map(s => s.trim()).filter(Boolean);
  } catch (e) { return []; }
}

function scan(files) {
  const hits = [];
  files.forEach(f => {
    if (SKIP_FILES.some(re => re.test(f))) return;
    if (SKIP_EXT.test(f)) return;
    let text;
    try { text = fs.readFileSync(f, 'utf8'); } catch (e) { return; }
    const lines = text.split('\n');
    lines.forEach((line, i) => {
      if (ALLOW.some(re => re.test(line))) return;
      RULES.forEach(rule => {
        const m = rule.re.exec(line);
        if (m) {
          const shown = m[0].length > 40 ? m[0].slice(0, 24) + '…' : m[0];
          hits.push({ file: f, line: i + 1, rule: rule.name, hit: shown });
        }
      });
    });
  });
  return hits;
}

const all = process.argv.includes('--all');
const files = all ? trackedFiles() : stagedFiles();
if (!files.length) {
  console.log('· 검사할 파일이 없습니다' + (all ? '' : ' (스테이징된 변경 없음)'));
  process.exit(0);
}

const hits = scan(files);
if (!hits.length) {
  console.log('✅ 비밀·개인정보 없음 (' + files.length + '개 파일 검사)');
  process.exit(0);
}

console.error('\n🚨 커밋을 멈춥니다 — 넣으면 안 되는 것이 있습니다:\n');
hits.forEach(h => {
  console.error('  ✗ ' + h.file + ':' + h.line + '  [' + h.rule + ']  ' + h.hit);
});
console.error('\n이 저장소는 Public 입니다. 지워도 커밋 이력에 남습니다.');
console.error('공개돼도 되는 값(sb_publishable_ / @example.com)이면 이 스캐너의 ALLOW 에 추가하세요.\n');
process.exit(1);
