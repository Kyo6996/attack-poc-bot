-- Ficha encontrada en la web (persona + empresa) y candidatos de LinkedIn para revisión manual.
alter table public.contacts add column if not exists profile jsonb;
alter table public.contacts add column if not exists linkedin_candidates jsonb;

-- Nuevo estado: needs_review (la IA no está segura y pide confirmación humana)
alter table public.contacts drop constraint if exists contacts_status_check;
alter table public.contacts add constraint contacts_status_check check (status in (
  'pending', 'linkedin_found', 'needs_review', 'enriching', 'phone_found', 'calling',
  'meeting_scheduled', 'declined', 'no_answer', 'call_failed', 'skipped'
));

notify pgrst, 'reload schema';
