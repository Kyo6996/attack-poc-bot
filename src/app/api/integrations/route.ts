import { NextResponse } from "next/server";
import { env } from "@/lib/env";
import { signalHireCredits } from "@/lib/providers/signalhire";
import { apolloStatus } from "@/lib/providers/apollo";
import { db } from "@/lib/db";
import { getSettings } from "@/lib/settings";

type Status = "activo" | "prueba" | "inactivo";
const has = (k: string) => !!process.env[k]?.trim();

// Estado de cada conexión para la pantalla de Integraciones (nunca expone claves).
export async function GET() {
  const p = env.providers;
  const s = await getSettings();
  const items: { name: string; purpose: string; status: Status; detail: string }[] = [
    { name: "Supabase", purpose: "Base de datos de contactos, reuniones y métricas", status: has("SUPABASE_URL") ? "activo" : "inactivo", detail: "PostgreSQL con RLS" },
    {
      name: "Serper (Google)",
      purpose: "Perfil de LinkedIn y datos de empresas (Google Maps y web)",
      status: has("SERPER_API_KEY") && p.linkedin !== "sandbox" ? "activo" : "prueba",
      detail: p.linkedin === "hybrid" ? "Híbrido: real + datos de prueba" : p.linkedin,
    },
    { name: "Hunter", purpose: "Correo profesional por nombre y dominio", status: has("HUNTER_API_KEY") ? "activo" : "inactivo", detail: "Solo si falta el correo" },
    {
      name: "SignalHire",
      purpose: "Historial laboral y habilidades (gratis) · celular y correo (con crédito, solo manual)",
      status: has("SIGNALHIRE_API_KEY") ? "activo" : "inactivo",
      detail: has("SIGNALHIRE_API_KEY")
        ? `Búsqueda gratuita automática · ${(await signalHireCredits()) ?? "?"} crédito(s) para revelar desde el detalle`
        : "Sin configurar",
    },
    await apolloItem(),
    { name: "Claude (Anthropic)", purpose: "Desambiguar homónimos en LinkedIn", status: has("ANTHROPIC_API_KEY") ? "activo" : "inactivo", detail: "Opcional" },
    {
      name: "Vapi + Twilio",
      purpose: "Llamadas de voz con IA",
      status: p.voice === "vapi" && has("VAPI_API_KEY") ? (s.live_calls ? "activo" : "prueba") : "prueba",
      detail: p.voice === "vapi" ? (s.live_calls ? `Llamadas reales a ${s.live_numbers.length} número(s) autorizado(s)` : "Llamadas simuladas") : "Simulado",
    },
    {
      name: s.agent_voice.provider === "11labs" ? "ElevenLabs" : "Azure Speech",
      purpose: "Voz del agente",
      status: "activo",
      detail: `${s.agent_voice.agentName} · ${s.agent_voice.voiceId}${s.agent_voice.provider === "11labs" ? " (respaldo: Azure Salomé)" : ""}`,
    },
    {
      name: "Google Calendar",
      purpose: "Reuniones con Meet e invitaciones",
      status: p.calendar === "google" && has("GOOGLE_REFRESH_TOKEN") ? "activo" : "prueba",
      detail: p.calendar === "google" ? "Calendario principal de la cuenta conectada" : "Sandbox",
    },
    {
      name: p.email === "smtp" ? "Gmail (SMTP)" : p.email === "gmail" ? "Gmail (API)" : "Correo",
      purpose: "Confirmaciones, seguimiento y brief al comercial",
      status: p.email === "sandbox" ? "prueba" : "activo",
      detail: env.sender().email || "Sandbox: se guardan sin enviarse",
    },
  ];
  return NextResponse.json({ items });
}

async function apolloItem(): Promise<{ name: string; purpose: string; status: Status; detail: string }> {
  const purpose = "Datos de empresa (gratis) · correo y celular de la persona (con crédito, solo si faltan)";
  const st = await apolloStatus();
  if (!st) return { name: "Apollo.io", purpose, status: "inactivo", detail: "Sin configurar" };
  const { count } = await db().from("events").select("id", { count: "exact", head: true }).eq("step", "enrichment").like("message", "Apollo:%").not("message", "like", "%plan actual%");
  const usage = st.usedToday !== null ? ` · ${st.usedToday}/${st.dayLimit ?? "?"} consultas hoy` : "";
  return {
    name: "Apollo.io",
    purpose,
    status: st.org || st.person ? "activo" : "inactivo",
    detail: st.person
      ? `Plan con acceso a personas · ${count ?? 0} enriquecimiento(s) con crédito hechos por la app${usage}. Saldo exacto: app.apollo.io → Settings → Plans & Billing (la API no lo publica)`
      : `Activo: datos de empresa, vacantes y noticias para prospección${usage}. Correo y celular de personas: el plan gratis no los entrega por API (sí desde app.apollo.io)`,
  };
}
