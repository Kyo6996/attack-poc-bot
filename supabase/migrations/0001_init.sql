create extension if not exists pgcrypto;

-- Base de entrada y estado de cada contacto en el pipeline
create table if not exists public.contacts (
  id                   uuid primary key default gen_random_uuid(),
  first_name           text not null,
  last_name            text not null,
  company              text,
  title                text,
  city                 text,
  email                text,                 -- puede venir de la base o del enriquecimiento
  phone                text,                 -- E.164, se llena en el enriquecimiento
  consent              boolean not null default false,  -- base legal para contactar (Ley 1581/2012)
  event_notes          text,                 -- lo que vio o preguntó en el stand de ANDICOM (opcional)
  qualification        jsonb,                -- área de interés, proyecto, etapa, fecha meta, decisores…

  linkedin_url         text,
  linkedin_confidence  numeric(3,2),
  linkedin_source      text,                 -- sandbox | serper | serper+claude
  enrichment_source    text,                 -- sandbox | signalhire

  status               text not null default 'pending'
    check (status in (
      'pending',            -- sin procesar
      'linkedin_found',     -- perfil ubicado, falta enriquecer
      'enriching',          -- esperando callback del proveedor de enriquecimiento
      'phone_found',        -- celular encontrado, listo para llamar
      'calling',            -- llamada en curso
      'meeting_scheduled',  -- aceptó y se envió la invitación
      'declined',           -- no aceptó
      'no_answer',          -- no contestó / buzón
      'call_failed',        -- error técnico en la llamada
      'skipped'             -- se saltó (sin perfil, sin celular, sin consentimiento…)
    )),
  skip_reason          text,

  call_id              text,
  call_outcome         text,
  call_summary         text,
  call_transcript      text,
  recording_url        text,

  locked_until         timestamptz,          -- evita doble procesamiento (botón + auto)
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);

-- Para bases creadas con la primera versión del script
alter table public.contacts add column if not exists event_notes   text;
alter table public.contacts add column if not exists qualification jsonb;

create index if not exists contacts_status_idx on public.contacts (status);
create index if not exists contacts_call_id_idx on public.contacts (call_id);

-- Reemplaza a LinkedIn y SignalHire en pruebas con contactos ficticios o con consentimiento
create table if not exists public.sandbox_profiles (
  id                uuid primary key default gen_random_uuid(),
  full_name         text not null,
  company           text,
  headline          text,
  linkedin_url      text not null unique,
  mobile_phone      text,                    -- null ⇒ el "SignalHire" simulado no encuentra celular
  email             text,
  mock_call_outcome text not null default 'accept'
    check (mock_call_outcome in ('accept', 'decline', 'no_answer')),  -- solo para PROVIDER_VOICE=simulated
  created_at        timestamptz not null default now()
);

create table if not exists public.meetings (
  id                 uuid primary key default gen_random_uuid(),
  contact_id         uuid not null references public.contacts(id) on delete cascade,
  starts_at          timestamptz not null,
  ends_at            timestamptz not null,
  attendee_email     text not null,
  meet_url           text,
  calendar_event_id  text,
  calendar_provider  text not null,          -- sandbox | google
  created_at         timestamptz not null default now()
);

create index if not exists meetings_starts_at_idx on public.meetings (starts_at);

create table if not exists public.events (
  id          bigserial primary key,
  contact_id  uuid references public.contacts(id) on delete cascade,
  step        text not null,       -- linkedin | enrichment | call | calendar | system
  level       text not null default 'info' check (level in ('info', 'success', 'warn', 'error')),
  message     text not null,
  data        jsonb,
  created_at  timestamptz not null default now()
);

create index if not exists events_created_at_idx on public.events (created_at desc);

create or replace function public.touch_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

drop trigger if exists contacts_touch on public.contacts;
create trigger contacts_touch before update on public.contacts
  for each row execute function public.touch_updated_at();

-- RLS sin políticas: solo el backend (secret key) accede a los datos
alter table public.contacts         enable row level security;
alter table public.sandbox_profiles enable row level security;
alter table public.meetings         enable row level security;
alter table public.events           enable row level security;
