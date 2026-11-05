# Capricorne Project · bot de prospección (Attack POC)

Toma una base de personas (nombre, apellidos, empresa, cargo…) y, por cada una:

1. **Ubica su perfil de LinkedIn** (búsqueda web + scoring + desambiguación con Claude).
2. **Busca su celular** (SignalHire). Si no hay perfil o no hay celular → **salta al siguiente**.
3. **La llama** con un agente de voz con IA que sigue el guion (Vapi).
4. **Si acepta, agenda** una reunión virtual y le envía la invitación con link de Meet (Google Calendar).

Stack: **Next.js en Vercel** (panel, API, webhooks) + **Supabase** (contactos, estados, reuniones, bitácora, sandbox).

```
src/lib/pipeline.ts            máquina de estados (orquestador)
src/lib/providers/linkedin.ts  paso 1 · sandbox | serper (+ Claude)
src/lib/providers/enrichment.ts paso 2 · sandbox | signalhire (async + callback)
src/lib/providers/voice.ts     paso 3 · simulated | vapi
src/lib/providers/calendar.ts  paso 4 · sandbox | google
src/lib/script.ts              guion de la llamada (seguimiento ANDICOM 2026)
src/app/api/webhooks/*         callbacks de SignalHire y Vapi
supabase/migrations, seed.sql  esquema y datos de prueba
```

## Puesta en marcha

### 1. Supabase
1. Crea un proyecto en supabase.com.
2. SQL Editor → corre `supabase/migrations/0001_init.sql` y luego `0002_agenda_correo_metricas.sql`.
3. Edita `supabase/seed.sql`: reemplaza `TU_APELLIDO`, `TU_EMPRESA`, `TU_CELULAR` (E.164, ej. `+573001234567`), `TU_CORREO`, `TU_SLUG_LINKEDIN`. Córrelo.
4. Copia `Project URL` y la **secret key** (Settings → API).

### 2. Local
```bash
cp .env.example .env.local   # llena SUPABASE_URL, SUPABASE_SECRET_KEY, WEBHOOK_SECRET
npm install
npm run dev                  # http://localhost:3000
```
Con todos los proveedores en `sandbox/simulated` ya funciona de punta a punta, sin llaves externas.

### 3. Vercel
```bash
npx vercel           # o importa el repo desde vercel.com
```
Carga las mismas variables en *Project → Settings → Environment Variables* y redeploy.
`APP_URL` se deduce del dominio de producción; los webhooks deben ser públicos (por eso Vercel).

### 4. Activar proveedores reales (uno por uno)

| Paso | Variable | Qué necesitas |
|---|---|---|
| Llamada | `PROVIDER_VOICE=vapi` | Cuenta Vapi, `VAPI_API_KEY`, un número (`VAPI_PHONE_NUMBER_ID`). Los números gratis de Vapi solo llaman a EE. UU.: para Colombia, importa un número de Twilio. |
| Calendario y correo | `PROVIDER_CALENDAR=google`, `PROVIDER_EMAIL=gmail` | Ver *Google Calendar y Gmail* abajo. |
| Enriquecimiento | `PROVIDER_ENRICHMENT=signalhire` | `SIGNALHIRE_API_KEY` (consume créditos; responde por callback a `/api/webhooks/signalhire`). |
| LinkedIn | `PROVIDER_LINKEDIN=serper` | `SERPER_API_KEY`; opcional `ANTHROPIC_API_KEY` para desambiguar. |

**Demo recomendada:** LinkedIn y enriquecimiento en `sandbox` (son personas ficticias, no existen en LinkedIn) y **voz + calendario reales**: el bot llama a tu celular y la invitación llega a tu correo.

## Google Calendar y Gmail
1. [console.cloud.google.com](https://console.cloud.google.com) → crea un proyecto.
2. *APIs y servicios → Biblioteca*: habilita **Google Calendar API** y **Gmail API**.
3. *Pantalla de consentimiento OAuth*: tipo **Externo**, agrega tu correo como **usuario de prueba**.
4. *Credenciales → Crear credenciales → ID de cliente OAuth* → tipo **App de escritorio**.
5. `GOOGLE_CLIENT_ID=… GOOGLE_CLIENT_SECRET=… node scripts/google-refresh-token.mjs`, abre la URL y autoriza con la cuenta que enviará las invitaciones.
6. Carga `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REFRESH_TOKEN` y la firma (`SENDER_*`) en Vercel.

Con la app en modo *Prueba*, Google invalida el refresh token a los 7 días; para algo más largo, publica la app (*En producción*).

## Uso
- **Ejecutar pipeline**: avanza todos los pendientes. **Automático**: lo repite cada 8 s.
- **▶** en una fila: procesa solo ese contacto. **Llamada**: resumen, grabación y transcripción.
- **Importar CSV**: `nombre,apellidos,empresa,cargo,ciudad,email,consentimiento` (ver `data/`).
- **Reiniciar demo**: deja todo en "Pendiente" (borra reuniones, correos, llamadas y bitácora) para volver a grabar.
- **Agenda**: reuniones por día con comercial asignado, enlace de Meet / Google Calendar y estado del correo, con opción de reenviar.
- **Comerciales**: quién atiende cada área; la reunión se asigna al de menor carga y recibe un brief del lead.
- **Desempeño · SLA 24 h**: llamadas por minuto, contestadas / perdidas / fallidas, aceptación de citas y cumplimiento del SLA (primer intento de llamada antes de 24 h).
- **/agendar/{token}**: página pública enlazada desde el correo de seguimiento para que el cliente elija horario.

## Datos y cumplimiento
- Solo se procesan contactos con `consent = true` (Ley 1581 de 2012).
- No hay scraping ni login automatizado en LinkedIn: solo resultados públicos de buscadores.
- El agente se identifica como asistente virtual si se lo preguntan y respeta un "no".
- RLS activo en Supabase sin políticas públicas: solo el backend accede a los datos.
- Celulares y correos se muestran enmascarados en el panel.
