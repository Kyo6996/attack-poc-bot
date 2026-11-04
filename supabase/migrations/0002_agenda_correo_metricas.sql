-- Comerciales, intentos de llamada, correos enviados y enlace público para agendar.

create table if not exists public.sales_reps (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  title       text,
  email       text,
  phone       text,
  area        text not null default 'general'
    check (area in ('dispositivos', 'infraestructura', 'servicios', 'IA', 'general')),
  active      boolean not null default true,
  created_at  timestamptz not null default now()
);

-- Un registro por intento: alimenta las métricas de SLA
create table if not exists public.calls (
  id                uuid primary key default gen_random_uuid(),
  contact_id        uuid not null references public.contacts(id) on delete cascade,
  provider          text not null,
  provider_call_id  text,
  status            text not null default 'in_progress'
    check (status in ('in_progress', 'answered', 'missed', 'failed')),
  ended_reason      text,
  outcome           text,
  started_at        timestamptz not null default now(),
  ended_at          timestamptz,
  duration_sec      integer
);
create index if not exists calls_started_at_idx on public.calls (started_at desc);
create index if not exists calls_provider_call_id_idx on public.calls (provider_call_id);

create table if not exists public.emails (
  id           bigserial primary key,
  contact_id   uuid references public.contacts(id) on delete cascade,
  meeting_id   uuid references public.meetings(id) on delete set null,
  kind         text not null check (kind in ('confirmacion', 'seguimiento', 'brief_comercial')),
  to_email     text not null,
  subject      text not null,
  html         text not null,
  provider     text not null,
  status       text not null check (status in ('sent', 'failed')),
  error        text,
  provider_id  text,
  created_at   timestamptz not null default now()
);
create index if not exists emails_contact_idx on public.emails (contact_id, created_at desc);

alter table public.meetings add column if not exists sales_rep_id  uuid references public.sales_reps(id) on delete set null;
alter table public.meetings add column if not exists calendar_link text;

-- Token del enlace "Agendar conversación" del correo de seguimiento
alter table public.contacts add column if not exists booking_token uuid not null default gen_random_uuid();
create unique index if not exists contacts_booking_token_idx on public.contacts (booking_token);

alter table public.sales_reps enable row level security;
alter table public.calls      enable row level security;
alter table public.emails     enable row level security;

-- Comerciales de ejemplo (editables desde la app)
insert into public.sales_reps (name, title, email, area)
select * from (values
  ('Carolina Pérez',  'Especialista en Infraestructura', null::text, 'infraestructura'),
  ('Julián Restrepo', 'Especialista en Dispositivos',    null::text, 'dispositivos'),
  ('Daniela Ortiz',   'Especialista en Servicios',       null::text, 'servicios'),
  ('Mateo Gómez',     'Especialista en IA',              null::text, 'IA'),
  ('Laura Medina',    'Ejecutiva de Cuenta',             null::text, 'general')
) v(name, title, email, area)
where not exists (select 1 from public.sales_reps);

notify pgrst, 'reload schema';
