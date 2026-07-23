-- 그리움 A1-2 · 표 만들기 (1/2)
-- SQL Editor 에 붙여넣고 Run. 여러 번 실행해도 안전하다.
-- DB 는 snake_case, 앱은 camelCase. 번역은 store.js 한 곳에서만 한다.

create table if not exists public.centers (
  id         uuid primary key default gen_random_uuid(),
  name       text not null check (length(btrim(name)) between 1 and 60),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- active: 퇴사자를 지우지 않고 내린다. 지우면 「누가 올렸는지」가 사라진다 (R-13)
create table if not exists public.profiles (
  id         uuid primary key references auth.users(id) on delete cascade,
  center_id  uuid references public.centers(id) on delete set null,
  name       text,
  role       text not null default 'staff' check (role in ('staff','manager')),
  active     boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- birth_year: 연대기(3단계)의 축. 지금은 안 쓰고 자리만 비워 둔다
create table if not exists public.elders (
  id         uuid primary key default gen_random_uuid(),
  center_id  uuid not null references public.centers(id) on delete cascade,
  name       text not null check (length(btrim(name)) between 1 and 40),
  birth_year int check (birth_year between 1900 and 2100),
  note       text,
  active     boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- center_id 를 여기에도 둔다: 권한 검사가 매 줄마다 도는데 표를 넘나들면 느리다
-- occurred_at(있었던 날) 과 created_at(올린 날) 은 다르다
-- 사진은 표에 담지 않는다. Storage 에 두고 경로만 적는다
-- deleted_at: 지우지 않고 표시만 한다. 30일 뒤 완전 삭제
create table if not exists public.records (
  id            uuid primary key default gen_random_uuid(),
  center_id     uuid not null references public.centers(id) on delete cascade,
  elder_id      uuid not null references public.elders(id) on delete cascade,
  kind          text not null default 'artwork'
                  check (kind in ('artwork','photo','old_photo','voice')),
  occurred_at   date not null default current_date,
  occurred_hint text,
  activity      text,
  note          text,
  redacted      boolean not null default false,
  redact_top    numeric(4,3) not null default 0 check (redact_top between 0 and 0.6),
  redact_bottom numeric(4,3) not null default 0 check (redact_bottom between 0 and 0.6),
  constraint records_crop_keeps_20pct check (redact_top + redact_bottom <= 0.8),
  width         int,
  height        int,
  byte_size     int,
  image_path    text,
  thumb_path    text,
  created_by    uuid references public.profiles(id) on delete set null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  deleted_at    timestamptz
);

select '1/2 완료 — 표 4개' as 결과;
