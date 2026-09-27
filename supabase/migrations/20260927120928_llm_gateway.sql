-- Director brain through an OpenAI-compatible gateway (third LLM provider).
-- Widening the check and adding a nullable column keep older app versions working.
alter table public.settings drop constraint settings_llm_provider_check;
alter table public.settings
  add constraint settings_llm_provider_check
  check (llm_provider in ('claude', 'gemini', 'gateway'));

alter table public.settings add column gateway_model text;

comment on column public.settings.gateway_model is
  'Model id at the OpenAI-compatible gateway (LLM_GATEWAY_BASE_URL); null uses LLM_GATEWAY_MODEL.';
