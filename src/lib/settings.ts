import "server-only";
import { db } from "./db";
import { env } from "./env";
import type { AgentVoice } from "./voices";

export interface AppSettings {
  live_calls: boolean;
  agent_voice: AgentVoice;
}

function defaults(): AppSettings {
  return {
    live_calls: true,
    agent_voice: { provider: env.vapiVoiceProvider(), voiceId: env.vapiVoiceId(), speed: 0.95, agentName: env.agentName() },
  };
}

// Si la tabla aún no existe (migración 0003 sin correr) se usan los valores por defecto.
export async function getSettings(): Promise<AppSettings> {
  const base = defaults();
  const { data, error } = await db().from("app_settings").select("key, value");
  if (error || !data) return base;
  const out = { ...base } as Record<string, unknown>;
  for (const row of data) out[row.key] = row.key === "agent_voice" ? { ...base.agent_voice, ...row.value } : row.value;
  return out as unknown as AppSettings;
}

export async function setSetting<K extends keyof AppSettings>(key: K, value: AppSettings[K]) {
  const { error } = await db()
    .from("app_settings")
    .upsert({ key, value, updated_at: new Date().toISOString() });
  if (error) throw new Error(error.message);
}
