import { NextResponse, type NextRequest } from "next/server";
import { db, logEvent } from "@/lib/db";
import { InputError, pick, resetContactsForProfile, SANDBOX_FIELDS, validateSandbox } from "@/lib/records";

type Ctx = { params: Promise<{ id: string }> };

const fail = (e: unknown) =>
  NextResponse.json({ error: (e as Error).message }, { status: e instanceof InputError ? 400 : 500 });

export async function PATCH(req: NextRequest, { params }: Ctx) {
  const { id } = await params;
  try {
    const data = pick(await req.json(), SANDBOX_FIELDS);
    validateSandbox(data, false);
    const { data: before, error: e1 } = await db().from("sandbox_profiles").select("*").eq("id", id).single();
    if (e1) throw new InputError("Perfil no encontrado");

    const { data: row, error } = await db().from("sandbox_profiles").update(data).eq("id", id).select("*").single();
    if (error) throw new InputError(error.code === "23505" ? "Ya existe un perfil con esa URL" : error.message);

    const n = await resetContactsForProfile([before.linkedin_url, row.linkedin_url], row.full_name);
    await logEvent(null, "system", `Perfil sandbox editado: ${row.full_name}${n ? ` · ${n} contacto(s) a reprocesar` : ""}`);
    return NextResponse.json(row);
  } catch (e) {
    return fail(e);
  }
}

export async function DELETE(_req: NextRequest, { params }: Ctx) {
  const { id } = await params;
  try {
    const { data: before } = await db().from("sandbox_profiles").select("*").eq("id", id).single();
    const { error } = await db().from("sandbox_profiles").delete().eq("id", id);
    if (error) throw new Error(error.message);
    if (before) {
      const n = await resetContactsForProfile([before.linkedin_url]);
      await logEvent(null, "system", `Perfil sandbox eliminado: ${before.full_name}${n ? ` · ${n} contacto(s) a reprocesar` : ""}`);
    }
    return NextResponse.json({ ok: true });
  } catch (e) {
    return fail(e);
  }
}
