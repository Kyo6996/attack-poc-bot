import { NextResponse, type NextRequest } from "next/server";
import { env } from "@/lib/env";

export const maxDuration = 60;

const MODEL = "resemble-ai/chatterbox-multilingual";
let schema: Record<string, unknown> | null = null;

// Los nombres de los parámetros se leen del esquema publicado del modelo en Replicate.
async function inputNames(token: string) {
  if (!schema) {
    const res = await fetch(`https://api.replicate.com/v1/models/${MODEL}`, { headers: { Authorization: `Bearer ${token}` } });
    if (!res.ok) throw new Error(`Replicate ${res.status}: ${await res.text()}`);
    const json = (await res.json()) as {
      latest_version?: { openapi_schema?: { components?: { schemas?: { Input?: { properties?: Record<string, unknown> } } } } };
    };
    schema = json.latest_version?.openapi_schema?.components?.schemas?.Input?.properties ?? {};
  }
  const keys = Object.keys(schema);
  const find = (...cands: RegExp[]) => keys.find((k) => cands.some((c) => c.test(k)));
  return {
    text: find(/^text_to_synthesize$/, /^text$/, /prompt$/, /text/),
    language: find(/language/),
    reference: find(/reference/, /audio_prompt/, /speaker/, /voice/),
    exaggeration: find(/exaggeration/),
    cfg: find(/cfg/),
    temperature: find(/temperature/),
    all: keys,
  };
}

export async function POST(req: NextRequest) {
  const token = env.replicateToken();
  if (!token) return NextResponse.json({ error: "Falta REPLICATE_API_TOKEN para usar Chatterbox" }, { status: 400 });
  const body = (await req.json()) as { text?: string; exaggeration?: number; cfg?: number; temperature?: number; reference?: string | null };
  const text = (body.text ?? "").trim();
  if (!text) return NextResponse.json({ error: "Escribe un texto" }, { status: 400 });
  if (text.length > 300) return NextResponse.json({ error: "Máximo 300 caracteres por frase" }, { status: 400 });
  if (body.reference && body.reference.length > 4_000_000) return NextResponse.json({ error: "El audio de referencia es muy grande (máx. ~3 MB)" }, { status: 400 });

  try {
    const n = await inputNames(token);
    if (!n.text) throw new Error(`No reconozco el campo de texto del modelo (campos: ${n.all.join(", ")})`);
    const input: Record<string, unknown> = { [n.text]: text };
    if (n.language) input[n.language] = "es";
    if (n.exaggeration && body.exaggeration !== undefined) input[n.exaggeration] = body.exaggeration;
    if (n.cfg && body.cfg !== undefined) input[n.cfg] = body.cfg;
    if (n.temperature && body.temperature !== undefined) input[n.temperature] = body.temperature;
    if (n.reference && body.reference) input[n.reference] = body.reference;

    const started = Date.now();
    let res = await fetch(`https://api.replicate.com/v1/models/${MODEL}/predictions`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", Prefer: "wait=50" },
      body: JSON.stringify({ input }),
    });
    let pred = (await res.json()) as { status?: string; output?: unknown; error?: string; detail?: string; urls?: { get?: string } };
    if (!res.ok) throw new Error(pred.detail ?? pred.error ?? `Replicate ${res.status}`);
    while (pred.status && !["succeeded", "failed", "canceled"].includes(pred.status) && pred.urls?.get && Date.now() - started < 55_000) {
      await new Promise((r) => setTimeout(r, 1500));
      res = await fetch(pred.urls.get, { headers: { Authorization: `Bearer ${token}` } });
      pred = await res.json();
    }
    if (pred.status !== "succeeded") throw new Error(pred.error ?? `La generación no terminó (estado: ${pred.status})`);
    const url = Array.isArray(pred.output) ? pred.output[0] : pred.output;
    return NextResponse.json({ url, seconds: Math.round((Date.now() - started) / 100) / 10 });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 502 });
  }
}
