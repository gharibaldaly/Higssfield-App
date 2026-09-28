-- Product sheets built from the owner's photos store their rendered board here.
-- Sheets an image model drew keep using generation_id; this column stays null for them.
alter table public.product_sheets add column image_path text;

comment on column public.product_sheets.image_path is
  'Storage path of the board built from the owner''s photos (layout version 2); null for sheets an image model drew.';
