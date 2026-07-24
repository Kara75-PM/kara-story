-- 그리움 A1-3 · 시험용 자료 (4/5)
-- ⚠️ 전부 지어낸 이름·이메일이다. 실제 개인 정보를 넣지 않는다 (CLAUDE.md 7항).
--    이 저장소는 Public 이다. 시험을 재현하려면 대시보드에
--    아래 더미 이메일(@example.com)로 계정을 만들어 쓴다 — 개인 이메일 금지.
-- 여러 번 실행해도 안전하다.

insert into public.centers (name)
select '가나다 주간보호센터'
where not exists (select 1 from public.centers where name = '가나다 주간보호센터');

insert into public.centers (name)
select '라마바 주간보호센터'
where not exists (select 1 from public.centers where name = '라마바 주간보호센터');

-- 계정 두 개를 서로 다른 센터에 붙인다
update public.profiles p
   set center_id = c.id, name = '김직원', role = 'manager'
  from auth.users u, public.centers c
 where p.id = u.id
   and u.email = 'geurium-test-a@example.com'
   and c.name  = '가나다 주간보호센터';

update public.profiles p
   set center_id = c.id, name = '이직원', role = 'manager'
  from auth.users u, public.centers c
 where p.id = u.id
   and u.email = 'geurium-test-b@example.com'
   and c.name  = '라마바 주간보호센터';

-- 센터마다 어르신 한 분씩
insert into public.elders (center_id, name)
select c.id, '김순자' from public.centers c
 where c.name = '가나다 주간보호센터'
   and not exists (select 1 from public.elders e
                    where e.center_id = c.id and e.name = '김순자');

insert into public.elders (center_id, name)
select c.id, '박영수' from public.centers c
 where c.name = '라마바 주간보호센터'
   and not exists (select 1 from public.elders e
                    where e.center_id = c.id and e.name = '박영수');

select u.email as 계정, p.name as 직원, c.name as 센터, p.role as 역할, p.active as 재직
  from public.profiles p
  join auth.users u on u.id = p.id
  left join public.centers c on c.id = p.center_id
 order by u.email;
