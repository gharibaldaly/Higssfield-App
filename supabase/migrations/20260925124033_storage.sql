-- Private storage bucket for every input and output of the studio.
--
-- Object paths always start with the owner's user id:
--   {owner_id}/products/{product_id}/sources/{photo_id}.jpg
--   {owner_id}/products/{product_id}/swatches/{colorway_id}.jpg
--   {owner_id}/products/{product_id}/sheets/{sheet_id}/crops/{crop_id}.png
--   {owner_id}/generations/{generation_id}.{png|jpg|mp4}
-- The policies below only allow a signed-in user to touch their own folder.
-- The app reads files through short-lived signed URLs; nothing is public.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'studio',
  'studio',
  false,
  524288000,
  array[
    'image/jpeg', 'image/png', 'image/webp',
    'video/mp4', 'video/quicktime', 'video/webm',
    'audio/mpeg', 'audio/wav', 'audio/x-wav', 'audio/mp4', 'audio/aac'
  ]
)
on conflict (id) do nothing;

create policy "studio_owner_select"
  on storage.objects for select to authenticated
  using (bucket_id = 'studio' and (storage.foldername(name))[1] = (select auth.uid())::text);

create policy "studio_owner_insert"
  on storage.objects for insert to authenticated
  with check (bucket_id = 'studio' and (storage.foldername(name))[1] = (select auth.uid())::text);

create policy "studio_owner_update"
  on storage.objects for update to authenticated
  using (bucket_id = 'studio' and (storage.foldername(name))[1] = (select auth.uid())::text)
  with check (bucket_id = 'studio' and (storage.foldername(name))[1] = (select auth.uid())::text);

create policy "studio_owner_delete"
  on storage.objects for delete to authenticated
  using (bucket_id = 'studio' and (storage.foldername(name))[1] = (select auth.uid())::text);
