import { NextResponse, type NextRequest } from "next/server";
import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { buildAssistant } from "@/lib/providers/voice";
import { getSettings } from "@/lib/settings";
import type { Contact } from "@/lib/types";

const DEMO: Partial<Contact> = {
  id: "demo",
  first_name: "Hans",
  last_name: "Demo",
  company: "Andino Software",
  title: "Gerente de Tecnología",
  email: null,
  event_notes: "las soluciones de infraestructura híbrida e IA",
};

// Configuración para hablar con el agente desde el navegador: misma voz y guion, sin herramientas ni webhooks.
export async function GET(req: NextRequest) {
  const key = env.vapiPublicKey();
  if (!key) return NextResponse.json({ error: "Falta VAPI_PUBLIC_KEY" }, { status: 400 });
  const id = req.nextUrl.searchParams.get("contactId");
  const { data } = id ? await db().from("contacts").select("*").eq("id", id).maybeSingle() : { data: null };
  const { agent_voice } = await getSettings();
  return NextResponse.json({ publicKey: key, assistant: buildAssistant((data ?? DEMO) as Contact, agent_voice, "preview") });
}
