#!/bin/sh
# 그리움 — 비밀 스캐너를 git 커밋 훅으로 설치한다.
# .git/hooks 는 저장소에 안 담기므로, 새 기기·클론에서 한 번 실행한다:
#   sh _install-hooks.sh
root="$(git rev-parse --show-toplevel)"
cat > "$root/.git/hooks/pre-commit" << 'HOOK'
#!/bin/sh
# 비밀·개인정보가 커밋에 섞이는 것을 막는다 (_secret-scan.js)
node "$(git rev-parse --show-toplevel)/_secret-scan.js" || exit 1
HOOK
chmod +x "$root/.git/hooks/pre-commit"
echo "✅ pre-commit 훅 설치됨. 이제 커밋마다 비밀을 자동 검사합니다."
