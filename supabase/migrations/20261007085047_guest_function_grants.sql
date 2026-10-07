-- Supabase grants EXECUTE on every new function in public to anon by default,
-- and "revoke ... from public" does not undo that grant, so the guest helpers
-- were callable without signing in (security advisor lint 0028). Only signed-in
-- users and the service role may call them.
revoke execute on function public.is_studio_guest(uuid) from anon;
revoke execute on function public.studio_guest_ids() from anon;
revoke execute on function public.is_studio_guest_folder(text) from anon;
revoke execute on function public.studio_role() from anon;
revoke execute on function public.studio_guest_accounts() from anon;

-- auth.uid() inside the guest policies gets its own select, so Postgres
-- evaluates it once per query (performance advisor lint 0003).
alter policy generations_owner_reads_guests on public.generations
  using (
    owner_id in (select public.studio_guest_ids())
    and (select not public.is_studio_guest((select auth.uid())))
  );

alter policy "studio_owner_reads_guest_folders" on storage.objects
  using (
    bucket_id = 'studio'
    and public.is_studio_guest_folder((storage.foldername(name))[1])
    and (select not public.is_studio_guest((select auth.uid())))
  );
