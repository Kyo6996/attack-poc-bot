import "server-only";
import { db } from "./db";
import { env } from "./env";
import type { AgentVoice } from "./voices";

export interface AppSettings {
  live_calls: boolean;
  agent_voice: AgentVoice;
  // Números con consentimiento que reciben llamada real; el resto se simula.
  live_numbers: string[];
  report: ReportConfig;
}

export interface ReportRecipient {
  email: string;
  name: string | null;
  area: string;
}

export type ReportFrequency = "diario" | "semanal" | "quincenal" | "mensual";

// Destinatarios del reporte, cuándo se envía y webhook de n8n que lo orquesta.
export interface ReportConfig {
  areas: string[];
  recipients: ReportRecipient[];
  n8n_webhook: string | null;
  schedule: { frequency: ReportFrequency; hour: number };
}

function defaults(): AppSettings {
  return {
    live_calls: true,
    agent_voice: { provider: env.vapiVoiceProvider(), voiceId: env.vapiVoiceId(), speed: 0.95, agentName: env.agentName() },
    live_numbers: env.voiceLiveNumbers(),
    report: { areas: ["Gerencia", "Comercial", "Operaciones"], recipients: [], n8n_webhook: null, schedule: { frequency: "diario", hour: 18 } },
  };
}

// Si la tabla aún no existe (migración 0003 sin correr) se usan los valores por defecto.
export async function getSettings(): Promise<AppSettings> {
  const base = defaults();
  const { data, error } = await db().from("app_settings").select("key, value");
  if (error || !data) return base;
  const out = { ...base } as Record<string, unknown>;
  for (const row of data) out[row.key] = row.key === "agent_voice" || row.key === "report" ? { ...(base[row.key as "report"] as object), ...row.value } : row.value;
  return out as unknown as AppSettings;
}

export async function setSetting<K extends keyof AppSettings>(key: K, value: AppSettings[K]) {
  const { error } = await db()
    .from("app_settings")
    .upsert({ key, value, updated_at: new Date().toISOString() });
  if (error) throw new Error(error.message);
}
