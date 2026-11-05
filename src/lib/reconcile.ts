import "server-only";
import { finishVapiCall, type VapiEnd } from "./callresult";
import { closeCall } from "./calls";
import { db, logEvent } from "./db";
import { env } from "./env";

interface VapiCall extends VapiEnd {
  id: string;
  status: string; // queued | ringing | in-progress | forwarding | ended
  createdAt: string;
  monitor?: { controlUrl?: string };
}

async function getCall(id: string): Promise<VapiCall | null> {
  try {
    const res = await fetch(`https://api.vapi.ai/call/${id}`, {
      headers: { Authorization: `Bearer ${env.vapiKey()}` },
      signal: AbortSignal.timeout(8000),
    });
    return res.ok ? ((await res.json()) as VapiCall) : null;
  } catch {
    return null;
  }
}

async function endRemote(call: VapiCall) {
  if (!call.monitor?.controlUrl) return;
  await fetch(call.monitor.controlUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ type: "end-call" }),
    signal: AbortSignal.timeout(5000),
  }).catch(() => undefined);
}

// Si Vapi nunca conectó la llamada (sin startedAt) en 3 minutos, o lleva más que el máximo permitido, se da por perdida.
const NEVER_CONNECTED_MS = 3 * 60_000;
const HARD_LIMIT_MS = 9 * 60_000;

// Cierra un contacto que quedó "en llamada" cuando el aviso de fin de Vapi no llegó.
export async function reconcileContact(contactId: string, callId: string | null, force = false): Promise<string> {
  const call = callId && !callId.startsWith("sim_") ? await getCall(callId) : null;

  if (call?.status === "ended") {
    await logEvent(contactId, "call", "El aviso de fin de Vapi no llegó: se cerró consultando la llamada");
    await finishVapiCall(contactId, call);
    return "cerrada con el resultado de Vapi";
  }

  const age = call ? Date.now() - Date.parse(call.createdAt) : Infinity;
  const lost = !call || (!call.startedAt && age > NEVER_CONNECTED_MS) || age > HARD_LIMIT_MS;
  if (!force && !lost) return "sigue en curso";

  if (call) await endRemote(call);
  const reason = !call ? "Llamada fallida: no se encontró en Vapi" : call.startedAt ? "Llamada fallida: liberada manualmente" : "Llamada fallida: se perdió la conexión antes de contestar";
  await closeCall({ providerCallId: callId ?? "" }, { status: "failed", endedReason: "connection-lost" });
  await finishVapiCall(contactId, { endedReason: "connection-lost", call: { id: callId ?? undefined } }, reason);
  return reason;
}

let lastRun = 0;

// Se ejecuta en segundo plano desde el panel como máximo cada 30 s.
export async function reconcileStuckCalls() {
  if (Date.now() - lastRun < 30_000) return;
  lastRun = Date.now();
  const since = new Date(Date.now() - 90_000).toISOString();
  const { data } = await db().from("contacts").select("id, call_id").eq("status", "calling").lt("updated_at", since);
  for (const c of data ?? []) await reconcileContact(c.id, c.call_id);
}
