import { NextResponse, type NextRequest } from "next/server";
import { db } from "@/lib/db";
import { reconcileContact } from "@/lib/reconcile";

// Libera a mano un contacto que quedó "en llamada".
export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { data } = await db().from("contacts").select("status, call_id").eq("id", id).single();
  if (!data) return NextResponse.json({ error: "Contacto no encontrado" }, { status: 404 });
  if (data.status !== "calling") return NextResponse.json({ ok: true, result: "no estaba en llamada" });
  const result = await reconcileContact(id, data.call_id, true);
  return NextResponse.json({ ok: true, result });
}
