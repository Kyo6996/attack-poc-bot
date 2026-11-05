import { NextResponse, type NextRequest } from "next/server";
import { db, logEvent, updateContact } from "@/lib/db";
import { revealContacts, searchSignalHire, signalHireCredits, signalHireEnabled } from "@/lib/providers/signalhire";
import type { Contact } from "@/lib/types";

// Body: { action: "search" } (gratis) o { action: "reveal", confirm: true } (gasta 1 crédito).
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!signalHireEnabled()) return NextResponse.json({ error: "SignalHire no está configurado" }, { status: 400 });
  const body = (await req.json().catch(() => ({}))) as { action?: string; confirm?: boolean; uid?: string };
  const { data } = await db().from("contacts").select("*").eq("id", id).single();
  const c = data as Contact | null;
  if (!c) return NextResponse.json({ error: "Contacto no encontrado" }, { status: 404 });

  try {
    if (body.action === "search") {
      const info = await searchSignalHire(c);
      if (c.profile?.signalhire?.reveal) info.reveal = c.profile.signalhire.reveal;
      await updateContact(id, { profile: { ...(c.profile ?? { headline: null, location: null, summary: null, sources: [], company: null, searched_at: info.searched_at, queries: 0 }), signalhire: info } });
      await logEvent(id, "linkedin", `SignalHire (gratis): ${info.best ? `coincide ${info.best.fullName}` : `${info.total} resultado(s) sin coincidencia segura`}`);
      return NextResponse.json({ ok: true, info });
    }

    if (body.action === "reveal") {
      // Gastar créditos exige confirmación explícita desde la app.
      if (body.confirm !== true) return NextResponse.json({ error: "Falta confirmar el uso del crédito" }, { status: 400 });
      const sh = c.profile?.signalhire;
      if (sh?.reveal?.status === "pendiente") return NextResponse.json({ error: "Ya hay una revelación en curso" }, { status: 409 });
      if (sh?.reveal?.status === "listo") return NextResponse.json({ error: "Este contacto ya fue revelado; no se gasta otro crédito" }, { status: 409 });
      const item = body.uid ?? sh?.best?.uid ?? c.linkedin_url;
      if (!item) return NextResponse.json({ error: "No hay perfil de SignalHire ni de LinkedIn para revelar" }, { status: 400 });
      const credits = await signalHireCredits();
      if (credits !== null && credits < 1) return NextResponse.json({ error: "No quedan créditos en SignalHire" }, { status: 402 });

      const { requestId } = await revealContacts(id, item);
      await updateContact(id, {
        profile: {
          ...c.profile!,
          signalhire: { ...(sh ?? { searched_at: new Date().toISOString(), total: 0, best: null, others: [] }), reveal: { requested_at: new Date().toISOString(), status: "pendiente" } },
        },
      });
      await logEvent(id, "enrichment", `Revelado de contactos en SignalHire autorizado (1 crédito · solicitud ${requestId})`, "warn");
      return NextResponse.json({ ok: true, requestId, creditsBefore: credits });
    }
    return NextResponse.json({ error: "Acción no válida" }, { status: 400 });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 502 });
  }
}
