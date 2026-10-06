-- Guests: accounts that may use only the Generate section.
--
-- The studio has one owner. A guest (first: dr@secret.com) signs in with their
-- own Supabase Auth account, sees only /generate, and keeps a history of their
-- own; the owner can read that history (and the files behind it) but no guest
-- can read anyone else's. Everyone who can sign in and is not listed here is
-- the owner, so a guest whose access is revoked keeps their row (revoked_at)
-- and never becomes the owner at the database level.
--
-- Nothing is deleted when a guest is revoked: their generations stay readable
-- by the owner. To shut the account itself, delete the user in Supabase Auth.

create table public.studio_guests (
  email text primary key check (email = lower(email) and email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  note text check (note is null or char_length(note) <= 200),
  created_at timestamptz not null default now(),
  revoked_at timestamptz
);

comment on table public.studio_guests is
  'Accounts allowed into the Generate section only. Every other sign-in is the owner.';

insert into public.studio_guests (email, note)
values ('dr@secret.com', 'Guest: Generate only')
on conflict (email) do nothing;

-- ---------------------------------------------------------------------------
-- Role helpers (security definer: they read auth.users, which the
-- authenticated role cannot see)
-- ---------------------------------------------------------------------------

/** True when the account is listed as a guest, revoked or not. */
create or replace function public.is_studio_guest(uid uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from auth.users u
    join public.studio_guests g on g.email = lower(u.email)
    where u.id = uid
  );
$$;

/** The user ids of every listed guest (revoked or not), for row policies: one lookup per query. */
create or replace function public.studio_guest_ids()
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  select u.id
  from auth.users u
  join public.studio_guests g on g.email = lower(u.email);
$$;

/** True when a storage folder name is the user id of a listed guest. */
create or replace function public.is_studio_guest_folder(folder text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  -- CASE, not AND: Postgres may evaluate AND operands in any order, and the
  -- cast must never run on a folder that is not a uuid.
  select case
    when folder ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      then public.is_studio_guest(folder::uuid)
    else false
  end;
$$;

/** The signed-in account's role: owner | guest | revoked, or null when signed out. */
create or replace function public.studio_role()
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when auth.uid() is null then null
    when exists (
      select 1
      from auth.users u
      join public.studio_guests g on g.email = lower(u.email)
      where u.id = auth.uid() and g.revoked_at is null
    ) then 'guest'
    when public.is_studio_guest(auth.uid()) then 'revoked'
    else 'owner'
  end;
$$;

/**
 * The guest list with each guest's account, for the owner's Settings page.
 * Guests get an empty answer.
 */
create or replace function public.studio_guest_accounts()
returns table (
  email text,
  note text,
  created_at timestamptz,
  revoked_at timestamptz,
  user_id uuid,
  last_sign_in_at timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  select g.email, g.note, g.created_at, g.revoked_at, u.id, u.last_sign_in_at
  from public.studio_guests g
  left join auth.users u on lower(u.email) = g.email
  where auth.uid() is not null and not public.is_studio_guest(auth.uid())
  order by g.created_at;
$$;

revoke all on function public.is_studio_guest(uuid) from public;
revoke all on function public.studio_guest_ids() from public;
revoke all on function public.is_studio_guest_folder(text) from public;
revoke all on function public.studio_role() from public;
revoke all on function public.studio_guest_accounts() from public;
grant execute on function public.is_studio_guest(uuid) to authenticated, service_role;
grant execute on function public.studio_guest_ids() to authenticated, service_role;
grant execute on function public.is_studio_guest_folder(text) to authenticated, service_role;
grant execute on function public.studio_role() to authenticated, service_role;
grant execute on function public.studio_guest_accounts() to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Row level security
-- ---------------------------------------------------------------------------

alter table public.studio_guests enable row level security;
revoke all on table public.studio_guests from anon;
grant select, insert, update, delete on table public.studio_guests to authenticated;
grant all on table public.studio_guests to service_role;

-- Only the owner (a signed-in account that is not a guest) manages the list.
create policy studio_guests_owner_select on public.studio_guests
  for select to authenticated
  using (not public.is_studio_guest((select auth.uid())));
create policy studio_guests_owner_insert on public.studio_guests
  for insert to authenticated
  with check (not public.is_studio_guest((select auth.uid())));
create policy studio_guests_owner_update on public.studio_guests
  for update to authenticated
  using (not public.is_studio_guest((select auth.uid())))
  with check (not public.is_studio_guest((select auth.uid())));
create policy studio_guests_owner_delete on public.studio_guests
  for delete to authenticated
  using (not public.is_studio_guest((select auth.uid())));

-- The owner reads every guest's generations (their history); guests keep
-- the owner-only policies, so they read nothing but their own rows. Both
-- lookups are sub-selects, so Postgres runs them once per query, not per row.
create policy generations_owner_reads_guests on public.generations
  for select to authenticated
  using (
    owner_id in (select public.studio_guest_ids())
    and (select not public.is_studio_guest(auth.uid()))
  );

-- ...and the files behind them (results and references), read only.
create policy "studio_owner_reads_guest_folders"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'studio'
    and public.is_studio_guest_folder((storage.foldername(name))[1])
    and (select not public.is_studio_guest(auth.uid()))
  );
