-- 그리움 A1-3 · 잠금이 진짜로 막는지 시험 (5/5)
--
-- 로그인하지 않고 「그 사람인 척」해서 정책만 시험한다.
-- 열쇠가 있다는 것과 잘 잠긴다는 것은 다른 이야기다.
--
-- ⚠️ 마지막에 나오는 표가 결과다. 전부 ✅ 여야 한다.

drop table if exists rls_result;
drop table if exists t_ids;

create temp table rls_result(seq int, 항목 text, 결과 text);
create temp table t_ids as select
  (select id from auth.users where email = 'war0705+a@gmail.com') as a_user,
  (select id from auth.users where email = 'war0705+b@gmail.com') as b_user,
  (select id from public.centers where name = '라마바 주간보호센터') as b_center,
  (select e.id from public.elders e join public.centers c on c.id = e.center_id
    where c.name = '라마바 주간보호센터' limit 1) as b_elder;
grant all on rls_result to authenticated;
grant all on t_ids     to authenticated;

-- ── A 인 척 ────────────────────────────────────────────────
select set_config('request.jwt.claims',
  json_build_object('sub', (select a_user from t_ids), 'role','authenticated')::text, false);
set role authenticated;

insert into rls_result select 1, 'A 가 보는 어르신 (김순자만 나와야)',
  coalesce((select string_agg(name, ', ' order by name) from public.elders), '(없음)');
insert into rls_result select 2, 'A 가 보는 센터 (가나다만 나와야)',
  coalesce((select string_agg(name, ', ' order by name) from public.centers), '(없음)');

do $$
begin
  begin
    insert into public.records (center_id, elder_id, created_by)
    values ((select b_center from t_ids), (select b_elder from t_ids), auth.uid());
    insert into rls_result values (3, 'A 가 남의 센터에 기록 넣기', '🔴 들어갔다 — 위험');
  exception when others then
    insert into rls_result values (3, 'A 가 남의 센터에 기록 넣기', '✅ 막힘');
  end;
  begin
    update public.profiles set center_id = (select b_center from t_ids) where id = auth.uid();
    insert into rls_result values (4, 'A 가 자기 소속 바꾸기', '🔴 바뀌었다 — 위험');
  exception when others then
    insert into rls_result values (4, 'A 가 자기 소속 바꾸기', '✅ 막힘');
  end;
  begin
    update public.profiles set active = true where id = (select b_user from t_ids);
    insert into rls_result values (5, 'A 가 남의 계정 건드리기',
      case when found then '🔴 바뀌었다 — 위험' else '✅ 막힘' end);
  exception when others then
    insert into rls_result values (5, 'A 가 남의 계정 건드리기', '✅ 막힘');
  end;
end $$;
reset role;

-- ── B 인 척 ────────────────────────────────────────────────
select set_config('request.jwt.claims',
  json_build_object('sub', (select b_user from t_ids), 'role','authenticated')::text, false);
set role authenticated;
insert into rls_result select 6, 'B 가 보는 어르신 (박영수만 나와야)',
  coalesce((select string_agg(name, ', ' order by name) from public.elders), '(없음)');
reset role;

-- ── 퇴사 처리하면 손이 끊기는가 (R-13) ────────────────────
update public.profiles set active = false where id = (select a_user from t_ids);
select set_config('request.jwt.claims',
  json_build_object('sub', (select a_user from t_ids), 'role','authenticated')::text, false);
set role authenticated;
insert into rls_result select 7, '퇴사 처리 뒤 A 가 보는 어르신',
  coalesce((select string_agg(name, ', ' order by name) from public.elders), '✅ 아무것도 못 봄');
reset role;
update public.profiles set active = true where id = (select a_user from t_ids);   -- 되돌리기

select seq as 번호, 항목, 결과 from rls_result order by seq;
