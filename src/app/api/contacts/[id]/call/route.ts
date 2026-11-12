import { NextResponse, type NextRequest } from "next/server";
import { db, logEvent, updateContact } from "@/lib/db";
import { advanceContact } from "@/lib/pipeline";
import type { Contact, ContactStatus } from "@/lib/types";

export const maxDuration = 60;

// Estados desde los que se puede volver a llamar a mano sin reprocesar el contacto.
const CALLABLE: ContactStatus[] = ["linkedin_found", "phone_found", "no_answer", "call_failed", "declined", "skipped", "needs_review"];

// Llama ahora a un solo contacto, conservando su ficha.
export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { data } = await db().from("contacts").select("*").eq("id", id).single();
  const c = data as Contact | null;
  if (!c) return NextResponse.json({ error: "Contacto no encontrado" }, { status: 404 });
  if (!c.phone) return NextResponse.json({ error: "El contacto no tiene teléfono" }, { status: 400 });
  if (!c.consent) return NextResponse.json({ error: "El contacto no tiene consentimiento registrado" }, { status: 400 });
  if (!CALLABLE.includes(c.status)) return NextResponse.json({ error: c.status === "calling" ? "Ya está en llamada" : "Este contacto ya tiene reunión agendada" }, { status: 409 });

  const { count } = await db().from("contacts").select("id", { count: "exact", head: true }).eq("status", "calling");
  if (count) return NextResponse.json({ error: "Hay otra llamada en curso; espera a que termine" }, { status: 409 });

  const ready = await updateContact(id, { status: "phone_found", skip_reason: null, locked_until: null });
  await logEvent(id, "call", "Llamada manual solicitada desde el panel");
  const status = await advanceContact(ready, { allowCall: true });
  return NextResponse.json({ ok: true, status });
}
