-- Covering indexes for foreign keys flagged by the Supabase performance
-- advisor (lint 0001_unindexed_foreign_keys). They keep owner cascades and
-- "on delete set null" checks from scanning whole tables.

create index ad_projects_preset_idx on public.ad_projects (preset_id);
create index ad_projects_sheet_idx on public.ad_projects (sheet_id);
create index colorways_owner_idx on public.colorways (owner_id);
create index garment_dna_owner_idx on public.garment_dna (owner_id);
create index generations_colorway_idx on public.generations (colorway_id);
create index generations_parent_idx on public.generations (parent_id);
create index product_pieces_owner_idx on public.product_pieces (owner_id);
create index product_sheets_dna_idx on public.product_sheets (dna_id);
create index product_sheets_generation_idx on public.product_sheets (generation_id);
create index product_sheets_owner_idx on public.product_sheets (owner_id);
create index products_approved_dna_idx on public.products (approved_dna_id);
create index products_approved_sheet_idx on public.products (approved_sheet_id);
create index reference_crops_owner_idx on public.reference_crops (owner_id);
create index render_jobs_owner_idx on public.render_jobs (owner_id);
create index shots_owner_idx on public.shots (owner_id);
create index shots_preview_generation_idx on public.shots (preview_generation_id);
create index shots_video_generation_idx on public.shots (video_generation_id);
create index source_photos_owner_idx on public.source_photos (owner_id);
