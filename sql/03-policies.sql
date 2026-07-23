-- 그리움 A1-3 · 열쇠(정책) 만들기
-- 01, 02 를 실행한 뒤에 실행한다. 여러 번 실행해도 안전하다.
--
-- 한 줄 규칙:  「내 센터 것만 본다. 퇴사하면 아무것도 못 본다.」

-- 내 센터 번호를 돌려준다.
--
-- security definer 로 만드는 이유:
--   profiles 에도 정책을 걸 건데, 그 정책 안에서 profiles 를 다시 읽으면
--   무한히 돈다. 이 함수는 주인 권한으로 돌아서 그 고리를 끊는다.
--
-- active 가 false 면 null 이 나온다 → 퇴사자는 어느 표도 못 읽는다 (R-13).
-- 계정을 지우지 않아도 그날로 손이 끊긴다.
create or replace function public.my_center_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select center_id from public.profiles where id = auth.uid() and active
$$;

revoke execute on function public.my_center_id() from public;
grant  execute on function public.my_center_id() to authenticated;


-- ── profiles ───────────────────────────────────────────────
-- 자기 자신과 같은 센터 동료를 본다.
drop policy if exists profiles_read on public.profiles;
create policy profiles_read on public.profiles for select to authenticated
  using (
    id = auth.uid()
    or (center_id is not null and center_id = public.my_center_id())
  );

-- 자기 줄만 고칠 수 있다.
drop policy if exists profiles_update_self on public.profiles;
create policy profiles_update_self on public.profiles for update to authenticated
  using (id = auth.uid()) with check (id = auth.uid());

-- 🔑 고칠 수 있는 칸을 「이름」 하나로 좁힌다.
--    이게 없으면 직원이 자기 center_id·role·active 를 바꿔
--    다른 센터로 넘어가거나 스스로 관리자가 될 수 있다.
revoke update on public.profiles from authenticated;
grant  update (name) on public.profiles to authenticated;


-- ── centers ────────────────────────────────────────────────
drop policy if exists centers_read on public.centers;
create policy centers_read on public.centers for select to authenticated
  using (id = public.my_center_id());


-- ── elders ─────────────────────────────────────────────────
-- 읽기·넣기·고치기·지우기 모두 같은 규칙이라 하나로 묶는다.
drop policy if exists elders_all on public.elders;
create policy elders_all on public.elders for all to authenticated
  using      (center_id = public.my_center_id())
  with check (center_id = public.my_center_id());


-- ── records ────────────────────────────────────────────────
drop policy if exists records_read on public.records;
create policy records_read on public.records for select to authenticated
  using (center_id = public.my_center_id());

-- 넣을 때만 조건이 셋이다.
--   ① 내 센터 것으로만 넣을 수 있다
--   ② 올린 사람을 나로 적어야 한다 (남의 이름으로 못 올린다)
--   ③ 그 어르신이 내 센터 분이어야 한다
drop policy if exists records_insert on public.records;
create policy records_insert on public.records for insert to authenticated
  with check (
    center_id = public.my_center_id()
    and created_by = auth.uid()
    and exists (
      select 1 from public.elders e
      where e.id = elder_id and e.center_id = public.my_center_id()
    )
  );

drop policy if exists records_update on public.records;
create policy records_update on public.records for update to authenticated
  using      (center_id = public.my_center_id())
  with check (center_id = public.my_center_id());

-- 완전 삭제(30일 지난 것 정리)도 내 센터 것만.
drop policy if exists records_delete on public.records;
create policy records_delete on public.records for delete to authenticated
  using (center_id = public.my_center_id());


-- 확인
select tablename as "표", policyname as "열쇠", cmd as "무엇을"
from pg_policies where schemaname = 'public'
order by 1, 2;
