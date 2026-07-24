-- 그리움 A2 · 가족 열람 권한 시험 (기록용)
--
-- 실제 검증은 anon 키로 밖에서 찔러 했다 (curl). RLS·정책은
-- SQL Editor(주인 권한)에서 돌리면 우회되므로, 진짜 anon 으로 봐야 한다.
--
-- 2026-07-24 검증 결과 (anon 키로):
--   ① 맞는 토큰 → get_shared → 그 어르신 기록만               ✅
--   ② 틀린 토큰 → null                                        ✅
--   ③ anon 이 records·elders 표 직접 조회 → permission denied  ✅
--   ④ 공유 활성 어르신 사진 → anon 다운로드 200                ✅
--   ⑤ 폐기(share_token=null) 후 → 토큰·사진 둘 다 막힘          ✅
--
-- 발견한 것: storage 정책이 records/elders 를 직접 읽으면 anon 표 권한이
--   없어 실패한다. is_shared_object() (security definer)로 감싸 해결.
--   my_center_id() 와 같은 이유 — 정책 안에서 표를 읽으려면 함수로 감싼다.

-- 시험용 토큰 발급 (직접 update — SQL Editor 는 로그인 세션이 없어 함수는 못 쓴다)
--   update public.elders set share_token = encode(gen_random_bytes(24),'hex')
--    where name = '김순자';
-- 폐기:
--   update public.elders set share_token = null where name = '김순자';

-- anon 이 밖에서 확인하는 법 (참고):
--   curl -X POST .../rest/v1/rpc/get_shared -d '{"p_token":"..."}'
--   curl .../storage/v1/object/artworks/{center}/{record}.jpg

select '이 파일은 기록용이다. 실제 검증은 anon 키 curl 로 했다.' as note;
