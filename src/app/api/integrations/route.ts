import { NextResponse } from "next/server";
import { env } from "@/lib/env";
import { signalHireCredits } from "@/lib/providers/signalhire";
import { apolloStatus } from "@/lib/providers/apollo";
import { db } from "@/lib/db";
import { getSettings } from "@/lib/settings";

type Status = "activo" | "prueba" | "inactivo";
interface Item {
  name: string;
  purpose: string;
  status: Status;
  detail: string;
}
const has = (k: string) => !!process.env[k]?.trim();
const hourLabel = (h: number) => `${h % 12 === 0 ? 12 : h % 12}:00 ${h < 12 ? "a. m." : "p. m."}`;

// Estado de cada conexión y qué hace en el flujo de Capricorne (nunca expone claves).
export async function GET() {
  const p = env.providers;
  const s = await getSettings();
  const r = s.report;
  const items: Item[] = [
    {
      name: "Supabase",
      purpose: "Base de datos: leads, llamadas, reuniones, correos, bitácora y configuración.",
      status: has("SUPABASE_URL") ? "activo" : "inactivo",
      detail: "PostgreSQL con RLS; solo el servidor de la app la consulta.",
    },
    {
      name: "Vercel",
      purpose: "Aloja Capricorne y ejecuta el flujo de cada lead (identificar, enriquecer, llamar, agendar).",
      status: "activo",
      detail: env.appUrl(),
    },
    {
      name: "Serper (Google)",
      purpose: "Busca el perfil de LinkedIn del lead y los datos de su empresa (Google Maps, web y teléfonos públicos).",
      status: has("SERPER_API_KEY") && p.linkedin !== "sandbox" ? "activo" : "prueba",
      detail: p.linkedin === "hybrid" ? "Búsqueda real + datos de prueba para leads ficticios" : `Modo ${p.linkedin}`,
    },
    {
      name: "SignalHire",
      purpose: "Confirma identidad, cargo actual, historial y habilidades del lead (gratis); revela celular y correo con crédito, solo manual.",
      status: has("SIGNALHIRE_API_KEY") ? "activo" : "inactivo",
      detail: has("SIGNALHIRE_API_KEY") ? `Búsqueda gratuita automática · ${(await signalHireCredits()) ?? "?"} crédito(s) para revelar desde el detalle` : "Sin configurar",
    },
    await apolloItem(),
    {
      name: "Hunter",
      purpose: "Encuentra el correo profesional del lead con su nombre y el dominio de la empresa.",
      status: has("HUNTER_API_KEY") ? "activo" : "inactivo",
      detail: "Solo cuando falta el correo; se usa si la confianza es alta.",
    },
    {
      name: "Claude (Anthropic)",
      purpose: "1) Desempata homónimos al buscar el LinkedIn del lead. 2) Redacta el análisis del reporte: resumen, decisiones operativas y qué ofrecer a cada lead.",
      status: has("ANTHROPIC_API_KEY") ? "activo" : "inactivo",
      detail: has("ANTHROPIC_API_KEY") ? "Claude Haiku 5.5 con esfuerzo bajo · ≈ USD 0,003 por reporte. Si falla, el reporte sale con análisis por reglas." : "Sin clave: el reporte usa análisis por reglas",
    },
    {
      name: "n8n",
      purpose: "Orquesta el reporte: revisa cada hora si toca enviarlo, pide los datos a Capricorne, llama a Claude, genera el PDF, lo envía y lo registra.",
      status: r.n8n_webhook ? "activo" : "inactivo",
      detail: r.n8n_webhook ? `Reporte ${r.schedule.frequency} a las ${hourLabel(r.schedule.hour)} · ${r.recipients.length} destinatario(s) · "Enviar ahora" conectado` : "Sin webhook: la app envía el reporte por su cuenta",
    },
    {
      name: "Vapi + Twilio",
      purpose: "Hace la llamada de voz con IA al lead: guion, 4 preguntas de calificación y agendamiento en vivo.",
      status: p.voice === "vapi" && has("VAPI_API_KEY") ? (s.live_calls ? "activo" : "prueba") : "prueba",
      detail: p.voice === "vapi" ? (s.live_calls ? `Llamadas reales a ${s.live_numbers.length} número(s) autorizado(s); el resto simuladas` : "Llamadas simuladas") : "Simulado",
    },
    {
      name: s.agent_voice.provider === "11labs" ? "ElevenLabs" : "Azure Speech",
      purpose: "La voz del agente durante la llamada.",
      status: "activo",
      detail: `${s.agent_voice.agentName} · ${s.agent_voice.voiceId}${s.agent_voice.provider === "11labs" ? " (respaldo automático: Azure Salomé)" : ""}`,
    },
    {
      name: "Google Calendar",
      purpose: "Crea la reunión con enlace de Meet, invita al lead y al comercial, y lee si el lead confirmó la invitación.",
      status: p.calendar === "google" && has("GOOGLE_REFRESH_TOKEN") ? "activo" : "prueba",
      detail: p.calendar === "google" ? "Calendario principal de la cuenta conectada · confirmaciones en el reporte" : "Sandbox",
    },
    {
      name: p.email === "smtp" ? "Gmail (SMTP)" : p.email === "gmail" ? "Gmail (API)" : "Correo",
      purpose: "Confirmación de reunión al lead, seguimiento si no contesta y resumen al comercial asignado.",
      status: p.email === "sandbox" ? "prueba" : "activo",
      detail: env.sender().email || "Sandbox: se guardan sin enviarse",
    },
  ];
  return NextResponse.json({ items });
}

async function apolloItem(): Promise<Item> {
  const purpose = "Completa la empresa del lead: sector, tamaño, teléfono, LinkedIn, vacantes abiertas y noticias recientes.";
  const st = await apolloStatus();
  if (!st) return { name: "Apollo.io", purpose, status: "inactivo", detail: "Sin configurar" };
  const { count } = await db().from("events").select("id", { count: "exact", head: true }).eq("step", "enrichment").like("message", "Apollo:%").not("message", "like", "%plan actual%");
  const usage = st.usedToday !== null ? ` · ${st.usedToday}/${st.dayLimit ?? "?"} consultas hoy` : "";
  return {
    name: "Apollo.io",
    purpose,
    status: st.org || st.person ? "activo" : "inactivo",
    detail: st.person
      ? `Plan con acceso a personas · ${count ?? 0} enriquecimiento(s) con crédito${usage}. Saldo exacto en app.apollo.io → Plans & Billing`
      : `Plan gratis: empresa, vacantes y noticias${usage}. Correo y celular de personas requieren plan pago`,
  };
}
