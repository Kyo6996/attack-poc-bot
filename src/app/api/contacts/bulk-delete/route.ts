import { NextResponse, type NextRequest } from "next/server";
import { db, logEvent } from "@/lib/db";
import { cancelEvents } from "@/lib/records";

export const maxDuration = 60;

// Body: { ids: string[] }. Los contactos en llamada no se tocan.
export async function POST(req: NextRequest) {
  const { ids } = (await req.json()) as { ids?: string[] };
  if (!ids?.length) return NextResponse.json({ error: "No hay contactos seleccionados" }, { status: 400 });
  const { data } = await db().from("contacts").select("id, status").in("id", ids);
  const deletable = (data ?? []).filter((c) => c.status !== "calling").map((c) => c.id);
  for (const id of deletable) await cancelEvents({ contactId: id });
  const { error } = await db().from("contacts").delete().in("id", deletable);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  await logEvent(null, "system", `${deletable.length} contacto(s) eliminados desde el panel`);
  return NextResponse.json({ deleted: deletable.length, skipped: ids.length - deletable.length });
}
