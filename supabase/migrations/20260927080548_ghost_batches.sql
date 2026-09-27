-- Ghost Mannequin Studio: batches built straight from uploaded photos.
--
-- A batch holds many garment models (styles). Each model becomes a product
-- with one piece, so the existing DNA, colourway and catalogue-job pipeline
-- runs unchanged. The batch's catalogue jobs carry its id in
-- catalogue_jobs.batch_id.

create table public.ghost_batches (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  name text not null check (char_length(name) between 1 and 160),
  status text not null default 'running' check (status in ('running', 'paused')),
  model_id text not null check (char_length(model_id) between 1 and 200),
  style jsonb not null,
  options jsonb not null default '{}'::jsonb,
  colours_requested_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.ghost_batch_items (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  batch_id uuid not null references public.ghost_batches (id) on delete cascade,
  product_id uuid not null unique references public.products (id) on delete cascade,
  position integer not null check (position >= 0),
  phase text not null default 'uploading'
    check (phase in ('uploading', 'pending', 'analyzing', 'dna_review', 'generating', 'review', 'failed')),
  error text check (error is null or char_length(error) <= 2000),
  claimed_at timestamptz,
  meta jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index ghost_batches_owner_idx on public.ghost_batches (owner_id, created_at desc);
create index ghost_batch_items_batch_idx on public.ghost_batch_items (batch_id, position);
create index ghost_batch_items_owner_idx on public.ghost_batch_items (owner_id);

do $$
declare
  t text;
begin
  foreach t in array array['ghost_batches', 'ghost_batch_items'] loop
    execute format(
      'create trigger %I before update on public.%I for each row execute function public.set_updated_at()',
      t || '_set_updated_at', t
    );

    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on table public.%I from anon', t);
    execute format('grant select, insert, update, delete on table public.%I to authenticated', t);
    execute format('grant all on table public.%I to service_role', t);

    execute format(
      'create policy %I on public.%I for select to authenticated using (owner_id = (select auth.uid()))',
      t || '_owner_select', t
    );
    execute format(
      'create policy %I on public.%I for insert to authenticated with check (owner_id = (select auth.uid()))',
      t || '_owner_insert', t
    );
    execute format(
      'create policy %I on public.%I for update to authenticated using (owner_id = (select auth.uid())) with check (owner_id = (select auth.uid()))',
      t || '_owner_update', t
    );
    execute format(
      'create policy %I on public.%I for delete to authenticated using (owner_id = (select auth.uid()))',
      t || '_owner_delete', t
    );
  end loop;
end;
$$;

-- The owner asked for white catalogue backgrounds. Settings that still hold
-- the original seeded style switch to the new white default; a style the
-- owner already customised is left alone.
update public.settings
set catalogue_style = catalogue_style || jsonb_build_object(
  'background', '#FFFFFF',
  'shadow', 'none',
  'lighting', 'soft, even, high-key studio light from the front and both sides; neutral daylight white balance; true-to-life colour; no harsh highlights'
)
where catalogue_style ->> 'background' = '#F7F3EE'
  and catalogue_style ->> 'shadow' = 'soft'
  and catalogue_style ->> 'lighting' = 'soft, even, diffused studio light from the front-left; true-to-life colour; no harsh highlights';
