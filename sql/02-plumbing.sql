-- 그리움 A1-2 · 자동갱신 · 빨리찾기 · 잠금 · 권한 (2/2)
-- 01-tables.sql 을 먼저 실행한 뒤 이것을 실행한다.

-- 고칠 때마다 updated_at 을 자동으로 찍는다
create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end;
$$;

drop trigger if exists centers_touch  on public.centers;
drop trigger if exists profiles_touch on public.profiles;
drop trigger if exists elders_touch   on public.elders;
drop trigger if exists records_touch  on public.records;

create trigger centers_touch  before update on public.centers
  for each row execute function public.touch_updated_at();
create trigger profiles_touch before update on public.profiles
  for each row execute function public.touch_updated_at();
create trigger elders_touch   before update on public.elders
  for each row execute function public.touch_updated_at();
create trigger records_touch  before update on public.records
  for each row execute function public.touch_updated_at();

-- 가입하면 직원 칸이 저절로 생기게.
-- 계정만 생기고 profiles 가 비면 아무 데도 못 들어간다.
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, name)
  values (new.id, nullif(btrim(coalesce(new.raw_user_meta_data ->> 'name','')),''))
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- 빨리 찾기
create index if not exists records_center_date_idx
  on public.records (center_id, occurred_at desc) where deleted_at is null;
create index if not exists records_elder_date_idx
  on public.records (elder_id, occurred_at desc) where deleted_at is null;
create index if not exists records_trash_idx
  on public.records (center_id, deleted_at) where deleted_at is not null;
create index if not exists elders_center_idx
  on public.elders (center_id) where active;
create index if not exists profiles_center_idx
  on public.profiles (center_id) where active;

-- 잠금(RLS). 열쇠(정책)는 03 번에서 만든다.
-- 이것만 실행하면 아무것도 안 읽힌다 — 의도한 상태다.
alter table public.centers  enable row level security;
alter table public.profiles enable row level security;
alter table public.elders   enable row level security;
alter table public.records  enable row level security;

-- 문 열어주기. 「새 표 자동 노출」을 껐으므로 쓸 표만 손으로 연다.
-- anon(로그인 안 한 사람)에게는 아무것도 주지 않는다 — 체험 모드는 기기 안에만 저장한다.
grant usage on schema public to authenticated;
grant select                         on public.centers  to authenticated;
grant select, update                 on public.profiles to authenticated;
grant select, insert, update, delete on public.elders   to authenticated;
grant select, insert, update, delete on public.records  to authenticated;

-- 확인
select c.relname as "표", c.relrowsecurity as "잠금",
  (select count(*) from pg_policies p
    where p.schemaname='public' and p.tablename=c.relname) as "열쇠수"
from pg_class c join pg_namespace n on n.oid=c.relnamespace
where n.nspname='public' and c.relkind='r'
  and c.relname in ('centers','profiles','elders','records')
order by 1;
