import { NextResponse, type NextRequest } from "next/server";
import { db, logEvent } from "@/lib/db";
import { CONTACT_FIELDS, InputError, pick, validateContact } from "@/lib/records";

export async function POST(req: NextRequest) {
  try {
    const data = pick(await req.json(), CONTACT_FIELDS);
    validateContact(data, true);
    const { data: row, error } = await db().from("contacts").insert(data).select("*").single();
    if (error) throw new Error(error.message);
    await logEvent(row.id, "system", "Contacto creado desde el panel", "success");
    return NextResponse.json(row);
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: e instanceof InputError ? 400 : 500 });
  }
}
