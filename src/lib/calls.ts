import "server-only";
import { db, logEvent } from "./db";
import type { CallRow } from "./types";

export async function openCall(contactId: string, provider: string, providerCallId?: string) {
  const { data, error } = await db()
    .from("calls")
    .insert({ contact_id: contactId, provider, provider_call_id: providerCallId ?? null })
    .select("*")
    .single();
  if (error) throw new Error(`calls: ${error.message}`);
  return data as CallRow;
}

export async function closeCall(
  match: { id?: string; providerCallId?: string },
  result: { status: CallRow["status"]; endedReason?: string | null; outcome?: string | null; durationSec?: number | null },
) {
  let q = db().from("calls").select("*");
  q = match.id ? q.eq("id", match.id) : q.eq("provider_call_id", match.providerCallId ?? "");
  const { data } = await q.order("started_at", { ascending: false }).limit(1).maybeSingle();
  if (!data) return;
  const ended = new Date();
  // Vapi reporta la duración con decimales y la columna es entera.
  const duration = Math.round(result.durationSec ?? (ended.getTime() - Date.parse(data.started_at)) / 1000);
  const { error } = await db()
    .from("calls")
    .update({
      status: result.status,
      ended_reason: result.endedReason ?? null,
      outcome: result.outcome ?? null,
      ended_at: ended.toISOString(),
      duration_sec: duration,
    })
    .eq("id", data.id);
  if (error) await logEvent(data.contact_id, "call", `No se pudo cerrar el registro de la llamada: ${error.message}`, "error");
}
