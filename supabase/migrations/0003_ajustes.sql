-- Ajustes que se cambian desde el panel sin redesplegar (p. ej. activar/desactivar llamadas reales).
create table if not exists public.app_settings (
  key         text primary key,
  value       jsonb not null,
  updated_at  timestamptz not null default now()
);

alter table public.app_settings enable row level security;

insert into public.app_settings (key, value) values ('live_calls', 'true'::jsonb)
on conflict (key) do nothing;

notify pgrst, 'reload schema';
