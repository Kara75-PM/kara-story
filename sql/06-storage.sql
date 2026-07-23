-- 그리움 A1-4 · 사진 저장소
--
-- 경로 규칙 — 센터 번호를 맨 앞에 둔다.
--   artworks/{center_id}/{record_id}.jpg      원본 (긴 변 1600)
--   artworks/{center_id}/{record_id}_t.jpg    목록용 (긴 변 400)
--
-- 왜 센터 번호가 맨 앞인가:
--   파일에는 「어느 센터 것인지」를 적을 자리가 없다. 경로가 유일한 단서다.
--   맨 앞에 두면 권한 검사가 경로만 보고 판단할 수 있다.

-- 비공개 버킷. public=false 이므로 주소를 알아도 그냥은 못 연다.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('artworks', 'artworks', false, 5242880,
        array['image/jpeg','image/png','image/webp'])
on conflict (id) do update
  set public             = false,
      file_size_limit    = 5242880,          -- 5MB. 우리 저장본은 200~400KB
      allowed_mime_types = array['image/jpeg','image/png','image/webp'];

-- 표와 같은 규칙: 내 센터 폴더만.
-- (storage.foldername(name))[1] 이 경로의 첫 칸 = center_id 다.

drop policy if exists artworks_read   on storage.objects;
create policy artworks_read on storage.objects for select to authenticated
  using (bucket_id = 'artworks'
     and (storage.foldername(name))[1] = public.my_center_id()::text);

drop policy if exists artworks_insert on storage.objects;
create policy artworks_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'artworks'
     and (storage.foldername(name))[1] = public.my_center_id()::text);

drop policy if exists artworks_update on storage.objects;
create policy artworks_update on storage.objects for update to authenticated
  using      (bucket_id = 'artworks'
     and (storage.foldername(name))[1] = public.my_center_id()::text)
  with check (bucket_id = 'artworks'
     and (storage.foldername(name))[1] = public.my_center_id()::text);

-- 완전 삭제(30일 지난 것 정리)할 때 사진도 같이 지운다
drop policy if exists artworks_delete on storage.objects;
create policy artworks_delete on storage.objects for delete to authenticated
  using (bucket_id = 'artworks'
     and (storage.foldername(name))[1] = public.my_center_id()::text);

select b.id as 버킷,
       b.public as "누구나 열람",
       b.file_size_limit as "장당 최대(바이트)",
       (select count(*) from pg_policies
         where schemaname='storage' and tablename='objects'
           and policyname like 'artworks%') as "열쇠수"
  from storage.buckets b where b.id = 'artworks';
