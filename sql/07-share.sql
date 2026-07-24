-- 그리움 A2 · 가족 열람 (토큰 + 서버 함수)
-- 01~06 을 실행한 뒤에 실행한다. 여러 번 실행해도 안전하다.
--
-- 한 줄 규칙: 「토큰이 맞아야 그 어르신 것만 보인다. 폐기하면 곧바로 막힌다.」
--
-- ⚠️ drop function/policy 가 있어 경고가 뜬다 — 바로 다음 줄에서 다시 만든다.
--    표·데이터는 건드리지 않는다.

-- 어르신마다 공유 토큰 하나. null 이면 비공유. 폐기 = 새 토큰(옛 링크 무효) 또는 null.
alter table public.elders add column if not exists share_token text unique;


-- ── 직원: 토큰 발급/재발급 (내 센터 어르신만) ──────────────
create or replace function public.issue_share(p_elder uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare t text;
begin
  -- 추측 불가한 토큰. gen_random_bytes(pgcrypto)는 함수의 search_path(public)에서
  -- 안 보이므로, 어디서나 되는 gen_random_uuid 둘을 이어 붙인다 (64자 16진).
  t := replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '');
  update public.elders
     set share_token = t, updated_at = now()
   where id = p_elder and center_id = public.my_center_id() and active;  -- 내린 어르신엔 발급 안 함
  if not found then raise exception '권한이 없거나 없는 어르신입니다'; end if;
  return t;
end $$;

-- ── 직원: 폐기 ────────────────────────────────────────────
create or replace function public.revoke_share(p_elder uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.elders
     set share_token = null, updated_at = now()
   where id = p_elder and center_id = public.my_center_id();
  if not found then raise exception '권한이 없습니다'; end if;
end $$;

-- ── 가족: 토큰으로 열람 (로그인 없이) ─────────────────────
-- 문지기 함수. 토큰이 맞을 때만 그 어르신 이름 + 기록 목록을 돌려준다.
-- 표 자체는 anon 에게 잠긴 채로 둔다 — 이 함수만 통로다.
create or replace function public.get_shared(p_token text)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare e record; recs json;
begin
  if p_token is null or length(p_token) < 16 then return null; end if;

  select id, name into e
    from public.elders
   where share_token = p_token and active
   limit 1;
  if not found then return null; end if;

  select coalesce(json_agg(row_to_json(x)), '[]'::json) into recs
    from (
      select id, occurred_at, occurred_hint, activity, note,
             image_path, thumb_path, width, height
        from public.records
       where elder_id = e.id and deleted_at is null
       order by occurred_at desc, created_at desc
    ) x;

  return json_build_object(
    'elder',   json_build_object('name', e.name),
    'records', recs
  );
end $$;


-- ── 권한 ──────────────────────────────────────────────────
revoke execute on function public.issue_share(uuid)  from public;
revoke execute on function public.revoke_share(uuid)  from public;
revoke execute on function public.get_shared(text)    from public;
grant  execute on function public.issue_share(uuid)  to authenticated;   -- 직원만 발급
grant  execute on function public.revoke_share(uuid)  to authenticated;   -- 직원만 폐기
grant  execute on function public.get_shared(text)    to anon;            -- 가족은 로그인 없이


-- ── 사진: 공유 활성 어르신 것이면 anon 도 읽는다 ──────────
-- 경로(record_id UUID)는 유효 토큰으로만 얻는다. 폐기(share_token=null)하면 막힌다.
--
-- ⚠️ 정책이 records/elders 를 「직접」 읽으면 anon 에게 그 표 권한이 없어
--    정책 평가가 permission denied 로 실패한다. my_center_id() 와 같은 이유로
--    security definer 함수로 감싼다 — 함수는 주인 권한으로 표를 읽는다.
create or replace function public.is_shared_object(p_name text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
      from public.records r
      join public.elders  e on e.id = r.elder_id
     where (p_name = r.image_path or p_name = r.thumb_path)
       and e.share_token is not null
       and e.active                 -- 내린(active=false) 어르신 사진은 즉시 막힌다 (R-13 정신)
       and r.deleted_at is null
  );
$$;
revoke execute on function public.is_shared_object(text) from public;
grant  execute on function public.is_shared_object(text) to anon;

grant usage  on schema storage to anon;
grant select on storage.objects to anon;

drop policy if exists artworks_shared_read on storage.objects;
create policy artworks_shared_read on storage.objects for select to anon
  using (bucket_id = 'artworks' and public.is_shared_object(storage.objects.name));


-- ── 확인 ──────────────────────────────────────────────────
select 'elders.share_token 칸' as 항목,
       exists(select 1 from information_schema.columns
               where table_name='elders' and column_name='share_token') as 있음
union all
select '함수 3종(issue/revoke/get_shared)',
       (select count(*)=3 from pg_proc
         where proname in ('issue_share','revoke_share','get_shared'))
union all
select 'anon 이 get_shared 실행 가능',
       has_function_privilege('anon', 'public.get_shared(text)', 'execute')
union all
select 'storage 공유 정책',
       exists(select 1 from pg_policies
               where schemaname='storage' and policyname='artworks_shared_read');
