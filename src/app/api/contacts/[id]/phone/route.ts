import { NextResponse, type NextRequest } from "next/server";
import { db, logEvent, updateContact } from "@/lib/db";
import { getSettings, setSetting } from "@/lib/settings";
import type { Contact, ContactStatus } from "@/lib/types";
import { maskPhone, toE164 } from "@/lib/util";

// Estados desde los que, al elegir número, el contacto queda listo para llamar con ▶.
const READY_FROM: ContactStatus[] = ["pending", "linkedin_found", "needs_review", "skipped", "no_answer", "call_failed", "declined", "phone_found"];

// Body: { phone, source?, authorize? }. source = etiqueta del número elegido de la lista; sin source es un número escrito a mano.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = (await req.json()) as { phone?: string; source?: string | null; authorize?: boolean };
  const phone = toE164(body.phone);
  if (!phone) return NextResponse.json({ error: "Teléfono inválido. Usa +573001234567 o 3001234567" }, { status: 400 });

  const { data } = await db().from("contacts").select("*").eq("id", id).single();
  const c = data as Contact | null;
  if (!c) return NextResponse.json({ error: "Contacto no encontrado" }, { status: 404 });
  if (c.status === "calling") return NextResponse.json({ error: "El contacto está en llamada" }, { status: 409 });

  // Un número escrito a mano o elegido de la lista queda como "manual" para que el pipeline no lo reemplace.
  const source = body.source ? `manual · ${body.source}` : "manual";
  await updateContact(id, {
    phone,
    enrichment_source: source,
    skip_reason: null,
    ...(READY_FROM.includes(c.status) ? { status: "phone_found" as const } : {}),
  });
  await logEvent(id, "enrichment", `Teléfono para llamar elegido a mano: ${maskPhone(phone)}${body.source ? ` (${body.source})` : ""}`, "success");

  if (body.authorize) {
    const s = await getSettings();
    if (!s.live_numbers.includes(phone)) await setSetting("live_numbers", [...s.live_numbers, phone]);
    await logEvent(id, "system", `${maskPhone(phone)} autorizado para llamada real (consentimiento confirmado)`);
  }
  return NextResponse.json({ ok: true, phone, ready: READY_FROM.includes(c.status) });
}
