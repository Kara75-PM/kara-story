-- ============================================================
-- 그리움 · A1-2 — 표 만들기
--
-- 쓰는 법
--   Supabase 대시보드 → 좌측 [SQL Editor] → New query → 전부 붙여넣고 Run
--
-- 여러 번 실행해도 안전하다 (있으면 건너뛴다).
--
-- ⚠️ 이 파일을 실행한 뒤에는 아무 데이터도 읽히지 않는다. 정상이다.
--    잠금(RLS)만 걸고 열쇠(정책)는 02번 파일에서 만든다.
--    「기본 잠김」으로 태어나게 해서, 실수하면 「다 보임」이 아니라
--    「안 보임」으로 끝나게 한다.
--
-- 이름 규칙
--   DB 는 snake_case, 앱(model.js)은 camelCase 를 쓴다.
--   그 사이 번역은 store.js 한 곳에서만 한다.
--   예)  occurred_at  <->  occurredAt
-- ============================================================


-- ── 0. 공통 도구 ────────────────────────────────────────────

-- 고칠 때마다 updated_at 을 자동으로 찍는다
create or replace function public.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;


-- ── 1. 센터 ────────────────────────────────────────────────
-- 모든 권한의 기준점. 「같은 센터인가」로 접근을 가른다.

create table if not exists public.centers (
  id          uuid primary key default gen_random_uuid(),
  name        text not null check (length(btrim(name)) between 1 and 60),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);


-- ── 2. 직원 ────────────────────────────────────────────────
-- Supabase 로그인 계정(auth.users)과 1:1.
-- 계정은 Supabase 가 관리하고, 「어느 센터 소속인지」를 여기서 관리한다.

create table if not exists public.profiles (
  id          uuid primary key references auth.users(id) on delete cascade,
  center_id   uuid references public.centers(id) on delete set null,
  name        text,
  role        text not null default 'staff' check (role in ('staff', 'manager')),

  -- 🔑 R-13 퇴사자 계정 회수.
  --    계정을 지우지 않고 false 로 내린다. 지우면 「누가 올렸는지」가 사라진다.
  active      boolean not null default true,

  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);


-- ── 3. 어르신 ──────────────────────────────────────────────

create table if not exists public.elders (
  id          uuid primary key default gen_random_uuid(),
  center_id   uuid not null references public.centers(id) on delete cascade,
  name        text not null check (length(btrim(name)) between 1 and 40),

  -- 🔑 연대기(3단계)의 축. 지금은 안 쓰지만 자리를 비워 둔다.
  birth_year  int check (birth_year between 1900 and 2100),

  note        text,
  active      boolean not null default true,   -- 퇴소하면 false
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);


-- ── 4. 기록 ────────────────────────────────────────────────

create table if not exists public.records (
  id            uuid primary key default gen_random_uuid(),

  -- center_id 는 elders 를 타고 가면 알 수 있지만 일부러 여기에도 둔다.
  -- 권한 검사(RLS)가 매 줄마다 도는데, 표를 타고 넘어가면 느려진다.
  center_id     uuid not null references public.centers(id) on delete cascade,
  elder_id      uuid not null references public.elders(id)  on delete cascade,

  kind          text not null default 'artwork'
                  check (kind in ('artwork', 'photo', 'old_photo', 'voice')),

  -- 🔑 「있었던 날」. 만든 날(created_at)과 다르다.
  occurred_at   date not null default current_date,
  occurred_hint text,          -- "1970년대쯤" — 옛 사진용

  activity      text,          -- 미술치료 · 종이접기 …
  note          text,          -- 한 줄 메모 (B안의 다리)

  -- 이름칸 자르기
  redacted      boolean not null default false,
  redact_top    numeric(4,3) not null default 0 check (redact_top    between 0 and 0.6),
  redact_bottom numeric(4,3) not null default 0 check (redact_bottom between 0 and 0.6),
  constraint records_crop_keeps_20pct check (redact_top + redact_bottom <= 0.8),

  width         int,
  height        int,
  byte_size     int,

  -- 사진은 여기 담지 않는다. Storage 에 두고 경로만 적는다.
  image_path    text,
  thumb_path    text,

  created_by    uuid references public.profiles(id) on delete set null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),

  -- 🔑 지우기 3층 구조. 지우지 않고 표시만 한다.
  --    30일 뒤에 진짜 지운다 (Store.purgeExpired).
  deleted_at    timestamptz
);


-- ── 5. 빨리 찾기 ───────────────────────────────────────────

-- 오늘 목록 (지운 것 빼고)
create index if not exists records_center_date_idx
  on public.records (center_id, occurred_at desc)
  where deleted_at is null;

-- 어르신별 기록 (가족 열람 · A2)
create index if not exists records_elder_date_idx
  on public.records (elder_id, occurred_at desc)
  where deleted_at is null;

-- 지운 것 목록
create index if not exists records_trash_idx
  on public.records (center_id, deleted_at)
  where deleted_at is not null;

create index if not exists elders_center_idx
  on public.elders (center_id) where active;

create index if not exists profiles_center_idx
  on public.profiles (center_id) where active;


-- ── 6. updated_at 자동 갱신 붙이기 ─────────────────────────

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


-- ── 7. 가입하면 직원 칸이 저절로 생기게 ────────────────────
-- 계정만 만들어지고 profiles 가 비어 있으면 아무 데도 못 들어간다.

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, name)
  values (new.id, nullif(btrim(coalesce(new.raw_user_meta_data ->> 'name', '')), ''))
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();


-- ── 8. 잠금(RLS) 켜기 ──────────────────────────────────────
-- 프로젝트 설정에서 자동 RLS 를 켜 뒀지만, 여기에도 분명히 적는다.
-- 이 파일만 봐도 「잠겨 있다」를 알 수 있어야 한다.

alter table public.centers  enable row level security;
alter table public.profiles enable row level security;
alter table public.elders   enable row level security;
alter table public.records  enable row level security;


-- ── 9. 문 열어주기 (권한) ──────────────────────────────────
-- 프로젝트를 만들 때 「새 표를 자동으로 노출」을 껐으므로,
-- 쓸 표만 손으로 열어준다.
--
-- ⚠️ anon(로그인 안 한 사람)에게는 아무것도 주지 않는다.
--    로그인 안 하면 앱은 「체험 모드」로 기기 안에만 저장한다.

grant usage on schema public to authenticated;

grant select                         on public.centers  to authenticated;
grant select, update                 on public.profiles to authenticated;
grant select, insert, update, delete on public.elders   to authenticated;
grant select, insert, update, delete on public.records  to authenticated;


-- ── 10. 확인 ───────────────────────────────────────────────
-- 아래 결과가 나오면 성공이다.

select
  c.relname                                as "표",
  c.relrowsecurity                         as "잠금 켜짐",
  (select count(*) from pg_policies p
     where p.schemaname = 'public' and p.tablename = c.relname) as "열쇠(정책) 수"
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public'
  and c.relkind = 'r'
  and c.relname in ('centers', 'profiles', 'elders', 'records')
order by 1;
