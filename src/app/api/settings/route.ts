import { NextResponse, type NextRequest } from "next/server";
import { logEvent } from "@/lib/db";
import { env } from "@/lib/env";
import { getSettings, setSetting } from "@/lib/settings";
import { toE164 } from "@/lib/util";
import type { AgentVoice } from "@/lib/voices";

export async function GET() {
  return NextResponse.json(await getSettings());
}

// Crea y borra un asistente temporal en Vapi para comprobar que acepta la voz antes de guardarla.
async function validateVoice(v: AgentVoice) {
  const res = await fetch("https://api.vapi.ai/assistant", {
    method: "POST",
    headers: { Authorization: `Bearer ${env.vapiKey()}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      name: "validacion-voz",
      model: { provider: "openai", model: "gpt-4o", messages: [{ role: "system", content: "x" }] },
      voice: { provider: v.provider, voiceId: v.voiceId, speed: v.speed },
    }),
  });
  const json = (await res.json()) as { id?: string; message?: string | string[] };
  if (!res.ok || !json.id) throw new Error(`Vapi rechazó la voz: ${[json.message].flat().join("; ")}`);
  await fetch(`https://api.vapi.ai/assistant/${json.id}`, { method: "DELETE", headers: { Authorization: `Bearer ${env.vapiKey()}` } });
}

export async function POST(req: NextRequest) {
  const body = (await req.json()) as {
    live_calls?: boolean;
    agent_voice?: Partial<AgentVoice>;
    live_numbers?: string[];
    authorize?: string;
    revoke?: string;
  };
  try {
    if (typeof body.live_calls === "boolean") {
      await setSetting("live_calls", body.live_calls);
      await logEvent(null, "system", body.live_calls ? "Llamadas reales activadas" : "Llamadas reales desactivadas: se simulan");
    }
    if (body.live_numbers || body.authorize || body.revoke) {
      const current = (await getSettings()).live_numbers;
      let next = body.live_numbers ? body.live_numbers : current;
      if (body.authorize) next = [...next, body.authorize];
      if (body.revoke) next = next.filter((n) => toE164(n) !== toE164(body.revoke));
      const clean = [...new Set(next.map((n) => toE164(n)).filter((n): n is string => !!n))];
      await setSetting("live_numbers", clean);
      await logEvent(null, "system", `Números autorizados para llamada real: ${clean.length}`);
    }
    if (body.agent_voice) {
      const v = body.agent_voice;
      if (!v.provider || !v.voiceId) throw new Error("Falta proveedor o voz");
      const voice: AgentVoice = {
        provider: v.provider.trim(),
        voiceId: v.voiceId.trim(),
        speed: Math.min(1.3, Math.max(0.7, Number(v.speed ?? 0.95))),
        agentName: (v.agentName ?? "Sofía").trim() || "Sofía",
      };
      await validateVoice(voice);
      await setSetting("agent_voice", voice);
      await logEvent(null, "system", `Voz del agente: ${voice.voiceId} (${voice.provider}) · ${voice.agentName} · velocidad ${voice.speed}`);
    }
    return NextResponse.json(await getSettings());
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}
