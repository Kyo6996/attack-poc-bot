# Bot de prospección con IA: arquitectura (POC)

**Hans · Prueba de concepto para Attack**

## Arquitectura

```
 Base de contactos ─► Supabase (Postgres) ◄──────────── Panel web (Next.js en Vercel)
                          │  estados · reuniones · bitácora      ▲ tiempo casi real
                          ▼
               Orquestador (máquina de estados, funciones de Vercel)
   1 LinkedIn ──► 2 Enriquecimiento ──► 3 Llamada de voz ──► 4 Agenda + invitación
   Serper + Claude     SignalHire        Vapi (STT+LLM+TTS)     Google Calendar + Meet
                   (callback async)    (tools → webhook)         (sendUpdates=all)
        └── sin perfil / sin celular / sin consentimiento ⇒ "omitido" y pasa al siguiente
```

Cada contacto avanza por estados (`pending → linkedin_found → phone_found → calling → meeting_scheduled / declined / no_answer / skipped`). Los pasos lentos o externos (enriquecimiento y llamada) son **asíncronos**: el proveedor responde por webhook y el bot continúa solo con el siguiente registro. Cada paso tiene una implementación **sandbox** sobre datos precargados en Supabase y una **real**; se elige por variable de entorno.

## Herramientas y por qué

| Pieza | Elección | Motivo |
|---|---|---|
| Backend + panel | Next.js en **Vercel** | Webhooks públicos con HTTPS sin servidores; despliegue con `git push`. |
| Datos | **Supabase** | Postgres real: auditoría, locks contra doble llamada, RLS. Sirve también de sandbox de pruebas. |
| LinkedIn | **Serper** (Google) + **Claude** | Encuentra perfiles públicos sin scraping ni login en LinkedIn (respeta sus términos). Claude descarta homónimos. |
| Celular | **SignalHire** API | Lo pedía el reto; API por lotes con callback. |
| Voz | **Vapi** + Deepgram + voz Azure es-CO | Conversación natural en español colombiano, interrupciones y *tool calling* para agendar *durante* la llamada. |
| Agenda | **Google Calendar** API | Consulta disponibilidad real, crea Meet y envía la invitación .ics al correo. |

Elegí código en lugar de n8n porque el flujo tiene estado, webhooks y lógica de negocio (scoring, locks, cumplimiento) que conviene versionar y probar.

## Limitaciones

- La cobertura de celulares en Colombia/LATAM es parcial y cada consulta consume créditos.
- Los resultados de búsqueda pueden tener perfiles desactualizados. Se mitiga con el umbral de confianza.
- Las llamadas a Colombia requieren un número propio (Twilio) y que no lo marquen como spam.
- El correo dictado por voz es poco fiable, por eso se prioriza el del enriquecimiento y solo se confirma.
- La llamada en frío automatizada exige base legal: aquí solo se llama a contactos con consentimiento.
- POC sin reintentos programados ni horarios de llamada por zona horaria del contacto.

## Siguientes pasos

1. Reintentos para "no contestó" (otro día y otra franja) y canal alterno (WhatsApp o correo).
2. Respetar el horario legal de llamadas y la lista de no contactar; registrar evidencia del consentimiento.
3. Sincronizar con el CRM (HubSpot o Salesforce) y medir conversión por segmento y por guion (A/B).
4. Cola durable (Supabase Queues o Inngest) para escalar a miles de registros con concurrencia controlada.
5. Evaluar las transcripciones con IA para mejorar el guion y detectar objeciones frecuentes.
