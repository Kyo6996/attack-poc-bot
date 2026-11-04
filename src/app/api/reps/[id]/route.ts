import { NextResponse, type NextRequest } from "next/server";
import { db } from "@/lib/db";
import { InputError, pick, REP_FIELDS, validateRep } from "@/lib/records";

type Ctx = { params: Promise<{ id: string }> };

const fail = (e: unknown) =>
  NextResponse.json({ error: (e as Error).message }, { status: e instanceof InputError ? 400 : 500 });

export async function PATCH(req: NextRequest, { params }: Ctx) {
  const { id } = await params;
  try {
    const data = pick(await req.json(), REP_FIELDS);
    validateRep(data, false);
    const { data: row, error } = await db().from("sales_reps").update(data).eq("id", id).select("*").single();
    if (error) throw new Error(error.message);
    return NextResponse.json(row);
  } catch (e) {
    return fail(e);
  }
}

// Las reuniones que tenía asignadas quedan sin comercial (on delete set null).
export async function DELETE(_req: NextRequest, { params }: Ctx) {
  const { id } = await params;
  try {
    const { error } = await db().from("sales_reps").delete().eq("id", id);
    if (error) throw new Error(error.message);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return fail(e);
  }
}
