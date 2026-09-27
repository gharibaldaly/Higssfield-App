-- Higgsfield App — core schema (Phase 1)
--
-- Every table carries owner_id (defaulting to auth.uid()) and is protected by
-- row level security so a signed-in user only ever sees their own rows.
-- Status-like columns use text + CHECK constraints instead of Postgres enums
-- so new states can be added later with a simple constraint swap.

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------

create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- Products and intake
-- ---------------------------------------------------------------------------

create table public.products (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  name text not null check (char_length(name) between 1 and 200),
  product_line text not null check (product_line in ('SECRET', 'HOURS', 'VOWS')),
  piece_count smallint not null check (piece_count between 1 and 3),
  sku text check (sku is null or char_length(sku) <= 80),
  notes text check (notes is null or char_length(notes) <= 4000),
  approved_dna_id uuid,
  approved_sheet_id uuid,
  is_favorite boolean not null default false,
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.product_pieces (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  product_id uuid not null references public.products (id) on delete cascade,
  position smallint not null check (position between 1 and 3),
  name text not null check (char_length(name) between 1 and 120),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (product_id, position)
);

create table public.source_photos (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  product_id uuid not null references public.products (id) on delete cascade,
  piece_id uuid not null references public.product_pieces (id) on delete cascade,
  kind text not null check (kind in ('front', 'back', 'detail')),
  label text check (label is null or char_length(label) <= 200),
  storage_path text not null unique,
  mime_type text not null,
  width integer check (width is null or width > 0),
  height integer check (height is null or height > 0),
  size_bytes bigint check (size_bytes is null or size_bytes >= 0),
  position integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Garment DNA: versioned construction spec. Exactly one approved version per
-- product at a time; older approved versions become 'superseded'.
create table public.garment_dna (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  product_id uuid not null references public.products (id) on delete cascade,
  version integer not null check (version >= 1),
  data jsonb not null,
  status text not null default 'draft' check (status in ('draft', 'approved', 'superseded')),
  source text not null default 'llm' check (source in ('llm', 'manual')),
  llm_provider text,
  llm_model text,
  prompt_version text,
  approved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (product_id, version)
);

create unique index garment_dna_one_approved_per_product
  on public.garment_dna (product_id)
  where status = 'approved';

alter table public.products
  add constraint products_approved_dna_id_fkey
  foreign key (approved_dna_id) references public.garment_dna (id) on delete set null;

create table public.colorways (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  product_id uuid not null references public.products (id) on delete cascade,
  name text not null check (char_length(name) between 1 and 120),
  hex text not null check (hex ~ '^#[0-9A-Fa-f]{6}$'),
  source text not null check (source in ('swatch', 'eyedropper', 'manual')),
  swatch_path text,
  sample_image_path text,
  sample_point jsonb,
  position integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Product sheets and isolated reference crops
-- ---------------------------------------------------------------------------

create table public.product_sheets (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  product_id uuid not null references public.products (id) on delete cascade,
  dna_id uuid references public.garment_dna (id) on delete set null,
  version integer not null check (version >= 1),
  status text not null default 'draft'
    check (status in ('draft', 'generating', 'review', 'approved', 'failed')),
  plan jsonb,
  prompt text,
  layout jsonb not null,
  generation_id uuid,
  approved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (product_id, version)
);

alter table public.products
  add constraint products_approved_sheet_id_fkey
  foreign key (approved_sheet_id) references public.product_sheets (id) on delete set null;

create table public.reference_crops (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  product_id uuid not null references public.products (id) on delete cascade,
  sheet_id uuid not null references public.product_sheets (id) on delete cascade,
  kind text not null check (kind in ('front', 'back', 'detail', 'pieces', 'swatch', 'matching')),
  label text not null check (char_length(label) between 1 and 200),
  box jsonb not null,
  storage_path text not null,
  width integer,
  height integer,
  position integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Ghost Mannequin Studio
-- ---------------------------------------------------------------------------

create table public.catalogue_jobs (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  batch_id uuid not null default gen_random_uuid(),
  product_id uuid not null references public.products (id) on delete cascade,
  job_type text not null check (job_type in ('front_back', 'macro', 'colorways')),
  status text not null default 'queued'
    check (status in ('queued', 'preparing', 'generating', 'review', 'approved', 'failed', 'canceled')),
  model_id text not null,
  options jsonb not null default '{}'::jsonb,
  style jsonb not null,
  error text,
  started_at timestamptz,
  finished_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Ads Director
-- ---------------------------------------------------------------------------

create table public.director_presets (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  name text not null check (char_length(name) between 1 and 120),
  slug text not null check (slug ~ '^[a-z0-9-]{1,80}$'),
  description text,
  is_builtin boolean not null default false,
  controls jsonb not null,
  video_settings jsonb not null,
  rules jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (owner_id, slug)
);

create table public.ad_projects (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  product_id uuid not null references public.products (id) on delete cascade,
  sheet_id uuid references public.product_sheets (id) on delete set null,
  preset_id uuid references public.director_presets (id) on delete set null,
  name text not null check (char_length(name) between 1 and 160),
  brief text not null default '',
  controls jsonb not null,
  video_settings jsonb not null,
  rules jsonb not null default '[]'::jsonb,
  plan jsonb,
  status text not null default 'draft'
    check (status in ('draft', 'planned', 'generating', 'review', 'done')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.shots (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  ad_project_id uuid not null references public.ad_projects (id) on delete cascade,
  position integer not null,
  purpose text not null,
  detail_shown text not null,
  framing text not null,
  angle text not null,
  movement text not null,
  placement text,
  duration_s numeric(5, 2) not null check (duration_s > 0 and duration_s <= 60),
  reference_crop_ids uuid[] not null default '{}',
  prompt text not null,
  overrides jsonb not null default '{}'::jsonb,
  preview_frame_first boolean not null default false,
  preview_generation_id uuid,
  preview_approved boolean not null default false,
  video_generation_id uuid,
  status text not null default 'draft'
    check (status in ('draft', 'preview_generating', 'preview_ready', 'generating', 'ready', 'approved', 'failed')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Generations (every image / video request sent to a provider)
-- ---------------------------------------------------------------------------

create table public.generations (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  provider text not null check (provider in ('higgsfield', 'mock')),
  model_id text not null,
  endpoint text not null,
  kind text not null check (kind in ('image', 'video')),
  purpose text not null
    check (purpose in ('ghost_front', 'ghost_back', 'macro', 'colorway', 'product_sheet', 'shot_preview', 'shot_video', 'other')),
  status text not null default 'queued'
    check (status in ('queued', 'in_progress', 'completed', 'failed', 'nsfw', 'canceled')),
  prompt text not null,
  params jsonb not null default '{}'::jsonb,
  reference_paths text[] not null default '{}',
  provider_request_id text,
  provider_status_url text,
  provider_result_url text,
  storage_path text,
  mime_type text,
  width integer,
  height integer,
  duration_s numeric(6, 2),
  cost numeric(12, 4),
  cost_unit text check (cost_unit is null or cost_unit in ('usd', 'credits')),
  error text,
  note text,
  review jsonb,
  review_status text not null default 'pending'
    check (review_status in ('pending', 'approved', 'rejected')),
  is_favorite boolean not null default false,
  approved_at timestamptz,
  product_id uuid references public.products (id) on delete cascade,
  colorway_id uuid references public.colorways (id) on delete set null,
  catalogue_job_id uuid references public.catalogue_jobs (id) on delete cascade,
  slot text,
  sheet_id uuid references public.product_sheets (id) on delete cascade,
  ad_project_id uuid references public.ad_projects (id) on delete cascade,
  shot_id uuid references public.shots (id) on delete cascade,
  parent_id uuid references public.generations (id) on delete set null,
  submitted_at timestamptz,
  completed_at timestamptz,
  last_polled_at timestamptz,
  poll_attempts integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.product_sheets
  add constraint product_sheets_generation_id_fkey
  foreign key (generation_id) references public.generations (id) on delete set null;

alter table public.shots
  add constraint shots_preview_generation_id_fkey
  foreign key (preview_generation_id) references public.generations (id) on delete set null;

alter table public.shots
  add constraint shots_video_generation_id_fkey
  foreign key (video_generation_id) references public.generations (id) on delete set null;

-- ---------------------------------------------------------------------------
-- Montage render jobs (consumed by the Phase 2 ffmpeg worker)
-- ---------------------------------------------------------------------------

create table public.render_jobs (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  ad_project_id uuid not null references public.ad_projects (id) on delete cascade,
  status text not null default 'queued'
    check (status in ('queued', 'claimed', 'rendering', 'completed', 'failed', 'canceled')),
  timeline jsonb not null default '[]'::jsonb,
  music_path text,
  output_path text,
  progress numeric(5, 2) not null default 0 check (progress between 0 and 100),
  error text,
  worker_id text,
  claimed_at timestamptz,
  finished_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Settings (one row per owner)
-- ---------------------------------------------------------------------------

create table public.settings (
  owner_id uuid primary key default auth.uid() references auth.users (id) on delete cascade,
  llm_provider text not null default 'claude' check (llm_provider in ('claude', 'gemini')),
  claude_model text,
  gemini_model text,
  catalogue_style jsonb not null,
  default_image_model text,
  default_video_model text,
  custom_models jsonb not null default '[]'::jsonb,
  drive jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Indexes
-- ---------------------------------------------------------------------------

create index products_owner_idx on public.products (owner_id, created_at desc);
create index product_pieces_product_idx on public.product_pieces (product_id);
create index source_photos_product_idx on public.source_photos (product_id);
create index source_photos_piece_idx on public.source_photos (piece_id);
create index garment_dna_product_idx on public.garment_dna (product_id, version desc);
create index colorways_product_idx on public.colorways (product_id, position);
create index product_sheets_product_idx on public.product_sheets (product_id, version desc);
create index reference_crops_sheet_idx on public.reference_crops (sheet_id, position);
create index reference_crops_product_idx on public.reference_crops (product_id);
create index catalogue_jobs_owner_status_idx on public.catalogue_jobs (owner_id, status, created_at);
create index catalogue_jobs_product_idx on public.catalogue_jobs (product_id);
create index catalogue_jobs_batch_idx on public.catalogue_jobs (batch_id);
create index director_presets_owner_idx on public.director_presets (owner_id);
create index ad_projects_owner_idx on public.ad_projects (owner_id, created_at desc);
create index ad_projects_product_idx on public.ad_projects (product_id);
create index shots_project_idx on public.shots (ad_project_id, position);
create index generations_owner_created_idx on public.generations (owner_id, created_at desc);
create index generations_owner_status_idx on public.generations (owner_id, status);
create index generations_product_idx on public.generations (product_id);
create index generations_job_idx on public.generations (catalogue_job_id, slot);
create index generations_sheet_idx on public.generations (sheet_id);
create index generations_shot_idx on public.generations (shot_id);
create index generations_project_idx on public.generations (ad_project_id);
create index generations_provider_request_idx on public.generations (provider_request_id);
create index render_jobs_status_idx on public.render_jobs (status, created_at);
create index render_jobs_project_idx on public.render_jobs (ad_project_id);

-- ---------------------------------------------------------------------------
-- updated_at triggers, grants and row level security
-- ---------------------------------------------------------------------------

do $$
declare
  t text;
  owned_tables text[] := array[
    'products', 'product_pieces', 'source_photos', 'garment_dna', 'colorways',
    'product_sheets', 'reference_crops', 'catalogue_jobs', 'director_presets',
    'ad_projects', 'shots', 'generations', 'render_jobs', 'settings'
  ];
begin
  foreach t in array owned_tables loop
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
