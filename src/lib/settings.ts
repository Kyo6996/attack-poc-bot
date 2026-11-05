import "server-only";
import { db } from "./db";

export interface AppSettings {
  live_calls: boolean;
}

const DEFAULTS: AppSettings = { live_calls: true };

// Si la tabla aún no existe (migración 0003 sin correr) se usan los valores por defecto.
export async function getSettings(): Promise<AppSettings> {
  const { data, error } = await db().from("app_settings").select("key, value");
  if (error || !data) return DEFAULTS;
  const out = { ...DEFAULTS } as Record<string, unknown>;
  for (const row of data) out[row.key] = row.value;
  return out as unknown as AppSettings;
}

export async function setSetting<K extends keyof AppSettings>(key: K, value: AppSettings[K]) {
  const { error } = await db()
    .from("app_settings")
    .upsert({ key, value, updated_at: new Date().toISOString() });
  if (error) throw new Error(error.message);
}
