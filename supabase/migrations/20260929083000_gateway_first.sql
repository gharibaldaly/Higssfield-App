-- Which gateway the director brain asks first under "Free gateways" (Settings →
-- Director brain). Nullable: null keeps the default order (Mistral, Z.ai,
-- OpenRouter, the owner's own gateway). Adding a nullable column keeps older
-- app versions working.
alter table public.settings add column gateway_first text
  check (gateway_first in ('mistral', 'zai', 'openrouter', 'custom'));

comment on column public.settings.gateway_first is
  'Gateway asked first under "Free gateways": mistral | zai | openrouter | custom; null keeps the default order.';
