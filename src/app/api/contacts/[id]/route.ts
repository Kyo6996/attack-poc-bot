import { after, NextResponse, type NextRequest } from "next/server";
import { db, logEvent } from "@/lib/db";
import { prepareContacts } from "@/lib/pipeline";
import { cancelEvents, CONTACT_FIELDS, InputError, pick, resetContact, syncMeetingEmail, touchesFlow, validateContact } from "@/lib/records";

type Ctx = { params: Promise<{ id: string }> };

const fail = (e: unknown) =>
  NextResponse.json({ error: (e as Error).message }, { status: e instanceof InputError ? 400 : 500 });

// Body: { data?: {...campos}, reprocess?: boolean }
export async function PATCH(req: NextRequest, { params }: Ctx) {
  const { id } = await params;
  try {
    const body = (await req.json()) as { data?: Record<string, unknown>; reprocess?: boolean };
    const data = pick(body.data ?? {}, CONTACT_FIELDS);
    validateContact(data, false);

    const { data: before, error: e1 } = await db().from("contacts").select("*").eq("id", id).single();
    if (e1) throw new InputError("Contacto no encontrado");
    const changed = Object.fromEntries(Object.entries(data).filter(([k, v]) => before[k] !== v));

    if (Object.keys(changed).length) {
      if (before.status === "calling") throw new InputError("El contacto está en llamada; espera a que termine");
      const { error } = await db().from("contacts").update(changed).eq("id", id);
      if (error) throw new Error(error.message);
      await logEvent(id, "system", `Editado desde el panel: ${Object.keys(changed).join(", ")}`);
    }

    const reprocess = body.reprocess || (touchesFlow(changed) && before.status !== "pending");
    if (reprocess) {
      await resetContact(id, body.reprocess ? "reproceso manual" : "cambiaron datos que usa el flujo");
      // Se vuelve a buscar su información de inmediato (sin llamar).
      after(() => prepareContacts([id]));
    } else if (typeof data.email === "string") {
      await syncMeetingEmail(id, data.email, `${before.first_name} ${before.last_name}`);
    }
    const { data: row } = await db().from("contacts").select("*").eq("id", id).single();
    return NextResponse.json(row);
  } catch (e) {
    return fail(e);
  }
}

export async function DELETE(_req: NextRequest, { params }: Ctx) {
  const { id } = await params;
  try {
    const { data } = await db().from("contacts").select("status").eq("id", id).single();
    if (data?.status === "calling") throw new InputError("El contacto está en llamada; espera a que termine");
    await cancelEvents({ contactId: id });
    const { error } = await db().from("contacts").delete().eq("id", id);
    if (error) throw new Error(error.message);
    await logEvent(null, "system", "Contacto eliminado desde el panel");
    return NextResponse.json({ ok: true });
  } catch (e) {
    return fail(e);
  }
}
