-- De dónde llegó cada contacto: panel, importación o formulario por QR (con su origen, p. ej. "qr:stand").
alter table public.contacts add column if not exists source text not null default 'panel';
alter table public.contacts add column if not exists contact_preference text;  -- llamada | correo

notify pgrst, 'reload schema';
