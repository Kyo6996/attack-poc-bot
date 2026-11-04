import { NextResponse, type NextRequest } from "next/server";
import { bookForAgent } from "@/lib/booking";
import { db, logEvent } from "@/lib/db";
import { formatSlot } from "@/lib/providers/calendar";

// Reserva desde el enlace "Agendar conversación" del correo de seguimiento (sin login).
export async function POST(req: NextRequest) {
  const { token, start } = (await req.json()) as { token?: string; start?: string };
  if (!token || !start) return NextResponse.json({ error: "Datos incompletos" }, { status: 400 });

  const { data: contact } = await db().from("contacts").select("id, status").eq("booking_token", token).maybeSingle();
  if (!contact) return NextResponse.json({ error: "Enlace no válido" }, { status: 404 });
  if (contact.status === "calling") return NextResponse.json({ error: "Intenta de nuevo en unos minutos" }, { status: 409 });

  await logEvent(contact.id, "calendar", "El cliente eligió horario desde el enlace del correo");
  const r = await bookForAgent(contact.id, start);
  if (!r.ok) return NextResponse.json({ error: "Ese horario ya no está disponible. Elige otro." }, { status: 409 });
  return NextResponse.json({ ok: true, when: r.startsAt ? formatSlot(r.startsAt) : null, rep: r.rep?.name ?? null });
}
