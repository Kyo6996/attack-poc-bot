import { NextResponse, type NextRequest } from "next/server";
import { db, logEvent } from "@/lib/db";
import { InputError, pick, resetContactsForProfile, SANDBOX_FIELDS, validateSandbox } from "@/lib/records";

export async function POST(req: NextRequest) {
  try {
    const data = pick(await req.json(), SANDBOX_FIELDS);
    validateSandbox(data, true);
    const { data: row, error } = await db().from("sandbox_profiles").insert(data).select("*").single();
    if (error) throw new InputError(error.code === "23505" ? "Ya existe un perfil con esa URL" : error.message);
    const n = await resetContactsForProfile([row.linkedin_url], row.full_name);
    await logEvent(null, "system", `Perfil sandbox creado: ${row.full_name}${n ? ` · ${n} contacto(s) a reprocesar` : ""}`);
    return NextResponse.json(row);
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: e instanceof InputError ? 400 : 500 });
  }
}
