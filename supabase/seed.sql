-- Contactos ficticios + uno real con consentimiento. Reemplazar los valores TU_ antes de correrlo.

truncate public.events, public.meetings, public.contacts, public.sandbox_profiles restart identity cascade;

insert into public.contacts (first_name, last_name, company, title, city, email, consent, event_notes) values
  -- acepta y agenda (llamada real a tu celular)
  ('Hans',      'TU_APELLIDO',      'TU_EMPRESA',         'Gerente de Tecnología',  'Bogotá',       null, true,
     'las soluciones de infraestructura híbrida e IA'),
  -- sin proyecto por ahora, pide info por correo
  ('Valentina', 'Ríos Castaño',     'Andes Logística',    'Directora de TI',        'Medellín',     null, true,
     'los portátiles ThinkPad para equipos en campo'),
  -- tiene perfil pero no celular
  ('Andrés',    'Mejía Ortiz',      'Café Cordillera',    'CEO',                    'Manizales',    null, true, null),
  -- sin perfil de LinkedIn
  ('Laura',     'Gómez Patiño',     'Textiles del Valle', 'Jefe de Infraestructura','Cali',         null, true, null),
  -- sin consentimiento
  ('Santiago',  'Herrera Lozano',   'FinPlus S.A.S.',     'VP de Tecnología',       'Bogotá',       null, false, null),
  -- no contesta
  ('Camila',    'Vargas Restrepo',  'Salud Integral IPS', 'Gerente de Innovación',  'Barranquilla', null, true,
     'los casos de IA aplicada a salud');

insert into public.sandbox_profiles (full_name, company, headline, linkedin_url, mobile_phone, email, mock_call_outcome) values
  ('Hans TU_APELLIDO',      'TU_EMPRESA',         'Gerente de Tecnología en TU_EMPRESA',
     'https://www.linkedin.com/in/TU_SLUG_LINKEDIN', '+57TU_CELULAR', 'TU_CORREO@gmail.com', 'accept'),
  ('Valentina Ríos Castaño','Andes Logística',    'Directora de TI | Andes Logística',
     'https://www.linkedin.com/in/valentina-rios-castano-demo', '+573000000002', 'valentina.rios@example.com', 'decline'),
  ('Andrés Mejía Ortiz',    'Café Cordillera',    'CEO en Café Cordillera',
     'https://www.linkedin.com/in/andres-mejia-ortiz-demo', null, null, 'accept'),
  ('Camila Vargas Restrepo','Salud Integral IPS', 'Gerente de Innovación · Salud Integral IPS',
     'https://www.linkedin.com/in/camila-vargas-restrepo-demo', '+573000000006', 'camila.vargas@example.com', 'no_answer'),
  -- homónimo en otra empresa
  ('Valentina Ríos',        'Banco Ficticio',     'Analista de Riesgo',
     'https://www.linkedin.com/in/valentina-rios-banco-demo', '+573000000099', 'vrios@example.com', 'accept');
