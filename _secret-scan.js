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
 *   - 「경로」 자체가 금지인 것 — sql/ · 사진 파일        ← 2026-07-29 추가
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

/* ── 경로 자체가 금지인 것 ───────────────────────────
 * 내용 규칙(RULES)으로는 못 막는 종류가 있다.
 *   - sql/ : 비밀은 없지만 「공격자에게 주는 지도」다. 사진 경로 규칙 ·
 *            anon 이 부를 수 있는 함수 이름 · 권한 정책의 조기반환 조건.
 *            정본은 비공개 Geurium/sql/ 에 있다. (2026-07-28 결정, CLAUDE.md 7항)
 *   - 사진 : 아래 SKIP_EXT 가 「검사에서 제외」하기 때문에, 실제 어르신 사진을
 *            커밋해도 스캐너가 한 마디도 못 한다. 제외가 곧 구멍이었다.
 * 새로 허용해야 할 파일이 생기면 ALLOW_PATHS 에 정확한 경로를 적는다. */
const DENY_PATHS = [
  { re: /^sql\//i,                              why: 'DB 설계는 비공개 저장소에만 (CLAUDE.md 7항)' },
  { re: /\.(png|jpe?g|gif|webp|heic|heif|bmp|tiff?)$/i, why: '사진은 절대 커밋하지 않는다 — 어르신 개인 데이터일 수 있다' },
];
/* DENY_PATHS 에 걸리지만 예외로 허용할 정확한 경로 (예: 'app/icon.png') */
const ALLOW_PATHS = [];

/* ── 무시(공개 안전값·자기 자신) ───────────────────
 * ⚠️ 이 목록은 「찾아낸 값 자체」와만 대조한다. 줄 전체와 대조하면,
 *    한 줄에 sb_publishable_ 이 있다는 이유로 같은 줄의 sb_secret_ 이
 *    함께 통과한다. 키가 나란히 적히는 config 류에서 실제로 일어날 수 있다. */
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
    const p = f.replace(/\\/g, '/');

    /* 1) 경로 금지 — 내용을 열어보기 전에 막는다 */
    if (!ALLOW_PATHS.includes(p)) {
      const denied = DENY_PATHS.find(d => d.re.test(p));
      if (denied) {
        hits.push({ file: f, line: 0, rule: '올리면 안 되는 경로', hit: denied.why });
        return;
      }
    }

    if (SKIP_FILES.some(re => re.test(f))) return;
    if (SKIP_EXT.test(f)) return;
    let text;
    try { text = fs.readFileSync(f, 'utf8'); } catch (e) { return; }
    const lines = text.split('\n');
    lines.forEach((line, i) => {
      RULES.forEach(rule => {
        /* 한 줄에 여러 개가 있을 수 있다 — 전부 본다 */
        const re = new RegExp(rule.re.source, rule.re.flags.includes('g') ? rule.re.flags : rule.re.flags + 'g');
        let m;
        while ((m = re.exec(line)) !== null) {
          if (m[0] === '') { re.lastIndex++; continue; }
          /* 2) 허용은 「찾아낸 값」과만 대조한다 (줄 전체가 아니라) */
          if (ALLOW.some(a => a.test(m[0]))) continue;
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
